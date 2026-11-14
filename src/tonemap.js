import { clamp } from './math.js';

// All curves consume *post-exposure* linear light values
// (scene value multiplied by exposure gain 2^-EV) and return linear [0, 1].

// Monotonic bounded Reinhard variant. shoulder controls the highlight
// roll-off strength: a = 1 / (whitePoint^2). Unlike the classic extended
// Reinhard formula, f(x) = (x + a*x^2) / (1 + x + a*x^2) is strictly
// increasing, stays inside [0, 1) for finite input and approaches 1
// asymptotically, so highlights compress without a post-hoc clamp that
// would destroy ordering (and band) the ramp.
export function reinhardExtended(x, whitePoint = 4) {
  if (whitePoint <= 0) {
    throw new RangeError('whitePoint must be positive');
  }
  if (x <= 0) return 0;
  const a = 1 / (whitePoint * whitePoint);
  const quadratic = a * x * x;
  return (x + quadratic) / (1 + x + quadratic);
}

// Narkowicz ACES filmic approximation. Monotonic and bounded to [0, 1].
export function acesNarkowicz(x) {
  if (x <= 0) return 0;
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1);
}

export const TONE_MAPPERS = Object.freeze({
  reinhard: reinhardExtended,
  aces: acesNarkowicz,
});

export function getToneMapper(name) {
  const mapper = TONE_MAPPERS[name];
  if (!mapper) {
    throw new Error(
      `unknown tone mapper "${name}", expected one of ${Object.keys(TONE_MAPPERS).join(', ')}`,
    );
  }
  return mapper;
}
