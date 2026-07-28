import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'security-dashboard', 'package.json'));
const { Client } = require('pg');

async function main() {
  const admin = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  });
  await admin.connect();
  console.log('PG UP');
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jenkins') THEN
        CREATE ROLE jenkins LOGIN PASSWORD 'jenkins';
      END IF;
    END $$;
  `);
  try {
    await admin.query('CREATE DATABASE jenkins OWNER jenkins');
    console.log('Created jenkins db');
  } catch (error) {
    console.log('DB note:', error.message);
  }
  await admin.end();

  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'jenkins',
    password: 'jenkins',
    database: 'jenkins',
  });
  await client.connect();
  for (const file of [
    '001_security_dashboard.sql',
    '002_dashboard_users.sql',
    '003_must_change_password.sql',
  ]) {
    const full = path.join(root, 'db', 'migrations', file);
    if (!fs.existsSync(full)) continue;
    await client.query(fs.readFileSync(full, 'utf8'));
    console.log('Applied', file);
  }
  await client.end();
  console.log('Migrations done');
}

main().catch((error) => {
  console.error('SETUP FAILED:', error.message);
  process.exit(1);
});
