const assert = require('assert');
const { getPrimaryActionState, canChangeSpread } = require('../js/main_ui_state.js');

assert.deepStrictEqual(getPrimaryActionState('IDLE'), {
  label: '新咨询 / Consult',
  disabled: false,
  intent: 'OPEN_CONSULTATION'
});

assert.deepStrictEqual(getPrimaryActionState('AWAITING'), {
  label: '下一阵 / Next',
  disabled: false,
  intent: 'NEXT_SPREAD'
});

assert.deepStrictEqual(getPrimaryActionState('ACTIVE'), {
  label: '保存 / Save',
  disabled: false,
  intent: 'SAVE_READING'
});

assert.deepStrictEqual(getPrimaryActionState('ENTERING'), {
  label: '保存 / Save',
  disabled: false,
  intent: 'SAVE_READING'
});

assert.strictEqual(canChangeSpread('IDLE'), true);
assert.strictEqual(canChangeSpread('ACTIVE'), false);
assert.strictEqual(canChangeSpread('AWAITING'), false);

console.log('main ui state tests passed');
