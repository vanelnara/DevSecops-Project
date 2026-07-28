/**
 * Start a local embedded PostgreSQL for dashboard user accounts.
 *
 * Usage:
 *   node scripts/start-embedded-postgres.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dashDir = path.join(root, 'security-dashboard');
const dataDir = path.join(root, '.pgdata-local');
const port = Number(process.env.PG_PORT || 5432);
const require = createRequire(path.join(dashDir, 'package.json'));

async function run(cmd, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed: ${code}`))));
  });
}

async function ensurePackage() {
  const pkg = path.join(dashDir, 'node_modules', 'embedded-postgres');
  if (!fs.existsSync(pkg)) {
    console.log('Installing embedded-postgres...');
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'install',
      'embedded-postgres@18.4.0-beta.17',
      '--no-audit',
      '--no-fund',
    ], dashDir);
  }

  const hydrate = path.join(
    dashDir,
    'node_modules',
    '@embedded-postgres',
    'windows-x64',
    'scripts',
    'hydrate-symlinks.js',
  );
  if (fs.existsSync(hydrate)) {
    console.log('Hydrating embedded Postgres binaries...');
    await run(process.execPath, [hydrate], path.dirname(hydrate));
  }
}

async function applySql(client, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query(sql);
  console.log(`Applied ${path.basename(filePath)}`);
}

async function main() {
  await ensurePackage();

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

  const needsInit = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  if (needsInit) {
    console.log('Initializing embedded PostgreSQL data directory...');
    await pg.initialise();
  }

  console.log(`Starting embedded PostgreSQL on 127.0.0.1:${port} ...`);
  await pg.start();

  await pg.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jenkins') THEN
      CREATE ROLE jenkins LOGIN PASSWORD 'jenkins';
    END IF;
  END $$;`);

  try {
    await pg.query(`CREATE DATABASE jenkins OWNER jenkins`);
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
  await applySql(client, path.join(root, 'db', 'migrations', '001_security_dashboard.sql'));
  await applySql(client, path.join(root, 'db', 'migrations', '002_dashboard_users.sql'));
  await client.end();

  console.log('');
  console.log('Embedded PostgreSQL is ready.');
  console.log(`  host=127.0.0.1 port=${port}`);
  console.log('  db=jenkins user=jenkins password=jenkins');
  console.log('Keep this process running. Open Settings in the dashboard to create a user.');
  console.log('Press Ctrl+C to stop.');

  const stop = async () => {
    try { await pg.stop(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
