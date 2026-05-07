const assert = require('assert');
const {
  getPreferredMode,
  setPreferredMode,
  createMemoryStorage,
  mapMouseEventToGesture,
  mapMouseEventToAction,
  mapKeyEventToAction,
  applyKeyboardAction
} = require('../js/input_mode.js');

const storage = createMemoryStorage();

assert.strictEqual(getPreferredMode('?control=mouse', storage), 'mouse');
assert.strictEqual(getPreferredMode('?control=camera', storage), 'camera');

setPreferredMode('camera', storage);
assert.strictEqual(getPreferredMode('', storage), 'camera');
assert.strictEqual(getPreferredMode('?control=mouse', storage), 'mouse');

setPreferredMode('mouse', storage);
assert.strictEqual(getPreferredMode('', storage), 'mouse');

assert.strictEqual(mapMouseEventToGesture('mousedown'), 'PINCH');
assert.strictEqual(mapMouseEventToGesture('mouseup'), 'OPEN');
assert.strictEqual(mapMouseEventToGesture('mouseleave'), 'NONE');
assert.strictEqual(mapMouseEventToGesture('click'), null);

assert.strictEqual(mapMouseEventToAction('click'), 'SELECT_CARD');
assert.strictEqual(mapMouseEventToAction('mousedown'), null);
assert.strictEqual(mapMouseEventToAction('mouseup'), null);

assert.strictEqual(mapKeyEventToAction({ code: 'Space', type: 'keydown' }), 'CONFIRM');
assert.strictEqual(mapKeyEventToAction({ code: 'Escape', type: 'keydown' }), 'CANCEL');
assert.strictEqual(mapKeyEventToAction({ code: 'ArrowLeft', type: 'keydown' }), 'ROTATE_LEFT');
assert.strictEqual(mapKeyEventToAction({ code: 'KeyA', type: 'keydown' }), 'ROTATE_LEFT');
assert.strictEqual(mapKeyEventToAction({ code: 'ArrowRight', type: 'keydown' }), 'ROTATE_RIGHT');
assert.strictEqual(mapKeyEventToAction({ code: 'KeyD', type: 'keydown' }), 'ROTATE_RIGHT');
assert.strictEqual(mapKeyEventToAction({ code: 'Space', type: 'keyup' }), 'RELEASE_CONFIRM');
assert.strictEqual(mapKeyEventToAction({ code: 'KeyW', type: 'keydown' }), null);

const state = {
  currentGesture: 'PINCH',
  carouselVelocity: 0
};
applyKeyboardAction(state, 'CONFIRM');
assert.strictEqual(state.currentGesture, 'FIST');
applyKeyboardAction(state, 'RELEASE_CONFIRM');
assert.strictEqual(state.currentGesture, 'NONE');
applyKeyboardAction(state, 'ROTATE_LEFT');
assert(state.carouselVelocity < 0);
applyKeyboardAction(state, 'ROTATE_RIGHT');
assert(Math.abs(state.carouselVelocity) < 1e-9);

console.log('input mode tests passed');
