const assert = require('assert');
const {
  getTemplate,
  setActiveTemplate,
  getActiveTemplate,
  resolveSpreadPlan
} = require('../js/spread_templates.js');

assert.deepStrictEqual(
  getTemplate('three_timeline').slots.map(slot => slot.label),
  ['过去 / Past', '现在 / Present', '未来 / Future']
);

assert.deepStrictEqual(
  getTemplate('five_cross').slots.map(slot => slot.label),
  ['问题 / Issue', '阻碍 / Challenge', '潜意识 / Subconscious', '建议 / Advice', '结果 / Outcome']
);

assert.strictEqual(getTemplate('celtic_cross').slots.length, 10);
assert.strictEqual(getTemplate('free').fixedCount, null);

setActiveTemplate('five_cross');
assert.strictEqual(getActiveTemplate().key, 'five_cross');
setActiveTemplate('unknown-key');
assert.strictEqual(getActiveTemplate().key, 'five_cross');

const selected = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const fixedPlan = resolveSpreadPlan(getTemplate('five_cross'), selected, () => 'random');
assert.deepStrictEqual(fixedPlan.selectedCards, ['a', 'b', 'c', 'd', 'e']);
assert.strictEqual(fixedPlan.totalCards, 5);
assert.strictEqual(fixedPlan.slotLabels[4], '结果 / Outcome');

const underfilledPlan = resolveSpreadPlan(getTemplate('three_timeline'), ['a'], () => 'r');
assert.deepStrictEqual(underfilledPlan.selectedCards, ['a', 'r', 'r']);
assert.strictEqual(underfilledPlan.totalCards, 3);

const freePlan = resolveSpreadPlan(getTemplate('free'), selected, () => 'r');
assert.deepStrictEqual(freePlan.selectedCards, selected);
assert.strictEqual(freePlan.totalCards, selected.length);
assert.strictEqual(freePlan.slotLabels[0], 'Slot 1');

const emptyFreePlan = resolveSpreadPlan(getTemplate('free'), [], () => 'r');
assert.deepStrictEqual(emptyFreePlan.selectedCards, ['r', 'r', 'r']);
assert.strictEqual(emptyFreePlan.totalCards, 3);

console.log('spread template tests passed');
