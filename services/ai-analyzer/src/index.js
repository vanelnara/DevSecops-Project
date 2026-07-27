import express from 'express';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_NAME,
  NO_PIPELINE_GUIDANCE,
  OFF_TOPIC_REFUSAL,
  agentPublicConfig,
  buildAnalyzeSystemPrompt,
  buildChatSystemPrompt,
  looksInScope,
  looksPipelineRequired,
} from './agentConfig.js';
import { callChatCompletion, providerStatus } from './providers.js';

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
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    console.warn(`Unable to load env file ${filePath}: ${error.message}`);
  }
}

loadEnvFile(path.resolve(__dirname, '../.env'));
loadEnvFile(path.resolve(__dirname, '../../../.env'));

const {
  JENKINS_DB_HOST = '127.0.0.1',
  JENKINS_DB_PORT = '5432',
  JENKINS_DB_NAME = 'jenkins',
  JENKINS_DB_USER = 'jenkins',
  JENKINS_DB_PASSWORD = '',
  DATABASE_URL,
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

async function dbReachable() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function resolveLatestBuild(jobName) {
  try {
    const latest = await pool.query(
      `SELECT job_name, build_number FROM security_builds
       WHERE ($1::text IS NULL OR job_name = $1)
       ORDER BY finished_at DESC NULLS LAST, build_number DESC
       LIMIT 1`,
      [jobName || null],
    );
    return latest.rows[0] || null;
  } catch {
    return null;
  }
}

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
       AND stage_name NOT IN (
         'AI Analysis',
         'Store Findings',
         'Start Services',
         'Start Security Services'
       )
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
      priority: `P${index + 1}`,
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

async function callModel(systemPrompt, userPrompt, messages = []) {
  const result = await callChatCompletion({ systemPrompt, userPrompt, messages });
  return result;
}

async function analyzeBuild(jobName, buildNumber) {
  const context = await loadBuildContext(jobName, buildNumber);
  if (!context.build) {
    const error = new Error(`No ingested build found for ${jobName} #${buildNumber}. Push/run the Jenkins pipeline first.`);
    error.code = 'NO_PIPELINE';
    throw error;
  }

  let analysis = fallbackAnalysis(context);

  try {
    const userPrompt = JSON.stringify({
      build: context.build,
      findings: context.findings,
      stages: context.stages,
      logExcerpt: String(context.logExcerpt || '').slice(0, 4000),
    });
    const result = await callModel(buildAnalyzeSystemPrompt(), userPrompt);
    const parsed = extractJsonObject(result.content);
    if (parsed?.verdict) {
      analysis = {
        verdict: parsed.verdict,
        confidence: Number(parsed.confidence || 85),
        narrative: parsed.narrative || analysis.narrative,
        priorities: Array.isArray(parsed.priorities) ? parsed.priorities : analysis.priorities,
        model: result.model,
        provider: result.provider,
        raw: parsed,
      };
    }
  } catch (error) {
    console.warn(`AI analysis fallback: ${error.message}`);
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
    [jobName, buildNumber, AGENT_NAME, `Generated remediation plan for build #${buildNumber}`],
  );

  return analysis;
}

function localChatFallback({ question, hasPipeline, context, inScope, needsPipeline, errorMessage }) {
  if (!inScope) {
    return {
      answer: OFF_TOPIC_REFUSAL,
      inScope: false,
      needsPipeline: false,
    };
  }

  if (needsPipeline && !hasPipeline) {
    return {
      answer: NO_PIPELINE_GUIDANCE,
      inScope: true,
      needsPipeline: true,
    };
  }

  if (hasPipeline) {
    const critical = context.findings.filter((f) => f.severity === 'critical');
    if (critical.length) {
      return {
        answer: `There are ${critical.length} critical findings on build #${context.build.build_number}. Start with ${critical[0].finding_key}: ${critical[0].title}.`,
        inScope: true,
        needsPipeline: false,
        citations: critical.slice(0, 4).map((f) => f.finding_key),
      };
    }
    return {
      answer: `Build #${context.build?.build_number} is loaded with ${context.findings.length} findings. Ask about a specific finding key, risk prioritization, or remediation steps.`,
      inScope: true,
      needsPipeline: false,
      citations: context.findings.slice(0, 4).map((f) => f.finding_key),
    };
  }

  const q = String(question || '').toLowerCase();
  let tip =
    'I am online in local mode. Live Hugging Face answers will appear once the model call succeeds.';

  if (q.includes('networkpolicy') || (q.includes('kubernetes') && q.includes('network'))) {
    tip = [
      'Kubernetes NetworkPolicy controls pod-to-pod traffic using label selectors.',
      'Start with a default-deny Ingress policy in the namespace, then allow only required ports between frontend/backend/database labels.',
      'Validate with kubectl and a temporary debug pod before enforcing in production.',
    ].join(' ');
  } else if (q.includes('jenkins') || q.includes('pipeline') || q.includes('ci/cd') || q.includes('cicd')) {
    tip = [
      'Harden Jenkins by storing secrets in Credentials (not Groovy plaintext), using least-privilege agents, and failing the pipeline on critical scanner findings.',
      'For this dashboard, run Store Security Findings then AI Security Analysis so builds appear automatically.',
    ].join(' ');
  } else if (q.includes('trivy') || q.includes('container') || q.includes('image')) {
    tip = [
      'Scan images with Trivy in CI, block critical/high CVEs, rebuild from minimal base images, and sign with Cosign before deploy.',
      'Publish the Trivy report to the ingest bridge so the dashboard can track findings.',
    ].join(' ');
  } else if (q.includes('iam') || q.includes('cloud') || q.includes('aws') || q.includes('azure') || q.includes('gcp')) {
    tip = [
      'Apply least privilege: short-lived roles, no long-lived access keys in CI, scoped policies per service account, and MFA for humans.',
      'Prefer OIDC federation from Jenkins/GitHub Actions into the cloud provider.',
    ].join(' ');
  } else if (q.includes('devsecops') || q.includes('devops') || q.includes('security')) {
    tip = [
      'DevSecOps shifts security left into CI/CD: SAST, SCA, secrets scanning, container scanning, signing, and policy gates before deploy.',
      'Use the dashboard copilot for build-specific remediation once Jenkins publishes scanner output.',
    ].join(' ');
  }

  const balanceNote = errorMessage && /huggingface|401|403|402|timeout|abort/i.test(errorMessage)
    ? `\n\n(Live Hugging Face model unavailable: ${errorMessage})`
    : errorMessage
      ? `\n\n(Live model unavailable: ${errorMessage})`
      : '';

  return {
    answer: `${tip}\n\nNo pipeline is ingested yet. Run Jenkins through Store Security Findings when you want build-specific analysis and remediation.${balanceNote}`,
    inScope: true,
    needsPipeline: false,
  };
}

app.get('/health', async (_req, res) => {
  const database = await dbReachable();
  const llm = providerStatus();
  res.json({
    status: 'ok',
    service: 'security-ai-analyzer',
    agent: agentPublicConfig(),
    ...llm,
    database,
  });
});

app.get('/agent', async (_req, res) => {
  const database = await dbReachable();
  const latest = database ? await resolveLatestBuild(null) : null;
  const llm = providerStatus();
  res.json({
    online: true,
    agent: agentPublicConfig(),
    ...llm,
    database,
    pipelineAvailable: Boolean(latest),
    latestBuild: latest
      ? { jobName: latest.job_name, buildNumber: latest.build_number }
      : null,
  });
});

app.post('/analyze', async (req, res) => {
  try {
    const jobName = String(req.body?.jobName || 'Devops-project');
    const buildNumber = Number(req.body?.buildNumber);
    if (!buildNumber) return res.status(400).json({ error: 'buildNumber is required' });
    const analysis = await analyzeBuild(jobName, buildNumber);
    return res.json({ ok: true, analysis, agent: agentPublicConfig().name });
  } catch (error) {
    console.error(error);
    const status = error.code === 'NO_PIPELINE' ? 404 : 500;
    return res.status(status).json({
      error: error.message || 'Analyze failed',
      needsPipeline: error.code === 'NO_PIPELINE',
      guidance: error.code === 'NO_PIPELINE' ? NO_PIPELINE_GUIDANCE : undefined,
    });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'A question is required.' });

    const requestedJob = req.body?.jobName ? String(req.body.jobName) : '';
    let buildNumber = Number(req.body?.buildNumber) || null;
    let jobName = requestedJob || null;

    if (!buildNumber) {
      const latest = await resolveLatestBuild(jobName);
      if (latest) {
        jobName = latest.job_name;
        buildNumber = latest.build_number;
      }
    }

    jobName = jobName || 'Devops-project';
    const inScope = looksInScope(question);
    const wantsPipeline = looksPipelineRequired(question);

    let context = { findings: [], stages: [], build: null, logExcerpt: '' };
    if (buildNumber) {
      try {
        context = await loadBuildContext(jobName, buildNumber);
      } catch (dbError) {
        console.warn(`Build context unavailable: ${dbError.message}`);
      }
    }

    const hasPipeline = Boolean(context.build);
    const needsPipeline = wantsPipeline && !hasPipeline;

    // Fast local gate for clear out-of-scope + pipeline-required-without-data.
    if (!inScope || needsPipeline) {
      const local = localChatFallback({
        question,
        hasPipeline,
        context,
        inScope,
        needsPipeline,
      });
      return res.json({
        answer: local.answer,
        inScope: local.inScope,
        needsPipeline: local.needsPipeline,
        pipelineAvailable: hasPipeline,
        jobName: hasPipeline ? jobName : null,
        buildNumber: hasPipeline ? buildNumber : null,
        model: 'policy-guard',
        confidence: 100,
        citations: local.citations || [],
        suggestions: hasPipeline
          ? ['What should I fix first?', 'Summarize this build risk', 'Draft a remediation plan']
          : [
              'How do I harden a Jenkins pipeline?',
              'Explain Kubernetes NetworkPolicy basics',
              'What should I publish for dashboard ingest?',
            ],
        agent: AGENT_NAME,
        generatedAt: new Date().toISOString(),
      });
    }

    const llm = providerStatus();
    let answer;
    let model = llm.configured ? llm.model : 'local-fallback';
    let confidence = llm.configured ? 90 : 70;
    let citations = context.findings.slice(0, 4).map((f) => f.finding_key);
    let provider = llm.provider;

    try {
      const systemPrompt = buildChatSystemPrompt({
        hasPipeline,
        jobName,
        buildNumber,
      });
      const userPrompt = [
        `Question: ${question}`,
        '',
        `Pipeline available: ${hasPipeline}`,
        hasPipeline
          ? `Context JSON:\n${JSON.stringify({
              build: context.build,
              findings: context.findings.slice(0, 20),
              stages: context.stages,
            })}`
          : 'Context JSON: null (no ingested pipeline build). Answer general in-scope IT questions, or ask the user to push/run the pipeline for build-specific analysis.',
      ].join('\n');

      const result = await callModel(systemPrompt, userPrompt, req.body?.messages);
      answer = result.content;
      model = result.model;
      provider = result.provider;
    } catch (error) {
      const local = localChatFallback({
        question,
        hasPipeline,
        context,
        inScope: true,
        needsPipeline: false,
        errorMessage: error.message,
      });
      answer = local.answer;
      model = 'local-fallback';
      provider = 'local';
      confidence = 65;
      citations = local.citations || citations;
    }

    return res.json({
      answer,
      inScope: true,
      needsPipeline: false,
      pipelineAvailable: hasPipeline,
      jobName: hasPipeline ? jobName : null,
      buildNumber: hasPipeline ? buildNumber : null,
      model,
      provider,
      confidence,
      citations,
      suggestions: hasPipeline
        ? ['What should I fix first?', 'Summarize this build risk', 'Draft a remediation plan']
        : [
            'How do I secure container images with Trivy?',
            'Best practices for Jenkins credential binding',
            'Explain cloud IAM least privilege',
          ],
      agent: AGENT_NAME,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Chat failed' });
  }
});

app.listen(Number(AI_PORT), () => {
  console.log(`${AGENT_NAME} listening on http://localhost:${AI_PORT}`);
});
