import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbHealthy } from './db.js';
import {
  buildDashboardPayload,
  emptyDashboardPayload,
  getBuildDetail,
  getFindingById,
  listActivity,
  listBuilds,
  listFindings,
  updateFindingStatus,
} from './dashboardRepository.js';
import {
  authenticateUser,
  clearSessionCookie,
  createSession,
  changeCredentials,
  createUser,
  destroySession,
  ensureDefaultAdmin,
  ensureUserSchema,
  getUserBySession,
  listChatMessages,
  listUserActivity,
  parseCookies,
  saveChatMessage,
  sessionCookie,
  updateUserPreferences,
} from './userRepository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
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
  } catch (error) {
    console.warn(`Unable to load env file ${filePath}: ${error.message}`);
  }
}

loadEnvFile(path.resolve(__dirname, '../.env'));
loadEnvFile(path.resolve(__dirname, '../../.env'));

const app = express();
const port = Number(process.env.DASHBOARD_API_PORT || 4100);
const aiUrl = process.env.AI_ANALYZER_URL || 'http://127.0.0.1:4300';

app.use(express.json({ limit: '2mb' }));

let userSchemaReady = false;
async function bootstrapUserSchema() {
  if (userSchemaReady) return;
  try {
    await ensureUserSchema();
    await ensureDefaultAdmin();
    userSchemaReady = true;
  } catch (error) {
    console.warn(`User schema not ready yet: ${error.message}`);
  }
}

async function attachUser(req, _res, next) {
  try {
    await bootstrapUserSchema();
    const cookies = parseCookies(req.headers.cookie);
    req.user = await getUserBySession(cookies.sentinelops_session);
  } catch {
    req.user = null;
  }
  next();
}

app.use(attachUser);

function requireUser(req, res) {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in required' });
    return false;
  }
  return true;
}
app.get('/api/health', async (_req, res) => {
  const database = await dbHealthy();
  let ai = { online: false, url: aiUrl };
  try {
    const response = await fetch(`${aiUrl}/agent`, { signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      ai = { online: true, url: aiUrl, ...(await response.json()) };
    }
  } catch (error) {
    ai = { online: false, url: aiUrl, error: error.message };
  }

  res.json({
    status: 'ok',
    service: 'security-dashboard-api',
    database,
    aiAnalyzer: aiUrl,
    ai,
    mockFallback: false,
  });
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.user) return res.json({ authenticated: false, user: null });
  return res.json({ authenticated: true, user: req.user });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    await bootstrapUserSchema();
    const user = await createUser({
      username: req.body?.username,
      email: req.body?.email,
      password: req.body?.password,
      displayName: req.body?.displayName || req.body?.username,
      themePreference: req.body?.themePreference || 'system',
    });
    const session = await createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
    return res.status(201).json({ authenticated: true, user, expiresAt: session.expiresAt });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    await bootstrapUserSchema();
    const user = await authenticateUser(req.body?.login || req.body?.username || req.body?.email, req.body?.password);
    const session = await createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
    return res.json({ authenticated: true, user, expiresAt: session.expiresAt });
  } catch (error) {
    return res.status(401).json({ error: error.message || 'Login failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  await destroySession(cookies.sentinelops_session);
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.json({ authenticated: false, user: null });
});

app.patch('/api/auth/me', async (req, res) => {
  if (!requireUser(req, res)) return;
  try {
    const user = await updateUserPreferences(req.user.id, {
      themePreference: req.body?.themePreference,
      displayName: req.body?.displayName,
    });
    return res.json({ authenticated: true, user });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to update profile' });
  }
});

app.post('/api/auth/change-credentials', async (req, res) => {
  if (!requireUser(req, res)) return;
  try {
    await bootstrapUserSchema();
    const user = await changeCredentials(req.user.id, {
      currentUsername: req.body?.currentUsername || req.body?.oldUsername,
      currentPassword: req.body?.currentPassword || req.body?.oldPassword,
      newUsername: req.body?.newUsername,
      confirmNewUsername: req.body?.confirmNewUsername,
      newPassword: req.body?.newPassword,
      confirmNewPassword: req.body?.confirmNewPassword,
    });
    return res.json({ authenticated: true, user, message: 'Credentials updated successfully' });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Failed to change credentials' });
  }
});

app.get('/api/auth/activity', async (req, res) => {
  if (!requireUser(req, res)) return;
  try {
    const activity = await listUserActivity(req.user.id, req.query.limit);
    return res.json({ activity });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to load activity' });
  }
});

app.get('/api/auth/chat', async (req, res) => {
  if (!requireUser(req, res)) return;
  try {
    const messages = await listChatMessages(req.user.id, {
      jobName: req.query.job || req.query.jobName,
      buildNumber: req.query.build || req.query.buildNumber,
      limit: req.query.limit,
    });
    return res.json({
      messages: messages.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        jobName: row.job_name,
        buildNumber: row.build_number,
        meta: row.meta,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to load chat history' });
  }
});

app.get('/api/ai/status', async (_req, res) => {
  try {
    const response = await fetch(`${aiUrl}/agent`, { signal: AbortSignal.timeout(2500) });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `AI analyzer returned ${response.status}`);
    }
    return res.json({ online: true, url: aiUrl, ...payload });
  } catch (error) {
    return res.status(502).json({
      online: false,
      url: aiUrl,
      error: error.message || 'AI analyzer unavailable',
      guidance: 'Start services/ai-analyzer (port 4300) alongside the dashboard so the security copilot can respond.',
    });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const payload = await buildDashboardPayload({
      jobName: req.query.job || req.query.jobName,
      buildNumber: req.query.build || req.query.buildNumber,
    });
    return res.json(payload);
  } catch (error) {
    console.error('Dashboard query failed:', error.message);
    // Return a normal empty dashboard shell (HTTP 200) so the UI stays clean
    // until Postgres is reachable / pipeline data is ingested.
    return res.json(
      emptyDashboardPayload(
        error.code === 'ECONNREFUSED'
          ? 'PostgreSQL is not reachable yet — start the DB or set JENKINS_DB_HOST'
          : error.message || 'Database unavailable',
      ),
    );
  }
});

app.get('/api/builds', async (req, res) => {
  try {
    const builds = await listBuilds({
      limit: req.query.limit,
      status: req.query.status && req.query.status !== 'all' ? req.query.status : undefined,
    });
    return res.json({ builds, count: builds.length });
  } catch (error) {
    console.error(error);
    return res.json({ builds: [], count: 0 });
  }
});

app.get('/api/findings', async (req, res) => {
  try {
    const findings = await listFindings({
      severity: req.query.severity,
      status: req.query.status,
      source: req.query.source,
      q: req.query.q,
      jobName: req.query.job || req.query.jobName,
      buildNumber: req.query.build || req.query.buildNumber,
      limit: req.query.limit,
      userId: req.user?.id,
    });
    return res.json({ findings, count: findings.length });
  } catch (error) {
    console.error(error);
    return res.json({ findings: [], count: 0 });
  }
});

app.get('/api/activity', async (req, res) => {
  try {
    const activity = await listActivity(req.query.limit);
    return res.json({ activity });
  } catch (error) {
    console.error(error);
    return res.json({ activity: [] });
  }
});

app.get('/api/builds/:jobName/:buildNumber', async (req, res) => {
  try {
    const detail = await getBuildDetail(req.params.jobName, Number(req.params.buildNumber));
    if (!detail) return res.status(404).json({ error: 'Build not found' });
    return res.json(detail);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Failed to load build' });
  }
});

app.get('/api/findings/:id', async (req, res) => {
  try {
    const finding = await getFindingById(req.params.id, req.user?.id);
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    return res.json(finding);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Failed to load finding' });
  }
});

app.patch('/api/findings/:id', async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!status) return res.status(400).json({ error: 'status is required' });
    const actor = req.user?.displayName || req.user?.username || 'Dashboard';
    const finding = await updateFindingStatus(req.params.id, status, actor, req.user?.id || null);
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    return res.json(finding);
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Failed to update finding' });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) {
    return res.status(400).json({ error: 'A question is required.' });
  }

  try {
    if (req.user) {
      await saveChatMessage(req.user.id, {
        role: 'user',
        content: question,
        jobName: req.body?.jobName,
        buildNumber: req.body?.buildNumber,
      });
    }

    const response = await fetch(`${aiUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        jobName: req.body?.jobName || undefined,
        buildNumber: req.body?.buildNumber || undefined,
        messages: Array.isArray(req.body?.messages) ? req.body.messages.slice(-8) : undefined,
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_CHAT_TIMEOUT_MS || 90000)),
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`AI analyzer returned non-JSON (${response.status}): ${raw.slice(0, 180)}`);
    }
    if (!response.ok) {
      throw new Error(payload.error || `AI analyzer returned ${response.status}`);
    }

    if (req.user && payload.answer) {
      await saveChatMessage(req.user.id, {
        role: 'assistant',
        content: payload.answer,
        jobName: req.body?.jobName,
        buildNumber: req.body?.buildNumber,
        meta: {
          model: payload.model,
          citations: payload.citations || [],
          needsPipeline: payload.needsPipeline || false,
        },
      });
    }

    return res.json(payload);
  } catch (error) {
    return res.status(502).json({
      error: error.message || 'AI analyzer unavailable',
      answer: `The AI agent is not reachable at ${aiUrl} (${error.message}). Start the ai-analyzer service so it runs with the dashboard, then ask again. I can help with DevOps, DevSecOps, networking, and cloud topics once connected.`,
      inScope: true,
      needsPipeline: false,
      pipelineAvailable: false,
      model: 'unavailable',
      confidence: 0,
      citations: [],
      suggestions: ['Retry after starting ai-analyzer', 'How do I start the AI analyzer locally?'],
      agent: 'SentinelOps Security Copilot',
      generatedAt: new Date().toISOString(),
    });
  }
});

app.post('/api/ai/analyze', async (req, res) => {
  try {
    const jobName = String(req.body?.jobName || '').trim();
    const buildNumber = Number(req.body?.buildNumber);
    if (!jobName || !buildNumber) {
      return res.status(400).json({
        error: 'jobName and buildNumber are required',
        needsPipeline: true,
        guidance: 'No pipeline build selected. Run Jenkins and ingest a build before requesting AI analysis.',
      });
    }
    const response = await fetch(`${aiUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobName, buildNumber }),
    });
    const payload = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload.error || `AI analyzer returned ${response.status}`,
        needsPipeline: Boolean(payload.needsPipeline),
        guidance: payload.guidance,
      });
    }
    return res.json(payload);
  } catch (error) {
    return res.status(502).json({
      error: error.message || 'AI analyze failed',
      guidance: `Start the AI analyzer at ${aiUrl} and ensure HUGGINGFACE_API_KEY is configured.`,
    });
  }
});

const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(distPath, 'index.html'), (error) => {
    if (error) next();
  });
});

app.listen(port, () => {
  bootstrapUserSchema().catch(() => {});
  console.log(`Security dashboard API listening on http://localhost:${port}`);
});
