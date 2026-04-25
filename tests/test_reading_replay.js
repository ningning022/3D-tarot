const assert = require('assert');
const { computeReplayCards, normalizeReadingCards } = require('../js/reading_replay.js');

function makeReading(count) {
  const cards = [];
  for (let index = count; index >= 1; index -= 1) {
    cards.push({
      slot: index,
      cardId: index - 1,
      zh: `牌${index}`,
      en: `Card ${index}`,
      imageFile: `${String(index).padStart(2, '0')}.jpg`,
      isReversed: index % 2 === 0
    });
  }
  return {
    id: 1,
    spreadNumber: 1,
    createdAt: '2026-04-25T00:00:00Z',
    cards
  };
}

assert.deepStrictEqual(normalizeReadingCards(null), []);
assert.deepStrictEqual(computeReplayCards({ cards: [] }), []);

[3, 10, 22].forEach(count => {
  const replay = computeReplayCards(makeReading(count), { viewportWidth: 16, viewportHeight: 9 });
  assert.strictEqual(replay.length, count);
  assert.deepStrictEqual(replay.map(card => card.slot), Array.from({ length: count }, (_, index) => index + 1));

  replay.forEach(card => {
    assert(Number.isFinite(card.x));
    assert(Number.isFinite(card.y));
    assert(Number.isFinite(card.scale));
    assert(Number.isFinite(card.leftPercent));
    assert(Number.isFinite(card.topPercent));
    assert(Number.isFinite(card.widthPercent));
    assert(Number.isFinite(card.heightPercent));
    assert(card.scale > 0);
    assert(card.widthPercent > 0);
    assert(card.heightPercent > 0);
    assert(card.leftPercent - card.widthPercent / 2 >= -1e-6);
    assert(card.leftPercent + card.widthPercent / 2 <= 100 + 1e-6);
    assert(card.topPercent - card.heightPercent / 2 >= -1e-6);
    assert(card.topPercent + card.heightPercent / 2 <= 100 + 1e-6);
    assert(card.imageFile.endsWith('.jpg'));
    assert(['upright', 'reversed'].includes(card.orientationClass));
    assert(card.orientationLabel.includes(card.isReversed ? 'Reversed' : 'Upright'));
  });
});

const ordered = normalizeReadingCards(makeReading(4));
assert.strictEqual(ordered[0].slot, 1);
assert.strictEqual(ordered[1].slot, 2);
assert.strictEqual(ordered[1].isReversed, true);
assert.strictEqual(ordered[1].imageFile, '02.jpg');

console.log('reading replay tests passed');
