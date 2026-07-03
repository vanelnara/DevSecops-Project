const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { filterProducts } = require('../server/utils');

describe('filterProducts', () => {
  const products = [
    { id: 1, name: 'Laptop', category: 'Electronics', description: 'Fast laptop' },
    { id: 2, name: 'Shirt', category: 'Clothing', description: 'Cotton shirt' },
  ];

  it('filters by category', () => {
    const result = filterProducts(products, { category: 'clothing' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Shirt');
  });

  it('filters by search term', () => {
    const result = filterProducts(products, { search: 'laptop' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 1);
  });

  it('returns all when no filters', () => {
    assert.equal(filterProducts(products, {}).length, 2);
  });
});
