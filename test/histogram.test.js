import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistogram,
  percentileLuminance,
} from '../src/index.js';
import { solidBuffer, blackBuffer, makeBuffer } from './helpers.js';

test('histogram places uniform mid-gray into one non-empty bucket', () => {
  const buffer = solidBuffer(8, 8, 0.18);
  const histogram = buildHistogram(buffer, 8, 8);
  const populated = histogram.bins.filter((weight) => weight > 0);
  assert.equal(populated.length, 1);
  assert.ok(histogram.totalWeight > 0);
  assert.equal(histogram.zeroPixels, 0);
});

test('percentile of a uniform frame equals its luminance (up to bin width)', () => {
  const buffer = solidBuffer(8, 8, 0.5);
  const histogram = buildHistogram(buffer, 8, 8);
  const lum = percentileLuminance(histogram, 50);
  const binWidth =
    (histogram.maxStops - histogram.minStops) / histogram.binCount;
  assert.ok(Math.abs(Math.log2(lum / 0.5)) <= binWidth);
});

test('all-black frame yields zero weighted buckets and null percentile', () => {
  const histogram = buildHistogram(blackBuffer(4, 4), 4, 4);
  assert.equal(histogram.totalWeight, 0);
  assert.equal(histogram.zeroPixels, 16);
  for (const weight of histogram.bins) assert.equal(weight, 0);
  assert.equal(percentileLuminance(histogram, 50), null);
});

test('zero buckets are skipped: sparse pixels still resolve a percentile', () => {
  const buffer = makeBuffer(8, 1, (x) =>
    x === 0 ? [0.25, 0.25, 0.25, 1] : [0, 0, 0, 1],
  );
  const histogram = buildHistogram(buffer, 8, 1);
  assert.ok(histogram.zeroPixels >= 7);
  const lum = percentileLuminance(histogram, 100);
  assert.ok(lum > 0.2 && lum <= 0.3);
});

test('values beyond maxLuminance fold onto the overflow edge', () => {
  const buffer = solidBuffer(4, 4, 1e5);
  const histogram = buildHistogram(buffer, 4, 4);
  assert.ok(histogram.overflow > 0);
  assert.equal(
    percentileLuminance(histogram, 95),
    histogram.maxLuminance,
  );
});

test('center weight changes relative bucket weights but keeps coverage', () => {
  const buffer = makeBuffer(8, 8, (x, y) => {
    const edge = x === 0 || y === 0 ? 0.01 : 0.9;
    return [edge, edge, edge, 1];
  });
  const uniform = buildHistogram(buffer, 8, 8, { centerWeight: 0 });
  const centered = buildHistogram(buffer, 8, 8, { centerWeight: 1 });
  assert.notDeepEqual(
    Array.from(uniform.bins),
    Array.from(centered.bins),
  );
  assert.equal(uniform.totalWeight, 64);
  assert.ok(centered.totalWeight > 0 && centered.totalWeight <= 64);
});

test('percentile outside (0, 100] throws', () => {
  const histogram = buildHistogram(solidBuffer(2, 2, 0.2), 2, 2);
  assert.throws(() => percentileLuminance(histogram, 0), RangeError);
  assert.throws(() => percentileLuminance(histogram, 101), RangeError);
});
