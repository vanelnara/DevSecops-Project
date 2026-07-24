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
    ? { connectionString: DATABASE_URL }
    : {
        host: JENKINS_DB_HOST,
        port: Number(JENKINS_DB_PORT),
        database: JENKINS_DB_NAME,
        user: JENKINS_DB_USER,
        password: JENKINS_DB_PASSWORD,
      },
);

export async function query(text, params) {
  return pool.query(text, params);
}
