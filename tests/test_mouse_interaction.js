const assert = require('assert');
const { resolveMouseCardAction } = require('../js/mouse_interaction.js');

assert.strictEqual(
  resolveMouseCardAction({ phase: 'idle', selectedIdleIds: [] }, 'card-a'),
  'SELECT_IDLE_CARD'
);
assert.strictEqual(
  resolveMouseCardAction({ phase: 'idle', selectedIdleIds: ['card-a'] }, 'card-a'),
  'UNSELECT_IDLE_CARD'
);
assert.strictEqual(
  resolveMouseCardAction({ phase: 'active', previewedIds: [] }, 'card-a'),
  'PREVIEW_CARD'
);
assert.strictEqual(
  resolveMouseCardAction({ phase: 'active', previewedIds: ['card-a'] }, 'card-a'),
  'UNPREVIEW_CARD'
);
assert.strictEqual(
  resolveMouseCardAction({ phase: 'active', previewedIds: ['card-a'] }, 'card-b'),
  'PREVIEW_CARD'
);
assert.strictEqual(
  resolveMouseCardAction({ phase: 'active', previewedIds: ['card-a', 'card-b'] }, 'card-b'),
  'UNPREVIEW_CARD'
);
assert.strictEqual(
  resolveMouseCardAction({ phase: 'awaiting' }, 'table'),
  'NEXT_SPREAD'
);
assert.strictEqual(resolveMouseCardAction({ phase: 'entering' }, 'card-a'), 'IGNORE');
assert.strictEqual(resolveMouseCardAction({ phase: 'idle' }, null), 'IGNORE');

console.log('mouse interaction tests passed');
