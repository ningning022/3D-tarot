const assert = require('assert');
const {
  getLocalDateString,
  buildDailyReadingPayload
} = require('../js/daily_draw.js');

assert.match(getLocalDateString(new Date('2026-04-25T10:20:30')), /^\d{4}-\d{2}-\d{2}$/);
assert.strictEqual(getLocalDateString(new Date(2026, 3, 5)), '2026-04-05');

const payload = buildDailyReadingPayload({
  date: '2026-04-25',
  cardId: 0,
  card: {
    zh: '愚人',
    en: 'The Fool',
    file: 'RWS_Tarot_00_Fool.jpg'
  },
  isReversed: true
});

assert.strictEqual(payload.kind, 'daily');
assert.strictEqual(payload.templateKey, 'daily_draw');
assert.strictEqual(payload.templateName, '每日一牌 / Daily Draw');
assert.strictEqual(payload.readingDate, '2026-04-25');
assert.strictEqual(payload.spreadNumber, 0);
assert.strictEqual(payload.cards.length, 1);
assert.strictEqual(payload.cards[0].slotLabel, '今日牌 / Daily Card');
assert.strictEqual(payload.cards[0].imageFile, 'RWS_Tarot_00_Fool.jpg');
assert.strictEqual(payload.cards[0].isReversed, true);

console.log('daily draw tests passed');
