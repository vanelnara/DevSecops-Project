import pg from 'pg';

const {
  JENKINS_DB_HOST = '127.0.0.1',
  JENKINS_DB_PORT = '5432',
  JENKINS_DB_NAME = 'jenkins',
  JENKINS_DB_USER = 'jenkins',
  JENKINS_DB_PASSWORD = '',
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
        password: JENKINS_DB_PASSWORD,
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
