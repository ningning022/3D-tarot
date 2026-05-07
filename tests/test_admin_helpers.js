const assert = require('assert');
const {
  createNotesKey,
  filterReadings,
  getDashboardStats,
  serializeReadingExport
} = require('../js/admin_helpers.js');

const readings = [
  {
    id: 1,
    kind: 'spread',
    templateName: 'Three Card Insight',
    createdAt: '2026-05-06T10:00:00Z',
    cards: [
      { en: 'The Moon', zh: '月亮', slotLabel: 'Past', imageFile: 'moon.jpg' },
      { en: 'The Star', zh: '星星', slotLabel: 'Future', imageFile: 'star.jpg' }
    ]
  },
  {
    id: 2,
    kind: 'daily',
    templateName: 'Daily Draw',
    createdAt: '2026-05-05T10:00:00Z',
    cards: [{ en: 'The Sun', zh: '太阳', slotLabel: 'Daily', imageFile: 'sun.jpg' }]
  }
];

assert.strictEqual(createNotesKey(42), 'akashic-admin-note-42');

assert.deepStrictEqual(
  filterReadings(readings, 'moon').map(reading => reading.id),
  [1]
);
assert.deepStrictEqual(
  filterReadings(readings, 'daily').map(reading => reading.id),
  [2]
);
assert.deepStrictEqual(
  filterReadings(readings, '星').map(reading => reading.id),
  [1]
);
assert.deepStrictEqual(filterReadings(readings, '').map(reading => reading.id), [1, 2]);

assert.deepStrictEqual(getDashboardStats(readings), {
  totalReadings: 2,
  totalCards: 3,
  spreadReadings: 1,
  dailyReadings: 1,
  latestCreatedAt: '2026-05-06T10:00:00Z'
});

const exported = serializeReadingExport(readings[0], 'Local note');
assert.strictEqual(exported.id, 1);
assert.strictEqual(exported.notes, 'Local note');
assert.strictEqual(exported.cards.length, 2);
assert.strictEqual(exported.exportedBy, 'Akashic Tarot');

console.log('admin helper tests passed');
