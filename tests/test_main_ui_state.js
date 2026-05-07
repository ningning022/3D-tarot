const assert = require('assert');
const { getPrimaryActionState, canChangeSpread } = require('../js/main_ui_state.js');

assert.deepStrictEqual(getPrimaryActionState('IDLE'), {
  label: '新占卜 / New',
  disabled: false,
  intent: 'START_READING'
});

assert.deepStrictEqual(getPrimaryActionState('AWAITING'), {
  label: '下一阵 / Next',
  disabled: false,
  intent: 'NEXT_SPREAD'
});

assert.deepStrictEqual(getPrimaryActionState('ACTIVE'), {
  label: '进行中 / Busy',
  disabled: true,
  intent: 'SHOW_BUSY'
});

assert.strictEqual(canChangeSpread('IDLE'), true);
assert.strictEqual(canChangeSpread('ACTIVE'), false);
assert.strictEqual(canChangeSpread('AWAITING'), false);

console.log('main ui state tests passed');
