import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const dashDir = path.join(projectRoot, 'security-dashboard');
const dataDir = path.join(projectRoot, '.pgdata-local-5433');
const port = Number(process.env.PG_PORT || 5433);
const require = createRequire(path.join(dashDir, 'package.json'));

const EmbeddedPostgresMod = await import(
  pathToFileURL(path.join(dashDir, 'node_modules', 'embedded-postgres', 'dist', 'index.js')).href
);
const EmbeddedPostgres = EmbeddedPostgresMod.default || EmbeddedPostgresMod;
const { Client } = require('pg');

fs.mkdirSync(dataDir, { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8'],
});

if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
  console.log('Initializing embedded PostgreSQL...');
  await pg.initialise();
}

console.log(`Starting embedded PostgreSQL on 127.0.0.1:${port}...`);
await pg.start();

async function adminQuery(sql) {
  const client = new Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

await adminQuery(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jenkins') THEN
      CREATE ROLE jenkins LOGIN PASSWORD 'jenkins';
    END IF;
  END $$;
`);

try {
  await adminQuery('CREATE DATABASE jenkins OWNER jenkins');
  console.log('Created database jenkins');
} catch (error) {
  if (!/already exists/i.test(error.message)) throw error;
  console.log('Database jenkins already exists');
}

const client = new Client({
  host: '127.0.0.1',
  port,
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
  const full = path.join(projectRoot, 'db', 'migrations', file);
  if (!fs.existsSync(full)) continue;
  await client.query(fs.readFileSync(full, 'utf8'));
  console.log(`Applied ${file}`);
}
await client.end();

console.log(`Embedded PostgreSQL is ready on 127.0.0.1:${port}`);
console.log('Keep this process running.');

const stop = async () => {
  try { await pg.stop(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
