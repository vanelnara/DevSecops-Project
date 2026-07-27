import { query } from './db.js';

const severityColors = {
  Critical: '#ef4444',
  High: '#f97316',
  Medium: '#eab308',
  Low: '#38bdf8',
};

export function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  if (!seconds) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function relativeTime(dateValue) {
  if (!dateValue) return '—';
  const date = new Date(dateValue);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function shortCommit(sha) {
  if (!sha) return 'n/a';
  return String(sha).slice(0, 7);
}

function mapBuild(row, findingsCount = 0) {
  return {
    id: row.build_number,
    jobName: row.job_name,
    name: row.job_name,
    branch: row.branch || 'main',
    commit: shortCommit(row.commit_sha),
    commitSha: row.commit_sha,
    status: row.status,
    risk: row.risk_score,
    duration: formatDuration(row.duration_seconds),
    durationSeconds: row.duration_seconds,
    findings: findingsCount,
    triggeredBy: row.triggered_by || 'jenkins',
    finishedAt: relativeTime(row.finished_at),
    finishedAtRaw: row.finished_at,
    startedAtRaw: row.started_at,
    imageTag: row.image_tag,
  };
}

function mapFinding(row) {
  return {
    id: row.id,
    findingKey: row.finding_key,
    severity: row.severity,
    title: row.title,
    source: row.source,
    asset: row.asset || 'n/a',
    status: row.status,
    confidence: row.confidence,
    jobName: row.job_name,
    buildNumber: row.build_number,
    pipeline: `${row.job_name} #${row.build_number}`,
    age: relativeTime(row.created_at),
    createdAt: row.created_at,
    raw: row.raw || {},
  };
}

export function emptyDashboardPayload(reason = '') {
  const emptyControls = [
    { name: 'SAST', tool: 'SonarQube', status: 'passing', coverage: 0, findings: 0 },
    { name: 'SCA', tool: 'OWASP Dependency-Check', status: 'passing', coverage: 0, findings: 0 },
    { name: 'Secrets', tool: 'Gitleaks', status: 'passing', coverage: 0, findings: 0 },
    { name: 'Container', tool: 'Trivy', status: 'passing', coverage: 0, findings: 0 },
    { name: 'Signing', tool: 'Cosign', status: 'passing', coverage: 0, findings: 0 },
    { name: 'Deployment', tool: 'Argo CD', status: 'passing', coverage: 0, findings: 0 },
  ];

  return {
    generatedAt: new Date().toISOString(),
    organization: 'DevSecOps Lab',
    dataMode: 'empty',
    waitingReason: reason || 'Waiting for the next Jenkins pipeline ingest',
    summary: {
      riskScore: 0,
      riskDelta: 0,
      totalFindings: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      blockedBuilds: 0,
      meanTimeToResolve: '—',
      coverage: 0,
      totalBuilds: 0,
    },
    severity: [
      { name: 'Critical', value: 0, color: severityColors.Critical },
      { name: 'High', value: 0, color: severityColors.High },
      { name: 'Medium', value: 0, color: severityColors.Medium },
      { name: 'Low', value: 0, color: severityColors.Low },
    ],
    trend: [
      { day: 'Mon', critical: 0, high: 0, medium: 0 },
      { day: 'Tue', critical: 0, high: 0, medium: 0 },
      { day: 'Wed', critical: 0, high: 0, medium: 0 },
      { day: 'Thu', critical: 0, high: 0, medium: 0 },
      { day: 'Fri', critical: 0, high: 0, medium: 0 },
      { day: 'Sat', critical: 0, high: 0, medium: 0 },
      { day: 'Sun', critical: 0, high: 0, medium: 0 },
    ],
    pipelinePerformance: [
      { stage: 'Checkout', duration: 0, baseline: 1, status: 'WAITING' },
      { stage: 'Unit Tests', duration: 0, baseline: 1, status: 'WAITING' },
      { stage: 'SAST', duration: 0, baseline: 1, status: 'WAITING' },
      { stage: 'OWASP', duration: 0, baseline: 1, status: 'WAITING' },
      { stage: 'Gitleaks', duration: 0, baseline: 1, status: 'WAITING' },
      { stage: 'Build', duration: 0, baseline: 1, status: 'WAITING' },
      { stage: 'Trivy', duration: 0, baseline: 1, status: 'WAITING' },
      { stage: 'Cosign', duration: 0, baseline: 1, status: 'WAITING' },
      { stage: 'Deploy', duration: 0, baseline: 1, status: 'WAITING' },
    ],
    pipelines: [],
    alerts: [],
    controls: emptyControls,
    aiAnalysis: null,
    activity: [],
    selectedBuild: null,
  };
}

async function findingCountsByBuild(jobName, buildNumbers) {
  if (!buildNumbers.length) return {};
  const result = await query(
    `SELECT build_number, COUNT(*)::int AS count
     FROM findings
     WHERE job_name = $1 AND build_number = ANY($2::int[])
     GROUP BY build_number`,
    [jobName, buildNumbers],
  );
  return Object.fromEntries(result.rows.map((row) => [row.build_number, row.count]));
}

export async function listBuilds({ limit = 50, status } = {}) {
  const params = [];
  let sql = `SELECT * FROM security_builds`;
  if (status) {
    params.push(status);
    sql += ` WHERE status = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 50, 200));
  sql += ` ORDER BY build_number DESC LIMIT $${params.length}`;
  const result = await query(sql, params);
  if (!result.rows.length) return [];

  const byJob = new Map();
  for (const row of result.rows) {
    if (!byJob.has(row.job_name)) byJob.set(row.job_name, []);
    byJob.get(row.job_name).push(row.build_number);
  }

  const countMap = {};
  for (const [jobName, builds] of byJob.entries()) {
    Object.assign(countMap, Object.fromEntries(
      Object.entries(await findingCountsByBuild(jobName, builds)).map(([bn, count]) => [`${jobName}:${bn}`, count]),
    ));
  }

  return result.rows.map((row) => mapBuild(row, countMap[`${row.job_name}:${row.build_number}`] || 0));
}

export async function getBuildDetail(jobName, buildNumber) {
  const buildResult = await query(
    `SELECT * FROM security_builds WHERE job_name = $1 AND build_number = $2`,
    [jobName, buildNumber],
  );
  const build = buildResult.rows[0];
  if (!build) return null;

  const [findings, stages, ai, activity, count] = await Promise.all([
    query(
      `SELECT * FROM findings
       WHERE job_name = $1 AND build_number = $2
       ORDER BY CASE severity
         WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at DESC`,
      [jobName, buildNumber],
    ),
    query(
      `SELECT stage_name, status, duration_seconds, details, started_at, finished_at
       FROM pipeline_stages
       WHERE job_name = $1 AND build_number = $2
       ORDER BY finished_at NULLS LAST, stage_name`,
      [jobName, buildNumber],
    ),
    query(
      `SELECT * FROM ai_analyses WHERE job_name = $1 AND build_number = $2`,
      [jobName, buildNumber],
    ),
    query(
      `SELECT actor, action, created_at FROM activity_events
       WHERE job_name = $1 AND build_number = $2
       ORDER BY created_at DESC LIMIT 20`,
      [jobName, buildNumber],
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM findings WHERE job_name = $1 AND build_number = $2`,
      [jobName, buildNumber],
    ),
  ]);

  const mappedFindings = findings.rows.map(mapFinding);
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of mappedFindings) {
    if (severityCounts[item.severity] !== undefined) severityCounts[item.severity] += 1;
  }

  return {
    build: mapBuild(build, count.rows[0]?.count || 0),
    findings: mappedFindings,
    stages: stages.rows.map((stage) => ({
      name: stage.stage_name,
      status: stage.status,
      duration: formatDuration(stage.duration_seconds),
      durationSeconds: Number(stage.duration_seconds || 0),
      details: stage.details || '',
      startedAt: stage.started_at,
      finishedAt: stage.finished_at,
    })),
    severityCounts,
    aiAnalysis: ai.rows[0]
      ? {
          verdict: ai.rows[0].verdict,
          confidence: ai.rows[0].confidence,
          narrative: ai.rows[0].narrative,
          priorities: ai.rows[0].priorities || [],
          model: ai.rows[0].model,
          createdAt: ai.rows[0].created_at,
        }
      : null,
    activity: activity.rows.map((event) => ({
      actor: event.actor,
      action: event.action,
      time: relativeTime(event.created_at),
    })),
  };
}

export async function listFindings(filters = {}) {
  const {
    severity,
    status,
    source,
    q,
    jobName,
    buildNumber,
    limit = 100,
    userId,
  } = filters;

  const clauses = [];
  const params = [];
  const statusExpr = userId
    ? 'COALESCE(ufs.status, f.status)'
    : 'f.status';

  if (jobName) {
    params.push(jobName);
    clauses.push(`f.job_name = $${params.length}`);
  }
  if (buildNumber) {
    params.push(Number(buildNumber));
    clauses.push(`f.build_number = $${params.length}`);
  }
  if (severity && severity !== 'all') {
    params.push(severity);
    clauses.push(`f.severity = $${params.length}`);
  }
  if (status && status !== 'all') {
    params.push(status);
    clauses.push(`${statusExpr} = $${params.length}`);
  }
  if (source && source !== 'all') {
    params.push(source);
    clauses.push(`f.source = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(f.title ILIKE $${params.length} OR f.finding_key ILIKE $${params.length} OR f.asset ILIKE $${params.length})`);
  }

  let joinSql = '';
  if (userId) {
    params.push(Number(userId));
    joinSql = `LEFT JOIN user_finding_states ufs ON ufs.finding_id = f.id AND ufs.user_id = $${params.length}`;
  }

  params.push(Math.min(Number(limit) || 100, 500));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(
    `SELECT f.*, ${statusExpr} AS effective_status
     FROM findings f
     ${joinSql}
     ${where}
     ORDER BY CASE f.severity
       WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       f.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map((row) => {
    const mapped = mapFinding(row);
    mapped.status = row.effective_status || mapped.status;
    return mapped;
  });
}

export async function getFindingById(id, userId) {
  if (userId) {
    const result = await query(
      `SELECT f.*, COALESCE(ufs.status, f.status) AS effective_status
       FROM findings f
       LEFT JOIN user_finding_states ufs ON ufs.finding_id = f.id AND ufs.user_id = $2
       WHERE f.id = $1`,
      [Number(id), Number(userId)],
    );
    if (!result.rows[0]) return null;
    const mapped = mapFinding(result.rows[0]);
    mapped.status = result.rows[0].effective_status || mapped.status;
    return mapped;
  }
  const result = await query(`SELECT * FROM findings WHERE id = $1`, [Number(id)]);
  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function updateFindingStatus(id, status, actor = 'Dashboard', userId = null) {
  const allowed = new Set(['open', 'triage', 'in-progress', 'accepted', 'resolved', 'false-positive']);
  if (!allowed.has(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  // Prefer per-user status when authenticated so each analyst keeps their own triage state.
  if (userId) {
    const existing = await query(`SELECT * FROM findings WHERE id = $1`, [Number(id)]);
    if (!existing.rows[0]) return null;
    await query(
      `INSERT INTO user_finding_states (user_id, finding_id, status, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, finding_id) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [Number(userId), Number(id), status],
    );
    const finding = mapFinding(existing.rows[0]);
    finding.status = status;
    await query(
      `INSERT INTO activity_events (job_name, build_number, actor, action)
       VALUES ($1, $2, $3, $4)`,
      [finding.jobName, finding.buildNumber, actor, `Set ${finding.findingKey} to ${status}`],
    );
    return finding;
  }

  const result = await query(
    `UPDATE findings SET status = $1 WHERE id = $2 RETURNING *`,
    [status, Number(id)],
  );
  const finding = result.rows[0] ? mapFinding(result.rows[0]) : null;
  if (finding) {
    await query(
      `INSERT INTO activity_events (job_name, build_number, actor, action)
       VALUES ($1, $2, $3, $4)`,
      [finding.jobName, finding.buildNumber, actor, `Set ${finding.findingKey} to ${status}`],
    );
  }
  return finding;
}

export async function listActivity(limit = 30) {
  const result = await query(
    `SELECT actor, action, created_at, job_name, build_number
     FROM activity_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(Number(limit) || 30, 100)],
  );
  return result.rows.map((event) => ({
    actor: event.actor,
    action: event.action,
    time: relativeTime(event.created_at),
    jobName: event.job_name,
    buildNumber: event.build_number,
  }));
}

function controlsFromFindings(findings) {
  const sources = {
    SAST: { tool: 'SonarQube', names: ['SonarQube', 'SAST'] },
    SCA: { tool: 'OWASP Dependency-Check', names: ['OWASP'] },
    Secrets: { tool: 'Gitleaks', names: ['Gitleaks'] },
    Container: { tool: 'Trivy', names: ['Trivy'] },
    Signing: { tool: 'Cosign', names: ['Cosign'] },
    Deployment: { tool: 'Argo CD', names: ['K8s Deploy', 'Argo'] },
  };

  return Object.entries(sources).map(([name, meta]) => {
    const related = findings.filter((f) => meta.names.some((n) => f.source.includes(n)));
    const criticalOrHigh = related.some((f) => f.severity === 'critical' || f.severity === 'high');
    const status = related.length === 0 ? 'passing' : criticalOrHigh ? 'failing' : 'warning';
    const coverage = related.length === 0 ? 100 : Math.max(40, 100 - related.length * 4);
    return { name, tool: meta.tool, status, coverage, findings: related.length };
  });
}

export async function buildDashboardPayload({ jobName, buildNumber } = {}) {
  let selected;
  if (jobName && buildNumber) {
    const result = await query(
      `SELECT * FROM security_builds WHERE job_name = $1 AND build_number = $2`,
      [jobName, Number(buildNumber)],
    );
    selected = result.rows[0] || null;
  } else {
    const result = await query(
      `SELECT * FROM security_builds
       ORDER BY finished_at DESC NULLS LAST, build_number DESC
       LIMIT 1`,
    );
    selected = result.rows[0] || null;
  }

  if (!selected) return emptyDashboardPayload();

  const detail = await getBuildDetail(selected.job_name, selected.build_number);
  const builds = await listBuilds({ limit: 25 });
  const activity = await listActivity(12);

  const counts = detail.severityCounts;
  const totalFindings = counts.critical + counts.high + counts.medium + counts.low;
  const controls = controlsFromFindings(detail.findings);
  const coverage = Math.round(
    controls.reduce((sum, item) => sum + item.coverage, 0) / Math.max(controls.length, 1),
  );

  const previous = builds.find(
    (b) => b.jobName === selected.job_name && b.id < selected.build_number,
  );
  const riskDelta = previous ? selected.risk_score - previous.risk : 0;

  const trendResult = await query(
    `SELECT
       to_char(date_trunc('day', b.finished_at), 'Dy') AS day,
       date_trunc('day', b.finished_at) AS day_date,
       COUNT(*) FILTER (WHERE f.severity = 'critical')::int AS critical,
       COUNT(*) FILTER (WHERE f.severity = 'high')::int AS high,
       COUNT(*) FILTER (WHERE f.severity = 'medium')::int AS medium
     FROM security_builds b
     LEFT JOIN findings f
       ON f.job_name = b.job_name AND f.build_number = b.build_number
     WHERE b.finished_at >= NOW() - INTERVAL '7 days'
     GROUP BY day_date
     ORDER BY day_date`,
  );

  return {
    generatedAt: new Date().toISOString(),
    organization: 'DevSecOps Lab',
    dataMode: 'postgres',
    summary: {
      riskScore: selected.risk_score,
      riskDelta,
      totalFindings,
      critical: counts.critical,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      blockedBuilds: builds.filter((b) => ['failed', 'unstable'].includes(String(b.status).toLowerCase())).length,
      meanTimeToResolve: formatDuration(
        Math.round(
          builds.reduce((sum, b) => sum + Number(b.durationSeconds || 0), 0) / Math.max(builds.length, 1),
        ),
      ),
      coverage,
      totalBuilds: builds.length,
    },
    severity: [
      { name: 'Critical', value: counts.critical, color: severityColors.Critical },
      { name: 'High', value: counts.high, color: severityColors.High },
      { name: 'Medium', value: counts.medium, color: severityColors.Medium },
      { name: 'Low', value: counts.low, color: severityColors.Low },
    ],
    trend: trendResult.rows.map((row) => ({
      day: row.day?.trim() || '—',
      critical: row.critical,
      high: row.high,
      medium: row.medium,
    })),
    pipelinePerformance: detail.stages.map((stage) => ({
      stage: stage.name,
      duration: stage.durationSeconds,
      baseline: Math.max(stage.durationSeconds - 5, 1),
      status: stage.status,
    })),
    pipelines: builds,
    alerts: detail.findings.filter((f) => f.status !== 'resolved' && f.status !== 'false-positive').slice(0, 12),
    controls,
    aiAnalysis: detail.aiAnalysis,
    activity,
    selectedBuild: {
      jobName: selected.job_name,
      buildNumber: selected.build_number,
      branch: selected.branch || 'main',
      commit: shortCommit(selected.commit_sha),
      status: selected.status,
      finishedAt: relativeTime(selected.finished_at),
      duration: formatDuration(selected.duration_seconds),
      risk: selected.risk_score,
    },
  };
}
