import { isPositiveInteger, linearToSrgb, luminance } from './math.js';
import { buildHistogram } from './histogram.js';
import { computeExposure, ExposureController } from './exposure.js';
import { getToneMapper } from './tonemap.js';
import { quantize8 } from './dither.js';

export const DEFAULT_PIPELINE_OPTIONS = Object.freeze({
  maxPixels: 4_000_000,
  toneMapper: 'reinhard',
  whitePoint: 4,
  output: 'uint8',
  dither: true,
  histogram: undefined,
  exposure: undefined,
  controller: undefined,
});

// Throws with a precise message for every malformed input class:
// non-infinite/NaN components, negative RGB, bad geometry and oversized frames.
export function validateRGBA(buffer, width, height, maxPixels) {
  if (!(buffer instanceof Float32Array)) {
    throw new TypeError('buffer must be a Float32Array of linear RGBA floats');
  }
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new RangeError('width and height must be positive integers');
  }
  const pixelCount = width * height;
  if (pixelCount > maxPixels) {
    throw new RangeError(
      `frame of ${pixelCount} px exceeds maxPixels budget of ${maxPixels}`,
    );
  }
  const expectedLength = pixelCount * 4;
  if (buffer.length !== expectedLength) {
    throw new RangeError(
      `buffer length ${buffer.length} does not match ${width}x${height} RGBA (expected ${expectedLength})`,
    );
  }
  for (let i = 0; i < buffer.length; i += 4) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];
    const a = buffer[i + 3];
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      throw new RangeError(
        `pixel ${i / 4} contains NaN or infinite RGB values`,
      );
    }
    if (r < 0 || g < 0 || b < 0) {
      throw new RangeError(`pixel ${i / 4} contains negative RGB values`);
    }
    if (!Number.isFinite(a) || a < 0) {
      throw new RangeError(
        `pixel ${i / 4} has an invalid alpha (must be finite and >= 0)`,
      );
    }
  }
}

export function isBlackFrame(buffer) {
  for (let i = 0; i < buffer.length; i += 4) {
    if (luminance(buffer[i], buffer[i + 1], buffer[i + 2]) > 0) {
      return false;
    }
  }
  return true;
}

// Stateless single-frame convenience entry point.
export function processFrame(buffer, width, height, options = {}) {
  const opts = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
  validateRGBA(buffer, width, height, opts.maxPixels);

  const histogram = buildHistogram(
    buffer,
    width,
    height,
    opts.histogram,
  );
  const ev = computeExposure(histogram, opts.exposure);
  return applyTonePipeline(buffer, width, height, ev, histogram, opts);
}

// Streaming pipeline: owns one ExposureController and applies its slew-limited
// EV to every frame in sequence.
export class HDRPipeline {
  constructor(options = {}) {
    this.options = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
    this.controller = new ExposureController(
      this.options.exposure,
      this.options.controller,
    );
    this.toneMapper = getToneMapper(this.options.toneMapper);
  }

  process(buffer, width, height) {
    const opts = this.options;
    validateRGBA(buffer, width, height, opts.maxPixels);
    const histogram = buildHistogram(
      buffer,
      width,
      height,
      opts.histogram,
    );
    const status = this.controller.update(histogram);
    return applyTonePipeline(
      buffer,
      width,
      height,
      status.ev,
      histogram,
      opts,
      status,
    );
  }
}

function applyTonePipeline(
  buffer,
  width,
  height,
  ev,
  histogram,
  opts,
  controllerStatus = null,
) {
  // A null EV means an all-black frame: hold gain at 1 (EV 0) so the output
  // is deterministic all-black rather than an amplified black level.
  const gain = ev === null ? 1 : Math.pow(2, -ev);
  const pixelCount = width * height;
  const useUint8 = opts.output === 'uint8';
  const output = useUint8
    ? new Uint8ClampedArray(pixelCount * 4)
    : new Float32Array(pixelCount * 4);
  const blackFrame = histogram.totalWeight === 0;
  const toneMapper = getToneMapper(opts.toneMapper);
  const needsWhitePoint = toneMapper.length >= 2;

  let pixelIndex = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = pixelIndex * 4;
      const srgb = [0, 0, 0];
      for (let channel = 0; channel < 3; channel++) {
        const scaled = buffer[offset + channel] * gain;
        const linear = needsWhitePoint
          ? toneMapper(scaled, opts.whitePoint)
          : toneMapper(scaled);
        srgb[channel] = linearToSrgb(linear);
      }

      if (useUint8) {
        output[offset] = quantize8(srgb[0], x, y, opts.dither);
        output[offset + 1] = quantize8(srgb[1], x, y, opts.dither);
        output[offset + 2] = quantize8(srgb[2], x, y, opts.dither);
        output[offset + 3] = quantize8(buffer[offset + 3], x, y, false);
      } else {
        output[offset] = srgb[0];
        output[offset + 1] = srgb[1];
        output[offset + 2] = srgb[2];
        output[offset + 3] = buffer[offset + 3];
      }
      pixelIndex++;
    }
  }

  return {
    data: output,
    ev: ev === null ? 0 : ev,
    gain,
    blackFrame,
    histogram,
    controller: controllerStatus,
  };
}
