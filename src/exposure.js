import { percentileLuminance } from './histogram.js';
import { clamp } from './math.js';

export const DEFAULT_EXPOSURE_OPTIONS = Object.freeze({
  // Which luminance percentile (0-100] drives the meter.
  percentile: 50,
  // Linear-light luminance that the percentile should map to (18% grey).
  targetLuminance: 0.18,
  // Clamp the produced exposure value, in stops.
  minEV: -12,
  maxEV: 12,
});

// Stateless metering: EV = log2(percentileLuminance / targetLuminance).
// A brighter frame produces a positive EV, which the pipeline turns into an
// exposure gain of 2^-EV to pull that luminance back down to target.
// Returns null for an all-black frame (no measurable luminance).
export function computeExposure(histogram, options = {}) {
  const opts = { ...DEFAULT_EXPOSURE_OPTIONS, ...options };
  const lum = percentileLuminance(histogram, opts.percentile);
  if (lum === null) {
    return null;
  }
  const ev = Math.log2(lum / opts.targetLuminance);
  return clamp(ev, opts.minEV, opts.maxEV);
}

export const DEFAULT_CONTROLLER_OPTIONS = Object.freeze({
  // Maximum EV change per frame. Negative direction (dark -> bright scene,
  // EV rises) is usually limited more aggressively than recovery.
  maxEVIncrease: 0.5,
  maxEVDecrease: 1.0,
  // EV used before the first frame and after reset().
  initialEV: 0,
  // When false the first measured frame is snapped to its target EV.
  limitFirstFrame: false,
});

// Stateful auto-exposure controller with frame-to-frame slew limits.
// Increase = EV moving upward (scene getting brighter / gain decreasing).
// Decrease = EV moving downward (scene getting darker / gain increasing).
export class ExposureController {
  constructor(exposureOptions = {}, controllerOptions = {}) {
    this.exposureOptions = {
      ...DEFAULT_EXPOSURE_OPTIONS,
      ...exposureOptions,
    };
    this.controllerOptions = {
      ...DEFAULT_CONTROLLER_OPTIONS,
      ...controllerOptions,
    };
    if (this.controllerOptions.maxEVIncrease <= 0) {
      throw new RangeError('maxEVIncrease must be positive (stops/frame)');
    }
    if (this.controllerOptions.maxEVDecrease <= 0) {
      throw new RangeError('maxEVDecrease must be positive (stops/frame)');
    }
    this.reset();
  }

  reset() {
    this.currentEV = this.controllerOptions.initialEV;
    this.targetEV = this.controllerOptions.initialEV;
    this.frameCount = 0;
    this.lastFrameBlack = false;
  }

  // Feeds one histogram. All-black frames hold the previous exposure instead
  // of spiking the gain toward infinity.
  update(histogram) {
    const measured = computeExposure(histogram, this.exposureOptions);
    this.frameCount++;

    if (measured === null) {
      this.lastFrameBlack = true;
      this.targetEV = this.currentEV;
      return {
        ev: this.currentEV,
        targetEV: this.currentEV,
        measuredEV: null,
        held: true,
        converged: true,
        blackFrame: true,
        frame: this.frameCount,
      };
    }
    this.lastFrameBlack = false;
    this.targetEV = measured;

    let nextEV;
    if (this.frameCount === 1 && !this.controllerOptions.limitFirstFrame) {
      nextEV = measured;
    } else {
      const delta = measured - this.currentEV;
      const limit =
        delta >= 0
          ? this.controllerOptions.maxEVIncrease
          : this.controllerOptions.maxEVDecrease;
      nextEV = this.currentEV + clamp(delta, -limit, limit);
    }
    this.currentEV = nextEV;

    return {
      ev: nextEV,
      targetEV: measured,
      measuredEV: measured,
      held: false,
      converged: nextEV === measured,
      blackFrame: false,
      frame: this.frameCount,
    };
  }
}
