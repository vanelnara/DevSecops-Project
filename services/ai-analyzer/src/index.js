import express from 'express';
import pg from 'pg';

const {
  JENKINS_DB_HOST = '127.0.0.1',
  JENKINS_DB_PORT = '5432',
  JENKINS_DB_NAME = 'jenkins',
  JENKINS_DB_USER = 'jenkins',
  JENKINS_DB_PASSWORD = '',
  DATABASE_URL,
  DEEPSEEK_API_KEY = '',
  DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions',
  DEEPSEEK_MODEL = 'deepseek-chat',
  AI_PORT = '4300',
} = process.env;

const pool = new pg.Pool(
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

const app = express();
app.use(express.json({ limit: '2mb' }));

async function loadBuildContext(jobName, buildNumber) {
  const build = await pool.query(
    `SELECT * FROM security_builds WHERE job_name = $1 AND build_number = $2`,
    [jobName, buildNumber],
  );
  const findings = await pool.query(
    `SELECT finding_key, severity, title, source, asset, status, confidence
     FROM findings
     WHERE job_name = $1 AND build_number = $2
     ORDER BY CASE severity
       WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       finding_key
     LIMIT 40`,
    [jobName, buildNumber],
  );
  const stages = await pool.query(
    `SELECT stage_name, status, duration_seconds, details
     FROM pipeline_stages
     WHERE job_name = $1 AND build_number = $2
     ORDER BY finished_at NULLS LAST, stage_name`,
    [jobName, buildNumber],
  );
  const logs = await pool.query(
    `SELECT log_excerpt FROM pipeline_runs WHERE job_name = $1 AND build_number = $2`,
    [jobName, buildNumber],
  );

  return {
    build: build.rows[0] || null,
    findings: findings.rows,
    stages: stages.rows,
    logExcerpt: logs.rows[0]?.log_excerpt || '',
  };
}

function fallbackAnalysis(context) {
  const critical = context.findings.filter((f) => f.severity === 'critical').length;
  const high = context.findings.filter((f) => f.severity === 'high').length;
  const top = context.findings[0];
  return {
    verdict:
      critical > 0
        ? `Elevated risk — ${critical} critical finding(s) remain on build #${context.build?.build_number || '?'}`
        : high > 0
          ? `Moderate risk — ${high} high finding(s) need remediation`
          : 'Risk contained — no critical or high findings in the latest scan set',
    confidence: 80,
    narrative: top
      ? `Top issue: ${top.title} (${top.source} / ${top.severity}). Review scanner reports and remediations before promoting the next release.`
      : 'No scanner findings were ingested for this build. Confirm report upload from the Jenkins publish stage.',
    priorities: context.findings.slice(0, 3).map((finding, index) => ({
      priority: `P${index}`,
      title: finding.title,
      impact: `${finding.severity} finding from ${finding.source}`,
      effort: finding.severity === 'critical' ? '30–60 min' : '20–45 min',
    })),
    model: 'local-fallback',
  };
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callDeepSeek(systemPrompt, userPrompt) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${body}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || '';
}

async function analyzeBuild(jobName, buildNumber) {
  const context = await loadBuildContext(jobName, buildNumber);
  let analysis = fallbackAnalysis(context);

  try {
    const systemPrompt =
      'You are a DevSecOps security analyst. Return ONLY valid JSON with keys: verdict, confidence, narrative, priorities. priorities is an array of {priority,title,impact,effort}. Be concise and actionable.';
    const userPrompt = JSON.stringify({
      build: context.build,
      findings: context.findings,
      stages: context.stages,
      logExcerpt: String(context.logExcerpt || '').slice(0, 4000),
    });
    const content = await callDeepSeek(systemPrompt, userPrompt);
    const parsed = extractJsonObject(content);
    if (parsed?.verdict) {
      analysis = {
        verdict: parsed.verdict,
        confidence: Number(parsed.confidence || 85),
        narrative: parsed.narrative || analysis.narrative,
        priorities: Array.isArray(parsed.priorities) ? parsed.priorities : analysis.priorities,
        model: DEEPSEEK_MODEL,
        raw: parsed,
      };
    }
  } catch (error) {
    console.warn(`DeepSeek analysis fallback: ${error.message}`);
  }

  await pool.query(
    `INSERT INTO ai_analyses (job_name, build_number, verdict, confidence, narrative, priorities, model, raw_response)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (job_name, build_number) DO UPDATE SET
       verdict = EXCLUDED.verdict,
       confidence = EXCLUDED.confidence,
       narrative = EXCLUDED.narrative,
       priorities = EXCLUDED.priorities,
       model = EXCLUDED.model,
       raw_response = EXCLUDED.raw_response,
       created_at = NOW()`,
    [
      jobName,
      buildNumber,
      analysis.verdict,
      analysis.confidence,
      analysis.narrative,
      JSON.stringify(analysis.priorities || []),
      analysis.model,
      JSON.stringify(analysis.raw || analysis),
    ],
  );

  await pool.query(
    `INSERT INTO activity_events (job_name, build_number, actor, action)
     VALUES ($1, $2, $3, $4)`,
    [jobName, buildNumber, 'AI Analyzer', `Generated remediation plan for build #${buildNumber}`],
  );

  return analysis;
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'security-ai-analyzer',
    deepseekConfigured: Boolean(DEEPSEEK_API_KEY),
  });
});

app.post('/analyze', async (req, res) => {
  try {
    const jobName = String(req.body?.jobName || 'Devops-project');
    const buildNumber = Number(req.body?.buildNumber);
    if (!buildNumber) return res.status(400).json({ error: 'buildNumber is required' });
    const analysis = await analyzeBuild(jobName, buildNumber);
    return res.json({ ok: true, analysis });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Analyze failed' });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'A question is required.' });

    const jobName = String(req.body?.jobName || 'Devops-project');
    let buildNumber = Number(req.body?.buildNumber);
    if (!buildNumber) {
      const latest = await pool.query(
        `SELECT build_number FROM security_builds
         WHERE job_name = $1
         ORDER BY build_number DESC LIMIT 1`,
        [jobName],
      );
      buildNumber = latest.rows[0]?.build_number;
    }

    const context = buildNumber ? await loadBuildContext(jobName, buildNumber) : { findings: [], stages: [], build: null, logExcerpt: '' };
    let answer =
      'No DeepSeek key configured. Based on stored findings, remediate critical secrets and high CVEs first, then rerun the pipeline.';

    try {
      const systemPrompt =
        'You are a concise DevSecOps assistant. Answer using the provided build findings and stage data. Cite finding IDs when useful.';
      const userPrompt = `Question: ${question}\n\nContext JSON:\n${JSON.stringify({
        build: context.build,
        findings: context.findings.slice(0, 20),
        stages: context.stages,
      })}`;
      answer = await callDeepSeek(systemPrompt, userPrompt);
    } catch (error) {
      const critical = context.findings.filter((f) => f.severity === 'critical');
      if (critical.length) {
        answer = `There are ${critical.length} critical findings. Start with ${critical[0].finding_key}: ${critical[0].title}.`;
      } else {
        answer = `Unable to reach DeepSeek (${error.message}). Review the latest stored findings in the dashboard and remediate high-severity items first.`;
      }
    }

    return res.json({
      answer,
      model: DEEPSEEK_API_KEY ? DEEPSEEK_MODEL : 'local-fallback',
      confidence: DEEPSEEK_API_KEY ? 90 : 70,
      citations: context.findings.slice(0, 4).map((f) => f.finding_key),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Chat failed' });
  }
});

app.listen(Number(AI_PORT), () => {
  console.log(`Security AI analyzer listening on http://localhost:${AI_PORT}`);
});
