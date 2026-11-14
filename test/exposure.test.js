import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistogram,
  computeExposure,
  ExposureController,
} from '../src/index.js';
import { solidBuffer, blackBuffer } from './helpers.js';

test('computeExposure returns log2(luminance / target) for bright frames', () => {
  const histogram = buildHistogram(solidBuffer(8, 8, 0.5), 8, 8);
  const ev = computeExposure(histogram);
  const expected = Math.log2(0.5 / 0.18);
  assert.ok(Math.abs(ev - expected) < 0.2);
  assert.ok(ev > 0);
});

test('dark frames produce negative exposure values', () => {
  const histogram = buildHistogram(solidBuffer(8, 8, 0.01), 8, 8);
  const ev = computeExposure(histogram);
  assert.ok(ev < 0);
});

test('all-black frame measures as null exposure', () => {
  const histogram = buildHistogram(blackBuffer(4, 4), 4, 4);
  assert.equal(computeExposure(histogram), null);
});

test('first frame snaps to target when rate limiting is not applied', () => {
  const controller = new ExposureController(
    {},
    { maxEVIncrease: 0.5, maxEVDecrease: 0.5 },
  );
  const histogram = buildHistogram(solidBuffer(4, 4, 2.0), 4, 4);
  const status = controller.update(histogram);
  assert.equal(status.ev, status.targetEV);
  assert.equal(status.converged, true);
});

test('EV increase is slew limited and eventually converges', () => {
  const controller = new ExposureController(
    {},
    { maxEVIncrease: 0.5, maxEVDecrease: 1, limitFirstFrame: true },
  );
  const bright = buildHistogram(solidBuffer(4, 4, 2.0), 4, 4);
  let previous = controller.currentEV;
  let convergedFrame = -1;
  for (let frame = 1; frame <= 12; frame++) {
    const status = controller.update(bright);
    assert.ok(status.ev - previous <= 0.5 + 1e-9);
    if (status.converged && convergedFrame === -1) {
      convergedFrame = frame;
    }
    previous = status.ev;
  }
  assert.ok(convergedFrame > 1);
  assert.equal(controller.currentEV, controller.targetEV);
});

test('EV decrease follows the configured slower/faster limit', () => {
  const controller = new ExposureController(
    {},
    { maxEVIncrease: 0.5, maxEVDecrease: 1, limitFirstFrame: true },
  );
  const dark = buildHistogram(solidBuffer(4, 4, 0.005), 4, 4);
  let previous = controller.currentEV;
  for (let frame = 0; frame < 6; frame++) {
    const status = controller.update(dark);
    assert.ok(previous - status.ev <= 1 + 1e-9);
    previous = status.ev;
  }
});

test('black frames hold exposure instead of spiking gain', () => {
  const controller = new ExposureController();
  const black = buildHistogram(blackBuffer(4, 4), 4, 4);
  const first = controller.update(black);
  const second = controller.update(black);
  assert.equal(first.held, true);
  assert.equal(first.blackFrame, true);
  assert.equal(second.ev, first.ev);
});

test('reset restores initial EV and frame count', () => {
  const controller = new ExposureController(
    {},
    { initialEV: 2 },
  );
  controller.update(
    buildHistogram(solidBuffer(4, 4, 1), 4, 4),
  );
  controller.reset();
  assert.equal(controller.currentEV, 2);
  assert.equal(controller.frameCount, 0);
});

test('non-positive slew limits are rejected', () => {
  assert.throws(
    () => new ExposureController({}, { maxEVIncrease: 0 }),
    RangeError,
  );
  assert.throws(
    () => new ExposureController({}, { maxEVDecrease: -1 }),
    RangeError,
  );
});
