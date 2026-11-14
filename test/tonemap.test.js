import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reinhardExtended,
  acesNarkowicz,
  getToneMapper,
  bayerThreshold,
  quantize8,
} from '../src/index.js';

for (const [name, fn] of [
  ['reinhard', reinhardExtended],
  ['aces', acesNarkowicz],
]) {
  test(`${name} maps zero to zero`, () => {
    assert.equal(name === 'reinhard' ? fn(0, 4) : fn(0), 0);
  });

  test(`${name} stays within [0, 1] across a wide HDR range`, () => {
    for (let x = 0; x <= 1000; x += 0.25) {
      const y = name === 'reinhard' ? fn(x, 4) : fn(x);
      assert.ok(y >= 0 && y <= 1, `out of range at x=${x}: ${y}`);
    }
  });

  test(`${name} is strictly monotonic on the usable range`, () => {
    let previous = -1;
    for (let x = 0; x <= 10; x += 0.05) {
      const y = name === 'reinhard' ? fn(x, 4) : fn(x);
      assert.ok(y >= previous, `non-monotonic at x=${x}`);
      previous = y;
    }
  });

  test(`${name} compresses large highlights instead of clipping instantly`, () => {
    const atTwo = name === 'reinhard' ? fn(2, 4) : fn(2);
    const atTen = name === 'reinhard' ? fn(10, 4) : fn(10);
    const atHundred = name === 'reinhard' ? fn(100, 4) : fn(100);
    assert.ok(atTwo < 1, `already clipped at x=2: ${atTwo}`);
    assert.ok(atTen <= 1);
    assert.ok(atHundred >= atTen);
  });
}

test('unknown tone mapper name throws', () => {
  assert.throws(() => getToneMapper('sigmoid'), /unknown tone mapper/);
});

test('reinhard white point must be positive', () => {
  assert.throws(() => reinhardExtended(1, 0), RangeError);
});

test('Bayer threshold is deterministic and covers the 4x4 tile', () => {
  const values = new Set();
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      values.add(bayerThreshold(x, y));
      assert.equal(bayerThreshold(x + 4, y), bayerThreshold(x, y));
    }
  }
  assert.equal(values.size, 16);
});

test('quantize8 is bounded to 0..255 with and without dither', () => {
  for (const dither of [true, false]) {
    assert.equal(quantize8(0, 0, 0, dither), 0);
    assert.equal(quantize8(1, 3, 2, dither), 255);
    assert.equal(quantize8(-2, 0, 0, dither), 0);
    assert.equal(quantize8(5, 0, 0, dither), 255);
  }
});
