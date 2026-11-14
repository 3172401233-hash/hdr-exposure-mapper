import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HDRPipeline,
  processFrame,
  validateRGBA,
  isBlackFrame,
  linearToSrgb,
  reinhardExtended,
} from '../src/index.js';
import {
  solidBuffer,
  blackBuffer,
  grayRamp,
  makeBuffer,
  distinctLevels,
} from './helpers.js';

test('dark frame outputs deterministic all zeros and is flagged black', () => {
  const result = processFrame(blackBuffer(8, 8), 8, 8);
  assert.equal(result.blackFrame, true);
  assert.equal(result.ev, 0);
  for (const value of result.data) assert.equal(value, 0);
  const again = processFrame(blackBuffer(8, 8), 8, 8);
  assert.deepEqual(Array.from(result.data), Array.from(again.data));
});

test('normalized mid-gray maps near the sRGB encoding of 18% exposure', () => {
  const buffer = solidBuffer(4, 4, 0.18);
  const result = processFrame(buffer, 4, 4, {
    output: 'float',
    dither: false,
  });
  const expected = linearToSrgb(
    reinhardExtended(0.18 * result.gain, 4),
  );
  assert.ok(Math.abs(result.data[0] - expected) < 1e-6);
});

test('gray ramp stays neutral: R = G = B for every pixel', () => {
  const buffer = grayRamp(64, 8, 1e-3, 8);
  const result = processFrame(buffer, 64, 8, {
    output: 'float',
    dither: false,
  });
  for (let i = 0; i < 64 * 8; i++) {
    const offset = i * 4;
    assert.equal(result.data[offset], result.data[offset + 1]);
    assert.equal(result.data[offset + 1], result.data[offset + 2]);
  }
});

test('gray ramp is monotonic in output space (float, no dither)', () => {
  const width = 128;
  const buffer = grayRamp(width, 1, 1e-4, 16);
  const result = processFrame(buffer, width, 1, {
    output: 'float',
    dither: false,
  });
  let previous = -1;
  for (let x = 0; x < width; x++) {
    const value = result.data[x * 4];
    assert.ok(value >= previous, `ramp decreased at x=${x}`);
    previous = value;
  }
});

test('dithering reduces banding vs plain rounding on a smooth ramp', () => {
  const width = 256;
  const buffer = grayRamp(width, 16, 0.02, 0.6);
  const dithered = processFrame(buffer, width, 16, { dither: true });
  const rounded = processFrame(buffer, width, 16, { dither: false });
  const ditheredLevels = distinctLevels(dithered.data, width, 16).size;
  const roundedLevels = distinctLevels(rounded.data, width, 16).size;
  assert.ok(ditheredLevels >= roundedLevels);
  assert.ok(roundedLevels < 256);
  assert.ok(ditheredLevels > 8);
});

test('isolated highlight is compressed below white with bounded output range', () => {
  const buffer = makeBuffer(16, 16, (x, y) => {
    if (x === 8 && y === 8) return [64, 64, 64, 1];
    return [0.05, 0.05, 0.05, 1];
  });
  const result = processFrame(buffer, 16, 16, {
    output: 'float',
    dither: false,
  });
  for (const value of result.data) {
    assert.ok(value >= 0 && value <= 1);
  }
  const highlightOffset = (8 * 16 + 8) * 4;
  assert.ok(result.data[highlightOffset] < 1);
  assert.ok(result.data[highlightOffset] > 0.5);
});

test('scene cut converges over multiple frames without per-frame jumps', () => {
  const pipeline = new HDRPipeline({
    controller: { maxEVIncrease: 0.5, maxEVDecrease: 0.5, limitFirstFrame: true },
  });
  const dark = solidBuffer(8, 8, 0.01);
  const bright = solidBuffer(8, 8, 4);
  pipeline.process(dark, 8, 8);

  const evLog = [];
  for (let frame = 0; frame < 10; frame++) {
    const result = pipeline.process(bright, 8, 8);
    evLog.push(result.ev);
  }
  for (let i = 1; i < evLog.length; i++) {
    assert.ok(Math.abs(evLog[i] - evLog[i - 1]) <= 0.5 + 1e-9);
  }
  assert.equal(evLog.at(-1), pipeline.controller.targetEV);
});

test('continuous smooth exposure changes track the target monotonically', () => {
  const pipeline = new HDRPipeline({
    controller: { maxEVIncrease: 2, maxEVDecrease: 2, limitFirstFrame: false },
  });
  const evLog = [];
  for (let frame = 0; frame < 24; frame++) {
    const luminanceValue = 0.002 * Math.pow(1.25, frame);
    const result = pipeline.process(
      solidBuffer(8, 8, luminanceValue),
      8,
      8,
    );
    evLog.push(result.ev);
  }
  // First frame snaps straight to its metered target; afterwards each frame
  // is brighter than the last, so EV must never decrease.
  for (let i = 1; i < evLog.length; i++) {
    assert.ok(evLog[i] >= evLog[i - 1] - 1e-9);
  }
});

test('processing is deterministic for identical frames', () => {
  const buffer = makeBuffer(12, 12, (x, y) => [
    (x + 1) * 0.03,
    (y + 1) * 0.02,
    0.1,
    1,
  ]);
  const first = processFrame(buffer, 12, 12);
  const second = processFrame(buffer, 12, 12);
  assert.deepEqual(Array.from(first.data), Array.from(second.data));
  assert.equal(first.ev, second.ev);
});

test('all output types stay in declared range', () => {
  const buffer = grayRamp(32, 4, 0, 10);
  const uint8 = processFrame(buffer, 32, 4, { output: 'uint8' });
  const float = processFrame(buffer, 32, 4, { output: 'float' });
  assert.ok(uint8.data instanceof Uint8ClampedArray);
  assert.ok(float.data instanceof Float32Array);
  for (const value of uint8.data) assert.ok(value <= 255);
  for (const value of float.data) assert.ok(value >= 0 && value <= 1);
});

test('validation rejects NaN, infinity, negatives and bad geometry', () => {
  const nan = blackBuffer(2, 2);
  nan[0] = Number.NaN;
  assert.throws(() => validateRGBA(nan, 2, 2, 1000), /NaN or infinite/);

  const infinity = blackBuffer(2, 2);
  infinity[1] = Number.POSITIVE_INFINITY;
  assert.throws(() => validateRGBA(infinity, 2, 2, 1000), /NaN or infinite/);

  const negative = blackBuffer(2, 2);
  negative[2] = -0.01;
  assert.throws(() => validateRGBA(negative, 2, 2, 1000), /negative/);

  assert.throws(
    () => validateRGBA(blackBuffer(2, 2), 0, 2, 1000),
    /positive integers/,
  );
  assert.throws(
    () => validateRGBA(new Float32Array(8), 2, 2, 1000),
    /buffer length/,
  );
});

test('frames over the pixel budget are rejected', () => {
  const buffer = blackBuffer(10, 10);
  assert.throws(
    () => processFrame(buffer, 10, 10, { maxPixels: 50 }),
    /exceeds maxPixels budget/,
  );
});

test('isBlackFrame distinguishes true black from dark color', () => {
  assert.equal(isBlackFrame(blackBuffer(2, 2)), true);
  assert.equal(isBlackFrame(solidBuffer(2, 2, 1e-6)), false);
});
