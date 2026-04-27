const assert = require('assert');
const DeckOrder = require('../js/deck_order.js');

function sortedCopy(values) {
    return [...values].sort((a, b) => a - b);
}

function testSequentialOrder() {
    assert.deepStrictEqual(DeckOrder.createSequentialDeckOrder(5), [0, 1, 2, 3, 4]);
    assert.deepStrictEqual(DeckOrder.createSequentialDeckOrder(0), []);
}

function testShuffledOrderKeepsEveryCard() {
    const values = [0.9, 0.1, 0.8, 0.2, 0.7, 0.3];
    let index = 0;
    const order = DeckOrder.createShuffledDeckOrder(6, () => values[index++ % values.length]);

    assert.deepStrictEqual(sortedCopy(order), [0, 1, 2, 3, 4, 5]);
    assert.notDeepStrictEqual(order, [0, 1, 2, 3, 4, 5]);
}

function testShuffledOrderHandlesEmptyDeck() {
    assert.deepStrictEqual(DeckOrder.createShuffledDeckOrder(0), []);
}

testSequentialOrder();
testShuffledOrderKeepsEveryCard();
testShuffledOrderHandlesEmptyDeck();

console.log('test_deck_order.js passed');
