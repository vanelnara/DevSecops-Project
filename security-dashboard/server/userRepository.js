import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from './db.js';

const SESSION_DAYS = 14;
const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    themePreference: row.theme_preference,
    createdAt: row.created_at,
  };
}

export async function ensureUserSchema() {
  // Security findings table must exist before per-user finding state FK.
  await query(`
    CREATE TABLE IF NOT EXISTS findings (
      id            SERIAL PRIMARY KEY,
      job_name      TEXT NOT NULL,
      build_number  INTEGER NOT NULL,
      finding_key   TEXT NOT NULL,
      severity      TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      title         TEXT NOT NULL,
      source        TEXT NOT NULL,
      asset         TEXT,
      status        TEXT NOT NULL DEFAULT 'open',
      confidence    INTEGER DEFAULT 90,
      raw           JSONB DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (job_name, build_number, finding_key, source)
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard_users (
      id               SERIAL PRIMARY KEY,
      username         TEXT NOT NULL UNIQUE,
      email            TEXT NOT NULL UNIQUE,
      password_hash    TEXT NOT NULL,
      display_name     TEXT NOT NULL,
      theme_preference TEXT NOT NULL DEFAULT 'system'
                       CHECK (theme_preference IN ('system', 'dark', 'light')),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard_sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS user_finding_states (
      user_id     INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
      finding_id  INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
      status      TEXT NOT NULL
                  CHECK (status IN ('open', 'triage', 'in-progress', 'accepted', 'resolved', 'false-positive')),
      notes       TEXT DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, finding_id)
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS user_chat_messages (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
      job_name      TEXT,
      build_number  INTEGER,
      role          TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content       TEXT NOT NULL,
      meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS user_activity (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
      action     TEXT NOT NULL,
      details    JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function recordActivity(userId, action, details = {}) {
  await query(
    `INSERT INTO user_activity (user_id, action, details) VALUES ($1, $2, $3::jsonb)`,
    [userId, action, JSON.stringify(details)],
  );
}

export async function createUser({ username, email, password, displayName, themePreference = 'system' }) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanDisplay = String(displayName || username || '').trim();
  const cleanPassword = String(password || '');
  const theme = ['system', 'dark', 'light'].includes(themePreference) ? themePreference : 'system';

  if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
    throw new Error('Username must be 3–32 chars: letters, numbers, . _ -');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('A valid email is required');
  }
  if (cleanPassword.length < 5) {
    throw new Error('Password must be at least 5 characters');
  }
  if (!cleanDisplay) {
    throw new Error('Display name is required');
  }

  const passwordHash = hashPassword(cleanPassword);
  try {
    const result = await query(
      `INSERT INTO dashboard_users (username, email, password_hash, display_name, theme_preference)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [cleanUsername, cleanEmail, passwordHash, cleanDisplay, theme],
    );
    const user = publicUser(result.rows[0]);
    await recordActivity(user.id, 'user.created', { username: user.username });
    return user;
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Username or email already exists');
    }
    throw error;
  }
}

export async function authenticateUser(login, password) {
  const identity = String(login || '').trim().toLowerCase();
  const result = await query(
    `SELECT * FROM dashboard_users
     WHERE username = $1 OR email = $1
     LIMIT 1`,
    [identity],
  );
  const row = result.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new Error('Invalid username/email or password');
  }
  return publicUser(row);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO dashboard_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, userId, expires.toISOString()],
  );
  await recordActivity(userId, 'user.login', {});
  return { token, expiresAt: expires.toISOString() };
}

export async function destroySession(token) {
  if (!token) return;
  const existing = await query(`SELECT user_id FROM dashboard_sessions WHERE token = $1`, [token]);
  await query(`DELETE FROM dashboard_sessions WHERE token = $1`, [token]);
  if (existing.rows[0]?.user_id) {
    await recordActivity(existing.rows[0].user_id, 'user.logout', {});
  }
}

export async function getUserBySession(token) {
  if (!token) return null;
  const result = await query(
    `SELECT u.*
     FROM dashboard_sessions s
     JOIN dashboard_users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token],
  );
  return publicUser(result.rows[0]);
}

export async function ensureDefaultAdmin() {
  await ensureUserSchema();
  const existing = await query(`SELECT * FROM dashboard_users WHERE username = 'admin' LIMIT 1`);
  if (existing.rows[0]) return publicUser(existing.rows[0]);

  const passwordHash = hashPassword('admin');
  const result = await query(
    `INSERT INTO dashboard_users (username, email, password_hash, display_name, theme_preference)
     VALUES ('admin', 'admin@sentinelops.local', $1, 'Administrator', 'system')
     ON CONFLICT (username) DO NOTHING
     RETURNING *`,
    [passwordHash],
  );
  if (result.rows[0]) {
    await recordActivity(result.rows[0].id, 'user.created', { username: 'admin', seeded: true });
    return publicUser(result.rows[0]);
  }
  return null;
}

export async function changeCredentials(userId, {
  currentUsername,
  currentPassword,
  newUsername,
  confirmNewUsername,
  newPassword,
  confirmNewPassword,
}) {
  const current = await query(`SELECT * FROM dashboard_users WHERE id = $1`, [userId]);
  const row = current.rows[0];
  if (!row) throw new Error('User not found');

  const oldUsername = String(currentUsername || '').trim().toLowerCase();
  const nextUsername = String(newUsername || '').trim().toLowerCase();
  const confirmUsername = String(confirmNewUsername || '').trim().toLowerCase();
  const nextPassword = String(newPassword || '');
  const confirmPassword = String(confirmNewPassword || '');

  if (oldUsername !== String(row.username).toLowerCase()) {
    throw new Error('Current username does not match this account');
  }
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw new Error('Current password is incorrect');
  }
  if (!nextUsername || !confirmUsername) {
    throw new Error('Enter the new username twice');
  }
  if (nextUsername !== confirmUsername) {
    throw new Error('New username fields do not match');
  }
  if (!/^[a-z0-9._-]{3,32}$/.test(nextUsername)) {
    throw new Error('New username must be 3–32 chars: letters, numbers, . _ -');
  }
  if (!nextPassword || !confirmPassword) {
    throw new Error('Enter the new password twice');
  }
  if (nextPassword !== confirmPassword) {
    throw new Error('New password fields do not match');
  }
  if (nextPassword.length < 5) {
    throw new Error('New password must be at least 5 characters');
  }

  const passwordHash = hashPassword(nextPassword);
  try {
    const result = await query(
      `UPDATE dashboard_users
       SET username = $1,
           password_hash = $2,
           display_name = CASE
             WHEN lower(display_name) IN (lower($3), 'administrator') THEN $1
             ELSE display_name
           END,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [nextUsername, passwordHash, row.username, userId],
    );
    await recordActivity(userId, 'user.credentials_changed', {
      from: row.username,
      to: nextUsername,
    });
    return publicUser(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('That username is already taken');
    }
    throw error;
  }
}

export async function updateUserPreferences(userId, { themePreference, displayName }) {
  const sets = [];
  const params = [];
  if (themePreference) {
    if (!['system', 'dark', 'light'].includes(themePreference)) {
      throw new Error('Invalid theme preference');
    }
    params.push(themePreference);
    sets.push(`theme_preference = $${params.length}`);
  }
  if (displayName !== undefined) {
    const name = String(displayName || '').trim();
    if (!name) throw new Error('Display name cannot be empty');
    params.push(name);
    sets.push(`display_name = $${params.length}`);
  }
  if (!sets.length) {
    const current = await query(`SELECT * FROM dashboard_users WHERE id = $1`, [userId]);
    return publicUser(current.rows[0]);
  }
  params.push(userId);
  const result = await query(
    `UPDATE dashboard_users
     SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING *`,
    params,
  );
  await recordActivity(userId, 'user.preferences_updated', { themePreference, displayName });
  return publicUser(result.rows[0]);
}

export async function upsertUserFindingStatus(userId, findingId, status, notes = '') {
  const allowed = new Set(['open', 'triage', 'in-progress', 'accepted', 'resolved', 'false-positive']);
  if (!allowed.has(status)) throw new Error(`Invalid status: ${status}`);
  await query(
    `INSERT INTO user_finding_states (user_id, finding_id, status, notes, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, finding_id) DO UPDATE SET
       status = EXCLUDED.status,
       notes = EXCLUDED.notes,
       updated_at = NOW()`,
    [userId, findingId, status, notes || ''],
  );
  await recordActivity(userId, 'finding.status_updated', { findingId, status });
}

export async function listUserFindingStates(userId) {
  const result = await query(
    `SELECT finding_id, status, notes, updated_at
     FROM user_finding_states
     WHERE user_id = $1`,
    [userId],
  );
  return result.rows;
}

export async function saveChatMessage(userId, { role, content, jobName, buildNumber, meta = {} }) {
  const result = await query(
    `INSERT INTO user_chat_messages (user_id, job_name, build_number, role, content, meta)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, role, content, job_name, build_number, meta, created_at`,
    [userId, jobName || null, buildNumber || null, role, content, JSON.stringify(meta)],
  );
  return result.rows[0];
}

export async function listChatMessages(userId, { jobName, buildNumber, limit = 50 } = {}) {
  const params = [userId];
  let sql = `
    SELECT id, role, content, job_name, build_number, meta, created_at
    FROM user_chat_messages
    WHERE user_id = $1
  `;
  if (jobName) {
    params.push(jobName);
    sql += ` AND job_name = $${params.length}`;
  }
  if (buildNumber) {
    params.push(Number(buildNumber));
    sql += ` AND build_number = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 50, 200));
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const result = await query(sql, params);
  return result.rows.reverse();
}

export async function listUserActivity(userId, limit = 30) {
  const result = await query(
    `SELECT id, action, details, created_at
     FROM user_activity
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.min(Number(limit) || 30, 100)],
  );
  return result.rows;
}

export function parseCookies(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return acc;
      acc[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
      return acc;
    }, {});
}

export function sessionCookie(token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `sentinelops_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return 'sentinelops_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export function fingerprint(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}
