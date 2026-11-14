import { luminance } from './math.js';

export const DEFAULT_HISTOGRAM_OPTIONS = Object.freeze({
  // Number of log-spaced luminance buckets.
  bins: 256,
  // Luminance range in linear scene units. The histogram covers
  // [minLuminance, maxLuminance] uniformly in log2 (stops) space.
  minLuminance: 1e-4,
  maxLuminance: 1e4,
  // 0 = uniform spatial weighting, 1 = fully center biased.
  centerWeight: 0.5,
});

function spatialWeight(nx, ny) {
  // 1 at image center, 0 at the corners.
  const distance = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2;
  return 1 - distance;
}

// Builds a weighted, log2-spaced luminance histogram from a validated
// linear RGBA Float32Array. Pixels with luminance <= 0 are counted
// separately so an all-black frame is distinguishable from real data.
export function buildHistogram(buffer, width, height, options = {}) {
  const opts = { ...DEFAULT_HISTOGRAM_OPTIONS, ...options };
  const binCount = opts.bins;
  const minStops = Math.log2(opts.minLuminance);
  const maxStops = Math.log2(opts.maxLuminance);
  const stopSpan = maxStops - minStops;
  const bins = new Float64Array(binCount);

  let zeroPixels = 0;
  let underflow = 0;
  let overflow = 0;
  let totalWeight = 0;

  let pixelIndex = 0;
  for (let y = 0; y < height; y++) {
    const ny = ((y + 0.5) / height) * 2 - 1;
    for (let x = 0; x < width; x++) {
      const nx = ((x + 0.5) / width) * 2 - 1;
      const spatial = spatialWeight(nx, ny);
      const weight = (1 - opts.centerWeight) + opts.centerWeight * spatial;

      const offset = pixelIndex * 4;
      const lum = luminance(
        buffer[offset],
        buffer[offset + 1],
        buffer[offset + 2],
      );

      if (lum <= 0) {
        zeroPixels++;
      } else {
        totalWeight += weight;
        if (lum < opts.minLuminance) {
          underflow += weight;
        } else if (lum > opts.maxLuminance) {
          overflow += weight;
        } else {
          const stop = Math.log2(lum);
          let bin = Math.floor(((stop - minStops) / stopSpan) * binCount);
          if (bin < 0) bin = 0;
          if (bin >= binCount) bin = binCount - 1;
          bins[bin] += weight;
        }
      }
      pixelIndex++;
    }
  }

  return {
    bins,
    binCount,
    minStops,
    maxStops,
    minLuminance: opts.minLuminance,
    maxLuminance: opts.maxLuminance,
    underflow,
    overflow,
    zeroPixels,
    totalWeight,
    pixelCount: width * height,
  };
}

// Returns the luminance at the given percentile (0 < percentile <= 100),
// interpolated in stop space. Returns null when every pixel is black.
// Empty buckets are skipped; underflow/overflow are folded onto the edges.
export function percentileLuminance(histogram, percentile) {
  if (!(percentile > 0 && percentile <= 100)) {
    throw new RangeError(
      `percentile must be in (0, 100], got ${percentile}`,
    );
  }
  if (histogram.totalWeight === 0) {
    return null;
  }

  const target = (percentile / 100) * histogram.totalWeight;
  const binWidth =
    (histogram.maxStops - histogram.minStops) / histogram.binCount;
  let cumulative = 0;

  // Underflow behaves as a zero-width entry at minStops.
  if (histogram.underflow > 0) {
    cumulative += histogram.underflow;
    if (cumulative >= target) {
      return histogram.minLuminance;
    }
  }

  for (let i = 0; i < histogram.binCount; i++) {
    const bucketWeight = histogram.bins[i];
    if (bucketWeight === 0) continue;
    const previous = cumulative;
    cumulative += bucketWeight;
    if (cumulative >= target) {
      const fraction =
        bucketWeight === 0 ? 0 : (target - previous) / bucketWeight;
      const stop = histogram.minStops + (i + fraction) * binWidth;
      return Math.pow(2, stop);
    }
  }

  // Only overflow weight remains (or rounding landed past the last bucket).
  return histogram.maxLuminance;
}
