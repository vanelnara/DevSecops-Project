import express from 'express';
import multer from 'multer';
import { query, dbHealthy } from './db.js';
import {
  computeRiskScore,
  parseDependencyCheck,
  parseGitleaks,
  parseTrivy,
  summarizeSeverities,
} from './parsers.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const port = Number(process.env.INGEST_PORT || 4200);
const aiUrl = process.env.AI_ANALYZER_URL || 'http://127.0.0.1:4300';
const ingestToken = process.env.INGEST_TOKEN || '';

app.use(express.json({ limit: '5mb' }));

function auth(req, res, next) {
  if (!ingestToken) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-ingest-token'];
  if (token !== ingestToken) {
    return res.status(401).json({ error: 'Unauthorized ingest request' });
  }
  return next();
}

function safeJson(buffer) {
  if (!buffer) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

function mapStatus(value = 'UNKNOWN') {
  const status = String(value).toLowerCase();
  if (status.includes('fail')) return 'failed';
  if (status.includes('unstable')) return 'unstable';
  if (status.includes('success') || status === 'success') return 'success';
  return status || 'unknown';
}

async function upsertBuild(meta, findings, durationSeconds) {
  const risk = computeRiskScore(findings);
  await query(
    `INSERT INTO security_builds (
      job_name, build_number, branch, commit_sha, triggered_by, status,
      risk_score, duration_seconds, image_tag, started_at, finished_at, raw_meta
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (job_name, build_number) DO UPDATE SET
      branch = EXCLUDED.branch,
      commit_sha = EXCLUDED.commit_sha,
      triggered_by = EXCLUDED.triggered_by,
      status = EXCLUDED.status,
      risk_score = EXCLUDED.risk_score,
      duration_seconds = EXCLUDED.duration_seconds,
      image_tag = EXCLUDED.image_tag,
      started_at = EXCLUDED.started_at,
      finished_at = EXCLUDED.finished_at,
      raw_meta = EXCLUDED.raw_meta`,
    [
      meta.jobName,
      meta.buildNumber,
      meta.branch || 'main',
      meta.commitSha || null,
      meta.triggeredBy || 'jenkins',
      mapStatus(meta.status),
      risk,
      durationSeconds,
      meta.imageTag || null,
      meta.startedAt || null,
      meta.finishedAt || new Date().toISOString(),
      JSON.stringify(meta),
    ],
  );
  return risk;
}

async function replaceFindings(jobName, buildNumber, findings) {
  await query('DELETE FROM findings WHERE job_name = $1 AND build_number = $2', [jobName, buildNumber]);
  for (const finding of findings) {
    await query(
      `INSERT INTO findings (
        job_name, build_number, finding_key, severity, title, source, asset, status, confidence, raw
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (job_name, build_number, finding_key, source) DO UPDATE SET
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        asset = EXCLUDED.asset,
        status = EXCLUDED.status,
        confidence = EXCLUDED.confidence,
        raw = EXCLUDED.raw`,
      [
        jobName,
        buildNumber,
        finding.finding_key,
        finding.severity,
        finding.title,
        finding.source,
        finding.asset,
        finding.status,
        finding.confidence,
        JSON.stringify(finding.raw || {}),
      ],
    );
  }
}

async function upsertStages(jobName, buildNumber, stages = []) {
  for (const stage of stages) {
    await query(
      `INSERT INTO pipeline_stages (
        job_name, build_number, stage_name, status, started_at, finished_at, duration_seconds, details
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (job_name, build_number, stage_name) DO UPDATE SET
        status = EXCLUDED.status,
        started_at = COALESCE(EXCLUDED.started_at, pipeline_stages.started_at),
        finished_at = EXCLUDED.finished_at,
        duration_seconds = EXCLUDED.duration_seconds,
        details = EXCLUDED.details`,
      [
        jobName,
        buildNumber,
        stage.name,
        stage.status || 'SUCCESS',
        stage.startedAt || null,
        stage.finishedAt || null,
        stage.durationSeconds ?? null,
        stage.details || '',
      ],
    );
  }
}

async function addActivity(jobName, buildNumber, actor, action) {
  await query(
    `INSERT INTO activity_events (job_name, build_number, actor, action)
     VALUES ($1, $2, $3, $4)`,
    [jobName, buildNumber, actor, action],
  );
}

async function triggerAiAnalysis(jobName, buildNumber) {
  try {
    const response = await fetch(`${aiUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobName, buildNumber }),
    });
    if (!response.ok) {
      const text = await response.text();
      console.warn(`AI analyzer returned ${response.status}: ${text}`);
    }
  } catch (error) {
    console.warn(`AI analyzer unavailable: ${error.message}`);
  }
}

app.get('/health', async (_req, res) => {
  const database = await dbHealthy();
  res.status(database ? 200 : 503).json({
    status: database ? 'ok' : 'degraded',
    service: 'security-ingest-bridge',
    database,
    dbHost: process.env.JENKINS_DB_HOST || '127.0.0.1',
  });
});

app.get('/builds/:jobName/:buildNumber', async (req, res) => {
  try {
    const jobName = decodeURIComponent(req.params.jobName);
    const buildNumber = Number(req.params.buildNumber);
    const result = await query(
      `SELECT job_name, build_number, status, risk_score, finished_at
       FROM security_builds
       WHERE job_name = $1 AND build_number = $2`,
      [jobName, buildNumber],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ ok: false, found: false, jobName, buildNumber });
    }
    return res.json({ ok: true, found: true, build: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post(
  '/ingest/build',
  auth,
  upload.fields([
    { name: 'gitleaks', maxCount: 1 },
    { name: 'trivy', maxCount: 1 },
    { name: 'dependencyCheck', maxCount: 1 },
    { name: 'meta', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      let meta = {};
      if (req.body?.meta) {
        meta = typeof req.body.meta === 'string' ? JSON.parse(req.body.meta) : req.body.meta;
      } else if (req.files?.meta?.[0]) {
        meta = safeJson(req.files.meta[0].buffer) || {};
      } else {
        meta = req.body || {};
      }

      const jobName = String(meta.jobName || process.env.DEFAULT_JOB_NAME || 'Devops-project');
      const buildNumber = Number(meta.buildNumber);
      if (!buildNumber) {
        return res.status(400).json({ error: 'buildNumber is required' });
      }

      const gitleaks = parseGitleaks(safeJson(req.files?.gitleaks?.[0]?.buffer) || []);
      const trivy = parseTrivy(safeJson(req.files?.trivy?.[0]?.buffer) || {});
      const owasp = parseDependencyCheck(safeJson(req.files?.dependencyCheck?.[0]?.buffer) || {});
      const findings = [...gitleaks, ...trivy, ...owasp];

      const stages = Array.isArray(meta.stages) ? meta.stages : [];
      const stagesDuration = stages.reduce(
        (sum, stage) => sum + Number(stage.durationSeconds || 0),
        0,
      );
      const durationSeconds =
        meta.durationSeconds != null && meta.durationSeconds !== ''
          ? Number(meta.durationSeconds)
          : stagesDuration || null;

      await upsertStages(jobName, buildNumber, stages);
      await replaceFindings(jobName, buildNumber, findings);
      const riskScore = await upsertBuild(
        {
          ...meta,
          jobName,
          buildNumber,
          status: meta.status || (findings.some((f) => f.severity === 'critical') ? 'unstable' : 'success'),
        },
        findings,
        durationSeconds,
      );

      await query(
        `INSERT INTO pipeline_runs (job_name, build_number, status, started_at, finished_at, log_excerpt)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), NOW(), $5)
         ON CONFLICT (job_name, build_number) DO UPDATE SET
           status = EXCLUDED.status,
           finished_at = NOW(),
           log_excerpt = pipeline_runs.log_excerpt || E'\n' || EXCLUDED.log_excerpt`,
        [
          jobName,
          buildNumber,
          String(meta.status || 'SUCCESS').toUpperCase(),
          meta.startedAt || null,
          `[Ingest] Stored ${findings.length} findings, risk=${riskScore}`,
        ],
      );

      await addActivity(jobName, buildNumber, 'Ingest Bridge', `Imported build #${buildNumber} (${findings.length} findings)`);
      if (process.env.TRIGGER_AI_ON_INGEST === 'true') {
        triggerAiAnalysis(jobName, buildNumber);
      }

      const severities = summarizeSeverities(findings);
      return res.json({
        ok: true,
        jobName,
        buildNumber,
        riskScore,
        findings: findings.length,
        severities,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: error.message || 'Ingest failed' });
    }
  },
);

app.listen(port, '0.0.0.0', () => {
  console.log(`Security ingest bridge listening on http://0.0.0.0:${port}`);
});
