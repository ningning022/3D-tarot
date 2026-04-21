const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveSelectedOrientation } = require('../js/spread_flow.js');

assert.strictEqual(
  resolveSelectedOrientation({ userData: { isReversed: true } }, () => false),
  true,
  'selected reversed cards should keep their original orientation'
);
assert.strictEqual(
  resolveSelectedOrientation({ userData: { isReversed: false } }, () => true),
  false,
  'selected upright cards should keep their original orientation'
);
assert.strictEqual(
  resolveSelectedOrientation({ userData: {} }, () => 0.25),
  true,
  'cards without orientation should use the random fallback'
);
assert.strictEqual(
  resolveSelectedOrientation({ userData: {} }, () => 0.75),
  false,
  'cards without orientation should use the random fallback'
);

const adminJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
assert(adminJs.includes('admin-card-image reversed'), 'admin detail should rotate reversed card images');
assert(adminJs.includes('admin-card-image upright'), 'admin detail should mark upright card images');

console.log('reading orientation tests passed');
