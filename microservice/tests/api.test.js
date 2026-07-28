const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
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

  it('ignores category=all', () => {
    assert.equal(filterProducts(products, { category: 'all' }).length, 2);
  });
});

describe('simple-shop HTTP API', () => {
  let app;

  before(() => {
    app = require('../server/index');
  });

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('GET /ready returns ready', async () => {
    const res = await request(app).get('/ready');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ready');
  });

  it('GET /api/products returns an array', async () => {
    const res = await request(app).get('/api/products');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it('GET /api/products supports search query', async () => {
    const res = await request(app).get('/api/products').query({ search: 'a' });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it('GET /api/products/:id 404 for missing product', async () => {
    const res = await request(app).get('/api/products/999999');
    assert.equal(res.status, 404);
  });

  it('GET /api/products/:id returns a product when present', async () => {
    const list = await request(app).get('/api/products');
    assert.ok(list.body.length > 0);
    const id = list.body[0].id;
    const res = await request(app).get(`/api/products/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.id, id);
  });

  it('POST /api/orders rejects empty cart', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ items: [], customer: { name: 'A', email: 'a@b.c', address: 'x' } });
    assert.equal(res.status, 400);
  });

  it('POST /api/orders rejects incomplete customer', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ items: [{ id: 1, quantity: 1 }], customer: { name: 'A' } });
    assert.equal(res.status, 400);
  });

  it('POST /api/orders rejects unknown product id', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({
        items: [{ id: 999999, quantity: 1 }],
        customer: { name: 'A', email: 'a@b.c', address: 'street 1' },
      });
    assert.equal(res.status, 400);
  });

  it('POST /api/orders creates an order for a valid product', async () => {
    const list = await request(app).get('/api/products');
    const product = list.body[0];
    const res = await request(app)
      .post('/api/orders')
      .send({
        items: [{ id: product.id, quantity: 2 }],
        customer: { name: 'Ada', email: 'ada@example.com', address: '12 Lab St' },
      });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'confirmed');
    assert.ok(res.body.total > 0);
  });

  it('GET /api/orders returns an array', async () => {
    const res = await request(app).get('/api/orders');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});
