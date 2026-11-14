// Rec.709 luma coefficients for *linear* light RGB.
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

export function luminance(r, g, b) {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

// Linear-light -> sRGB transfer function. Input/output are normalized [0, 1].
export function linearToSrgb(c) {
  if (c <= 0.0031308) {
    return 12.92 * c;
  }
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}
