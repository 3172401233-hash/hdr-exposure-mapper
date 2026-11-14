// 4x4 ordered Bayer matrix, normalized to thresholds in [0, 1).
// Deterministic: the same (x, y) always receives the same threshold.
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function bayerThreshold(x, y) {
  const value = BAYER_4X4[y & 3][x & 3];
  return (value + 0.5) / 16;
}

// Ordered-dither quantization to 8-bit. value is an sRGB-encoded [0, 1].
export function quantize8(value, x, y, enabled) {
  const threshold = enabled ? bayerThreshold(x, y) : 0.5;
  let quantized = Math.floor(value * 255 + threshold);
  if (quantized < 0) quantized = 0;
  if (quantized > 255) quantized = 255;
  return quantized;
}
