const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { filterProducts } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;

const productsPath = path.join(__dirname, 'data', 'products.json');
const ordersPath = path.join(__dirname, 'data', 'orders.json');

function readJson(filePath, fallback = []) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'simple-shop' });
});

app.get('/ready', (_req, res) => {
  // Keep readiness aligned with liveness so rollouts are not blocked by
  // empty/missing products.json on fresh containers.
  return res.json({ status: 'ready', service: 'simple-shop' });
});

app.get('/api/products', (req, res) => {
  const products = readJson(productsPath);
  res.json(filterProducts(products, req.query));
});

app.get('/api/products/:id', (req, res) => {
  const products = readJson(productsPath);
  const product = products.find((p) => p.id === parseInt(req.params.id, 10));

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json(product);
});

app.post('/api/orders', (req, res) => {
  const { items, customer } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  if (!customer || !customer.name || !customer.email || !customer.address) {
    return res.status(400).json({
      error: 'Please provide name, email, and shipping address',
    });
  }

  const products = readJson(productsPath);
  const orderItems = [];
  let total = 0;

  for (const item of items) {
    const product = products.find((p) => p.id === item.id);
    if (!product) {
      return res.status(400).json({ error: `Product ${item.id} not found` });
    }

    const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
    orderItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity,
      subtotal: +(product.price * quantity).toFixed(2),
    });
    total += product.price * quantity;
  }

  const order = {
    id: Date.now(),
    items: orderItems,
    customer: {
      name: customer.name.trim(),
      email: customer.email.trim(),
      address: customer.address.trim(),
    },
    total: +total.toFixed(2),
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };

  const orders = readJson(ordersPath);
  orders.push(order);
  writeJson(ordersPath, orders);

  res.status(201).json(order);
});

app.get('/api/orders', (_req, res) => {
  res.json(readJson(ordersPath));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Simple Shop running at http://localhost:${PORT}`);
  });
}

module.exports = app;
