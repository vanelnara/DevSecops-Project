import { query } from './db.js';

const severityColors = {
  Critical: '#ef4444',
  High: '#f97316',
  Medium: '#eab308',
  Low: '#38bdf8',
};

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  if (!seconds) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function relativeTime(dateValue) {
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

async function getLatestBuild() {
  const result = await query(
    `SELECT * FROM security_builds
     ORDER BY finished_at DESC NULLS LAST, build_number DESC
     LIMIT 1`,
  );
  return result.rows[0] || null;
}

async function getBuilds(limit = 8) {
  const result = await query(
    `SELECT * FROM security_builds
     ORDER BY build_number DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

async function getFindings(jobName, buildNumber) {
  const result = await query(
    `SELECT * FROM findings
     WHERE job_name = $1 AND build_number = $2
     ORDER BY CASE severity
       WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       created_at DESC`,
    [jobName, buildNumber],
  );
  return result.rows;
}

async function getAllOpenFindingCounts() {
  const result = await query(
    `SELECT severity, COUNT(*)::int AS count
     FROM findings f
     INNER JOIN (
       SELECT job_name, MAX(build_number) AS build_number
       FROM security_builds
       GROUP BY job_name
     ) latest ON latest.job_name = f.job_name AND latest.build_number = f.build_number
     GROUP BY severity`,
  );
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of result.rows) {
    counts[row.severity] = row.count;
  }
  return counts;
}

async function getTrend() {
  const result = await query(
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
  return result.rows.map((row) => ({
    day: row.day?.trim() || '—',
    critical: row.critical,
    high: row.high,
    medium: row.medium,
  }));
}

async function getStages(jobName, buildNumber) {
  const result = await query(
    `SELECT stage_name, duration_seconds, status
     FROM pipeline_stages
     WHERE job_name = $1 AND build_number = $2
     ORDER BY finished_at NULLS LAST, stage_name`,
    [jobName, buildNumber],
  );
  return result.rows;
}

async function getAiAnalysis(jobName, buildNumber) {
  const result = await query(
    `SELECT * FROM ai_analyses
     WHERE job_name = $1 AND build_number = $2`,
    [jobName, buildNumber],
  );
  return result.rows[0] || null;
}

async function getActivity(limit = 8) {
  const result = await query(
    `SELECT actor, action, created_at
     FROM activity_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

async function getControlsFromFindings(findings) {
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
    return { name, tool: meta.tool, status, coverage };
  });
}

function blockedBuilds(builds) {
  return builds.filter((b) => ['failed', 'unstable'].includes(String(b.status).toLowerCase())).length;
}

export async function buildDashboardPayload() {
  const latest = await getLatestBuild();
  if (!latest) {
    return null;
  }

  const [builds, findings, counts, trend, stages, ai, activity] = await Promise.all([
    getBuilds(8),
    getFindings(latest.job_name, latest.build_number),
    getAllOpenFindingCounts(),
    getTrend(),
    getStages(latest.job_name, latest.build_number),
    getAiAnalysis(latest.job_name, latest.build_number),
    getActivity(8),
  ]);

  const totalFindings = counts.critical + counts.high + counts.medium + counts.low;
  const controls = await getControlsFromFindings(findings);
  const coverage = Math.round(
    controls.reduce((sum, item) => sum + item.coverage, 0) / Math.max(controls.length, 1),
  );

  const severity = [
    { name: 'Critical', value: counts.critical, color: severityColors.Critical },
    { name: 'High', value: counts.high, color: severityColors.High },
    { name: 'Medium', value: counts.medium, color: severityColors.Medium },
    { name: 'Low', value: counts.low, color: severityColors.Low },
  ];

  const previous = builds[1];
  const riskDelta = previous ? latest.risk_score - previous.risk_score : 0;

  return {
    generatedAt: new Date().toISOString(),
    organization: 'DevSecOps Lab',
    dataMode: 'postgres',
    summary: {
      riskScore: latest.risk_score,
      riskDelta,
      totalFindings,
      critical: counts.critical,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      blockedBuilds: blockedBuilds(builds),
      meanTimeToResolve: formatDuration(
        Math.round(
          builds.reduce((sum, b) => sum + Number(b.duration_seconds || 0), 0) / Math.max(builds.length, 1),
        ),
      ),
      coverage,
    },
    severity,
    trend: trend.length
      ? trend
      : [
          {
            day: 'Now',
            critical: counts.critical,
            high: counts.high,
            medium: counts.medium,
          },
        ],
    pipelinePerformance: stages.map((stage) => ({
      stage: stage.stage_name,
      duration: Number(stage.duration_seconds || 0),
      baseline: Math.max(Number(stage.duration_seconds || 0) - 5, 1),
    })),
    pipelines: builds.map((build) => ({
      id: build.build_number,
      name: build.job_name,
      branch: build.branch || 'main',
      commit: shortCommit(build.commit_sha),
      status: build.status,
      risk: build.risk_score,
      duration: formatDuration(build.duration_seconds),
      findings: undefined,
      triggeredBy: build.triggered_by || 'jenkins',
      finishedAt: relativeTime(build.finished_at),
    })),
    alerts: findings.slice(0, 8).map((finding) => ({
      id: finding.finding_key,
      severity: finding.severity,
      title: finding.title,
      source: finding.source,
      pipeline: `${finding.job_name} #${finding.build_number}`,
      asset: finding.asset || 'n/a',
      status: finding.status,
      age: relativeTime(finding.created_at),
      confidence: finding.confidence,
    })),
    controls,
    aiAnalysis: ai
      ? {
          verdict: ai.verdict,
          confidence: ai.confidence,
          narrative: ai.narrative,
          priorities: ai.priorities || [],
        }
      : {
          verdict: 'Waiting for AI analysis of the latest ingested build',
          confidence: 0,
          narrative:
            'Findings are stored in PostgreSQL. The AI analyzer will write a verdict after the publish stage triggers analysis.',
          priorities: [],
        },
    activity: activity.map((event) => ({
      actor: event.actor,
      action: event.action,
      time: relativeTime(event.created_at),
    })),
    selectedBuild: {
      jobName: latest.job_name,
      buildNumber: latest.build_number,
      branch: latest.branch || 'main',
      commit: shortCommit(latest.commit_sha),
      status: latest.status,
      finishedAt: relativeTime(latest.finished_at),
      duration: formatDuration(latest.duration_seconds),
    },
  };
}
