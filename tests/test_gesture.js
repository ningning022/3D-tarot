const assert = require('assert');
const {
  classifyGesture,
  createGestureStabilizer,
  gateGestureForState
} = require('../js/gesture.js');

function point(x, y) {
  return { x, y };
}

function baseHand() {
  const lm = Array.from({ length: 21 }, () => point(0.5, 0.5));
  lm[0] = point(0.50, 0.90);
  lm[5] = point(0.38, 0.62);
  lm[9] = point(0.50, 0.58);
  lm[13] = point(0.60, 0.62);
  lm[17] = point(0.70, 0.66);
  lm[4] = point(0.32, 0.55);
  return lm;
}

function setFinger(lm, tip, pip, extended) {
  lm[pip] = point(lm[pip].x, 0.50);
  lm[tip] = point(lm[pip].x, extended ? 0.26 : 0.72);
}

function handFor(gesture) {
  const lm = baseHand();
  setFinger(lm, 8, 6, false);
  setFinger(lm, 12, 10, false);
  setFinger(lm, 16, 14, false);
  setFinger(lm, 20, 18, false);

  if (gesture === 'OPEN') {
    [8, 12, 16, 20].forEach((tip, i) => setFinger(lm, tip, [6, 10, 14, 18][i], true));
    lm[4] = point(0.28, 0.46);
  }
  if (gesture === 'POINT') {
    setFinger(lm, 8, 6, true);
    lm[4] = point(0.30, 0.55);
  }
  if (gesture === 'PINCH') {
    setFinger(lm, 8, 6, true);
    lm[4] = point(lm[8].x + 0.025, lm[8].y + 0.015);
  }
  if (gesture === 'BENT_PINCH') {
    setFinger(lm, 8, 6, false);
    lm[4] = point(lm[8].x + 0.018, lm[8].y + 0.012);
  }
  // NATURAL_PINCH: the "I'm pinching with my hand naturally relaxed"
  // gesture users actually make — index curled in, other fingers also
  // curled (i.e. allFolded), thumb tip ~1cm from index tip. Previous
  // classifier routed this to FIST; it must now register as PINCH.
  if (gesture === 'NATURAL_PINCH') {
    setFinger(lm, 8, 6, false);
    lm[4] = point(lm[8].x + 0.05, lm[8].y + 0.04);
  }
  // LOOSE_FIST: closed hand with thumb tucked across the palm, away from
  // the index. Must still register as FIST (sanity check that we didn't
  // accidentally route every closed hand to PINCH).
  if (gesture === 'LOOSE_FIST') {
    setFinger(lm, 8, 6, false);
    lm[4] = point(0.18, 0.65);
  }
  if (gesture === 'TWO_FINGER') {
    setFinger(lm, 8, 6, true);
    setFinger(lm, 12, 10, true);
    lm[12] = point(lm[8].x + 0.035, lm[8].y + 0.01);
    lm[4] = point(0.30, 0.55);
  }

  return lm;
}

assert.strictEqual(classifyGesture(null).gesture, 'NONE');
assert.strictEqual(classifyGesture(handFor('PINCH')).gesture, 'PINCH');
assert.strictEqual(classifyGesture(handFor('BENT_PINCH')).gesture, 'PINCH');
assert.strictEqual(classifyGesture(handFor('NATURAL_PINCH')).gesture, 'PINCH');
assert.strictEqual(classifyGesture(handFor('LOOSE_FIST')).gesture, 'FIST');
assert.strictEqual(classifyGesture(handFor('OPEN')).gesture, 'OPEN');
assert.strictEqual(classifyGesture(handFor('POINT')).gesture, 'POINT');
assert.strictEqual(classifyGesture(handFor('TWO_FINGER')).gesture, 'TWO_FINGER');

assert.strictEqual(gateGestureForState('POINT', 'ACTIVE'), 'NONE');
assert.strictEqual(gateGestureForState('FIST', 'AWAITING'), 'FIST');

const stable = createGestureStabilizer({ windowSize: 5, minCount: 3, noneCount: 2 });
for (let i = 0; i < 2; i += 1) {
  assert.strictEqual(stable.update({ gesture: 'PINCH', confidence: 0.9 }, 'IDLE'), 'NONE');
}
assert.strictEqual(stable.update({ gesture: 'PINCH', confidence: 0.9 }, 'IDLE'), 'PINCH');
assert.strictEqual(stable.update({ gesture: 'NONE', confidence: 1 }, 'IDLE'), 'PINCH');
assert.strictEqual(stable.update({ gesture: 'NONE', confidence: 1 }, 'IDLE'), 'NONE');

const borderConfidence = createGestureStabilizer({ windowSize: 5, minCount: 3, noneCount: 2, confidenceThreshold: 0.5 });
for (let i = 0; i < 3; i += 1) {
  borderConfidence.update({ gesture: 'PINCH', confidence: 0.52 }, 'IDLE');
}
assert.strictEqual(borderConfidence.current, 'PINCH');

const practicalDefault = createGestureStabilizer();
for (let i = 0; i < 3; i += 1) {
  practicalDefault.update({ gesture: 'PINCH', confidence: 0.52 }, 'IDLE');
}
assert.strictEqual(practicalDefault.current, 'PINCH');

const gated = createGestureStabilizer({ windowSize: 5, minCount: 3, noneCount: 2 });
for (let i = 0; i < 6; i += 1) {
  assert.strictEqual(gated.update({ gesture: 'POINT', confidence: 0.9 }, 'ACTIVE'), 'NONE');
}

console.log('gesture tests passed');
