const assert = require('assert');
const { computeSpreadLayout } = require('../js/spread_layout.js');
const { createEnteringSnapshot, shouldBeginEntering } = require('../js/spread_flow.js');

function rectFor(card, cardWidth = 2.1, cardHeight = 3.7) {
  const halfW = (cardWidth * card.scale) / 2;
  const halfH = (cardHeight * card.scale) / 2;
  return {
    left: card.x - halfW,
    right: card.x + halfW,
    top: card.y + halfH,
    bottom: card.y - halfH
  };
}

function assertWithinBounds(layout, options) {
  const maxX = (options.viewportWidth * 0.86) / 2;
  const maxY = (options.viewportHeight * 0.76) / 2;
  layout.forEach(card => {
    assert(Number.isFinite(card.x));
    assert(Number.isFinite(card.y));
    assert(Number.isFinite(card.scale));
    assert(card.scale > 0);
    const rect = rectFor(card);
    assert(rect.left >= -maxX - 1e-6, `left bound failed: ${rect.left} < ${-maxX}`);
    assert(rect.right <= maxX + 1e-6, `right bound failed: ${rect.right} > ${maxX}`);
    assert(rect.bottom >= -maxY - 1e-6, `bottom bound failed: ${rect.bottom} < ${-maxY}`);
    assert(rect.top <= maxY + 1e-6, `top bound failed: ${rect.top} > ${maxY}`);
  });
}

function assertNoOverlap(layout) {
  const rects = layout.map(card => rectFor(card));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlaps = a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;
      assert(!overlaps, `cards ${i} and ${j} overlap`);
    }
  }
}

const desktop = { viewportWidth: 16, viewportHeight: 9 };
[1, 3, 4, 7, 10, 13, 22, 78].forEach(count => {
  const layout = computeSpreadLayout(count, desktop);
  assert.strictEqual(layout.length, count);
  assertWithinBounds(layout, desktop);
  assertNoOverlap(layout);
});

const three = computeSpreadLayout(3, desktop);
assert(three.every(card => Math.abs(card.y) < 1e-6), '1-3 cards should stay in one centered row');
assert(three[0].x < three[1].x && three[1].x < three[2].x);

const narrowFour = computeSpreadLayout(4, { viewportWidth: 5.2, viewportHeight: 9.2 });
assert(new Set(narrowFour.map(card => card.y.toFixed(4))).size > 1, '4 cards should wrap on narrow screens');

[
  { viewportWidth: 8, viewportHeight: 12 },
  { viewportWidth: 5.2, viewportHeight: 9.2 },
  { viewportWidth: 3.5, viewportHeight: 7.5 }
].forEach(options => {
  [4, 13, 78].forEach(count => {
    const layout = computeSpreadLayout(count, options);
    assertWithinBounds(layout, options);
    assertNoOverlap(layout);
  });
});

assert(shouldBeginEntering('IDLE', 'OPEN', 2000, 1000));
assert(!shouldBeginEntering('ENTERING', 'OPEN', 2000, 1000));
assert(!shouldBeginEntering('IDLE', 'NONE', 2000, 1000));

const cardA = { id: 'a' };
const cardB = { id: 'b' };
const snapshot = createEnteringSnapshot([cardA, cardB, cardA]);
assert.deepStrictEqual(snapshot, [cardA, cardB]);

console.log('spread layout tests passed');
