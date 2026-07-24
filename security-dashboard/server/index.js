import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbHealthy } from './db.js';
import { buildDashboardPayload } from './dashboardRepository.js';

const app = express();
const port = Number(process.env.DASHBOARD_API_PORT || 4100);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aiUrl = process.env.AI_ANALYZER_URL || 'http://127.0.0.1:4300';
const useMockFallback = process.env.DASHBOARD_MOCK_FALLBACK !== 'false';

app.use(express.json());

const mockDashboard = {
  generatedAt: new Date().toISOString(),
  organization: 'DevSecOps Lab',
  dataMode: 'mock',
  summary: {
    riskScore: 72,
    riskDelta: -8,
    totalFindings: 47,
    critical: 3,
    high: 9,
    medium: 21,
    low: 14,
    blockedBuilds: 4,
    meanTimeToResolve: '3h 42m',
    coverage: 94,
  },
  severity: [
    { name: 'Critical', value: 3, color: '#ef4444' },
    { name: 'High', value: 9, color: '#f97316' },
    { name: 'Medium', value: 21, color: '#eab308' },
    { name: 'Low', value: 14, color: '#38bdf8' },
  ],
  trend: [
    { day: 'Fri', critical: 7, high: 15, medium: 22 },
    { day: 'Sat', critical: 6, high: 14, medium: 25 },
    { day: 'Sun', critical: 6, high: 12, medium: 24 },
    { day: 'Mon', critical: 5, high: 13, medium: 23 },
    { day: 'Tue', critical: 5, high: 11, medium: 22 },
    { day: 'Wed', critical: 4, high: 10, medium: 21 },
    { day: 'Thu', critical: 3, high: 9, medium: 21 },
  ],
  pipelinePerformance: [
    { stage: 'Checkout', duration: 4, baseline: 5 },
    { stage: 'Unit Tests', duration: 13, baseline: 15 },
    { stage: 'SonarQube', duration: 48, baseline: 42 },
    { stage: 'OWASP', duration: 156, baseline: 120 },
    { stage: 'Gitleaks', duration: 2, baseline: 3 },
    { stage: 'Build', duration: 38, baseline: 45 },
    { stage: 'Trivy', duration: 112, baseline: 80 },
    { stage: 'Cosign', duration: 18, baseline: 20 },
    { stage: 'Deploy', duration: 31, baseline: 35 },
  ],
  pipelines: [
    {
      id: 35,
      name: 'Devops-project',
      branch: 'main',
      commit: '8a0b3d7',
      status: 'unstable',
      risk: 72,
      duration: '6m 14s',
      findings: 14,
      triggeredBy: 'admin',
      finishedAt: '8 minutes ago',
    },
  ],
  alerts: [
    {
      id: 'SEC-2041',
      severity: 'critical',
      title: 'Credential pattern detected in Git history',
      source: 'Gitleaks',
      pipeline: 'Devops-project #35',
      asset: 'scripts/push-to-github.sh',
      status: 'open',
      age: '8m',
      confidence: 98,
    },
  ],
  controls: [
    { name: 'SAST', tool: 'SonarQube', status: 'passing', coverage: 97 },
    { name: 'SCA', tool: 'OWASP Dependency-Check', status: 'warning', coverage: 92 },
    { name: 'Secrets', tool: 'Gitleaks', status: 'failing', coverage: 100 },
    { name: 'Container', tool: 'Trivy', status: 'warning', coverage: 96 },
    { name: 'Signing', tool: 'Cosign', status: 'passing', coverage: 100 },
    { name: 'Deployment', tool: 'Argo CD', status: 'passing', coverage: 88 },
  ],
  aiAnalysis: {
    verdict: 'Elevated risk — deployment completed with unresolved secret findings',
    confidence: 94,
    narrative:
      'Mock mode is active because PostgreSQL has no ingested builds yet. Run the Jenkins publish stage to populate real data.',
    priorities: [
      {
        priority: 'P0',
        title: 'Publish a pipeline build to the ingest bridge',
        impact: 'Replaces mock metrics with real scanner findings',
        effort: '1 pipeline run',
      },
    ],
  },
  activity: [
    { actor: 'Dashboard', action: 'Serving mock fallback data', time: 'now' },
  ],
  selectedBuild: {
    jobName: 'Devops-project',
    buildNumber: 35,
    branch: 'main',
    commit: '8a0b3d7',
    status: 'unstable',
    finishedAt: '8 minutes ago',
    duration: '6m 14s',
  },
};

app.get('/api/health', async (_req, res) => {
  const database = await dbHealthy();
  res.json({
    status: 'ok',
    service: 'security-dashboard-api',
    database,
    aiAnalyzer: aiUrl,
  });
});

app.get('/api/dashboard', async (_req, res) => {
  try {
    const payload = await buildDashboardPayload();
    if (payload) {
      // Enrich finding counts per build
      const { query } = await import('./db.js');
      const counts = await query(
        `SELECT job_name, build_number, COUNT(*)::int AS count
         FROM findings
         GROUP BY job_name, build_number`,
      );
      const byBuild = Object.fromEntries(
        counts.rows.map((row) => [`${row.job_name}:${row.build_number}`, row.count]),
      );
      payload.pipelines = payload.pipelines.map((pipeline) => ({
        ...pipeline,
        findings: byBuild[`${pipeline.name}:${pipeline.id}`] || 0,
      }));
      return res.json(payload);
    }
    if (useMockFallback) {
      return res.json({ ...mockDashboard, generatedAt: new Date().toISOString() });
    }
    return res.status(404).json({ error: 'No builds found in PostgreSQL' });
  } catch (error) {
    console.error('Dashboard query failed:', error.message);
    if (useMockFallback) {
      return res.json({
        ...mockDashboard,
        generatedAt: new Date().toISOString(),
        dataMode: 'mock-fallback',
        error: error.message,
      });
    }
    return res.status(500).json({ error: error.message || 'Failed to load dashboard' });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) {
    return res.status(400).json({ error: 'A question is required.' });
  }

  try {
    const response = await fetch(`${aiUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        jobName: req.body?.jobName,
        buildNumber: req.body?.buildNumber,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `AI analyzer returned ${response.status}`);
    }
    return res.json(payload);
  } catch (error) {
    return res.status(502).json({
      error: error.message || 'AI analyzer unavailable',
      answer: `AI analyzer is unavailable (${error.message}). Start services/ai-analyzer and set DEEPSEEK_API_KEY.`,
      model: 'unavailable',
      confidence: 0,
      citations: [],
      generatedAt: new Date().toISOString(),
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
  console.log(`Security dashboard API listening on http://localhost:${port}`);
});
