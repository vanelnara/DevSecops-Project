import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* ignore missing/unreadable env files */
  }
}

loadEnvFile(path.resolve(__dirname, '../.env'));
loadEnvFile(path.resolve(__dirname, '../../.env'));

const {
  JENKINS_DB_HOST = '127.0.0.1',
  JENKINS_DB_PORT = '5432',
  JENKINS_DB_NAME = 'jenkins',
  JENKINS_DB_USER = 'jenkins',
  JENKINS_DB_PASSWORD = 'jenkins',
  DATABASE_URL,
} = process.env;

export const pool = new pg.Pool(
  DATABASE_URL
    ? { connectionString: DATABASE_URL, connectionTimeoutMillis: 3000, idleTimeoutMillis: 5000 }
    : {
        host: JENKINS_DB_HOST,
        port: Number(JENKINS_DB_PORT),
        database: JENKINS_DB_NAME,
        user: JENKINS_DB_USER,
        password: String(JENKINS_DB_PASSWORD ?? 'jenkins'),
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 5000,
      },
);

export async function query(text, params) {
  return pool.query(text, params);
}

export async function dbHealthy() {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
