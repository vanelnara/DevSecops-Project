import { useEffect, useState } from 'react';
import {
  Bot,
  ChevronRight,
  Clock3,
  Database,
  GitBranch,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from 'lucide-react';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function StatusPill({ status }) {
  const value = String(status || 'unknown');
  const label = value.replace(/-/g, ' ');
  return (
    <span className={classNames('status-pill', `status-${value}`)}>
      <i /> {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  );
}

function Panel({ title, subtitle, action, children, className }) {
  return (
    <section className={classNames('panel', className)}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const DEFAULT_SUGGESTIONS = [
  'How do I harden a Jenkins pipeline?',
  'Explain Kubernetes NetworkPolicy basics',
  'Best practices for cloud IAM least privilege',
];

export default function AIView({
  data,
  builds,
  onSelectBuild,
  onAnalyze,
  analyzing,
  onRefresh,
  user,
}) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState(DEFAULT_SUGGESTIONS);
  const [agentStatus, setAgentStatus] = useState({ online: false, loading: true });
  const [analyzeMessage, setAnalyzeMessage] = useState('');

  const selectedBuild = data?.selectedBuild || null;
  const analysis = data?.aiAnalysis || null;
  const summary = data?.summary || {};
  const findings = data?.alerts || [];
  const hasLive = data?.dataMode === 'postgres' && selectedBuild;
  const buildOptions = (builds?.length ? builds : data?.pipelines) || [];
  const priorities = analysis?.priorities || [];
  const topFindings = findings.slice(0, 6);

  async function loadAgentStatus() {
    try {
      const response = await fetch('/api/ai/status');
      const payload = await response.json();
      setAgentStatus({ loading: false, ...payload, online: Boolean(payload.online) });
    } catch (error) {
      setAgentStatus({
        online: false,
        loading: false,
        error: error.message,
        guidance: 'Start services/ai-analyzer on port 4300 alongside the dashboard.',
      });
    }
  }

  useEffect(() => {
    loadAgentStatus();
    const timer = setInterval(loadAgentStatus, 12000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const agentName = agentStatus.agent?.name || 'SentinelOps Security Copilot';
    if (!hasLive) {
      setMessages([
        {
          role: 'assistant',
          content: `${agentName} is ready. You can ask DevOps, DevSecOps, networking, or cloud questions now. No pipeline is ingested yet — run Jenkins and publish findings when you want build-specific analysis and remediation.`,
        },
      ]);
      setSuggestions(DEFAULT_SUGGESTIONS);
      setQuestion('');
    } else {
      setMessages([
        {
          role: 'assistant',
          content: analysis?.verdict
            ? `Loaded ${selectedBuild.jobName} #${selectedBuild.buildNumber}. ${analysis.verdict}`
            : `Build #${selectedBuild.buildNumber} is loaded. Ask about findings, or click Re-run analysis for a fresh remediation plan.`,
        },
      ]);
      setSuggestions([
        'What should I fix first?',
        'Summarize this build risk',
        'Draft a remediation plan',
      ]);
      setQuestion('');
    }

    if (!user) return undefined;
    let cancelled = false;
    const params = new URLSearchParams({ limit: '40' });
    if (selectedBuild?.jobName) params.set('job', selectedBuild.jobName);
    if (selectedBuild?.buildNumber) params.set('build', String(selectedBuild.buildNumber));
    fetch(`/api/auth/chat?${params.toString()}`, { credentials: 'include' })
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled || !payload.messages?.length) return;
        setMessages(payload.messages.map((row) => ({
          role: row.role,
          content: row.content,
          citations: row.meta?.citations,
          needsPipeline: row.meta?.needsPipeline,
          model: row.meta?.model,
        })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [
    hasLive,
    selectedBuild?.jobName,
    selectedBuild?.buildNumber,
    analysis?.verdict,
    agentStatus.agent?.name,
    user?.id,
  ]);

  async function ask(nextQuestion) {
    if (!nextQuestion.trim() || sending) return;
    const trimmed = nextQuestion.trim();
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-8);

    setMessages((current) => [...current, { role: 'user', content: trimmed }]);
    setQuestion('');
    setSending(true);
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          question: trimmed,
          jobName: selectedBuild?.jobName,
          buildNumber: selectedBuild?.buildNumber,
          messages: history,
        }),
      });
      const raw = await response.text();
      let result = {};
      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          raw?.trim()
            ? `Dashboard returned invalid JSON (${response.status}). Is the API on :4100 running?`
            : 'Dashboard API returned an empty response. Start security-dashboard server on port 4100 (npm run dev) and ensure ai-analyzer is on :4300.',
        );
      }
      if (!response.ok && !result.answer) {
        throw new Error(result.error || `Chat failed (${response.status})`);
      }
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: result.answer || result.error || 'No answer',
          citations: result.citations,
          needsPipeline: result.needsPipeline,
          inScope: result.inScope,
          model: result.model,
        },
      ]);
      if (Array.isArray(result.suggestions) && result.suggestions.length) {
        setSuggestions(result.suggestions);
      }
      if (result.pipelineAvailable && !hasLive && onRefresh) {
        onRefresh();
      }
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: error.message }]);
    } finally {
      setSending(false);
      loadAgentStatus();
    }
  }

  function submit(event) {
    event.preventDefault();
    ask(question);
  }

  async function runAnalysis() {
    setAnalyzeMessage('');
    if (!hasLive) {
      setAnalyzeMessage('No pipeline is ingested yet. Push/run Jenkins first, then analyze.');
      await ask('Can you analyze my pipeline findings and provide remediation?');
      return;
    }
    try {
      await onAnalyze();
      setAnalyzeMessage('Analysis requested from the AI agent. Refreshing dashboard…');
      if (onRefresh) onRefresh();
    } catch (error) {
      setAnalyzeMessage(error.message || 'Analyze failed');
    }
  }

  const selectedKey = selectedBuild
    ? `${selectedBuild.jobName}::${selectedBuild.buildNumber}`
    : '';

  return (
    <main className="dashboard ai-lab">
      {!hasLive && (
        <div className="waiting-banner">
          <Database size={16} />
          <span>
            {data?.waitingReason
              || 'No pipeline ingested yet — chat still works for DevOps / DevSecOps / networking / cloud. Push Jenkins to unlock build analysis.'}
          </span>
        </div>
      )}

      <section className="context-strip">
        <div className={classNames('live-indicator', agentStatus.online ? 'agent-online' : 'agent-offline')}>
          <i />
          {agentStatus.loading
            ? 'CHECKING AI AGENT'
            : agentStatus.online
              ? 'AI AGENT ONLINE'
              : 'AI AGENT OFFLINE'}
        </div>
        {hasLive ? (
          <div className="context-pipeline">
            <span>Investigating build</span>
            <strong>
              {selectedBuild.jobName} <em>#{selectedBuild.buildNumber}</em>
            </strong>
            <StatusPill status={selectedBuild.status} />
          </div>
        ) : (
          <div className="context-pipeline">
            <span>Investigating build</span>
            <strong>No build ingested yet</strong>
            <StatusPill status="waiting" />
          </div>
        )}
        <div className="context-meta">
          <div>
            <GitBranch size={14} />
            {hasLive ? `${selectedBuild.branch} · ${selectedBuild.commit}` : 'branch · commit'}
          </div>
          <div>
            <Clock3 size={14} />
            {hasLive ? `${selectedBuild.duration} · ${selectedBuild.finishedAt}` : 'duration · waiting'}
          </div>
          <div>
            {agentStatus.online ? <Radio size={14} /> : <WifiOff size={14} />}
            {agentStatus.model || agentStatus.agent?.model || 'model pending'}
          </div>
        </div>
        <div className="ai-hero-actions context-ai-actions">
          {buildOptions.length > 0 && (
            <label className="ai-build-select">
              <span>Switch build</span>
              <select
                value={selectedKey}
                onChange={(event) => {
                  const [jobName, buildNumber] = event.target.value.split('::');
                  if (jobName && buildNumber) onSelectBuild(jobName, Number(buildNumber));
                }}
              >
                {buildOptions.map((build) => (
                  <option
                    key={`${build.jobName}-${build.id || build.buildNumber}`}
                    value={`${build.jobName}::${build.id ?? build.buildNumber}`}
                  >
                    {build.name || build.jobName} #{build.id ?? build.buildNumber}
                    {' · '}
                    {build.status}
                    {' · risk '}
                    {build.risk ?? '—'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="outline-button"
            disabled={analyzing}
            onClick={runAnalysis}
          >
            {analyzing ? 'Analyzing…' : hasLive ? 'Re-run analysis' : 'Request analysis'}
          </button>
        </div>
      </section>

      <section className="ai-agent-bar">
        <div>
          <strong>{agentStatus.agent?.name || 'SentinelOps Security Copilot'}</strong>
          <span>
            {agentStatus.online
              ? 'Connected to ai-analyzer · scoped to networking, DevOps, DevSecOps, cloud'
              : agentStatus.guidance || 'Start ai-analyzer on :4300 so the dashboard can talk to the agent'}
          </span>
        </div>
        <div className="ai-domain-chips">
          {(agentStatus.agent?.domains || [
            'DevSecOps',
            'CI/CD',
            'Cloud',
            'Networking',
          ]).slice(0, 4).map((domain) => (
            <em key={domain}>{domain.split('(')[0].split('&')[0].trim()}</em>
          ))}
        </div>
      </section>

      <section className="ai-build-strip">
        <article className="ai-stat-card">
          <span>Build</span>
          <strong>{hasLive ? `#${selectedBuild.buildNumber}` : '—'}</strong>
          <small>{hasLive ? selectedBuild.jobName : 'Waiting for ingest'}</small>
        </article>
        <article className="ai-stat-card">
          <span>Status</span>
          <strong className="ai-stat-status">
            <StatusPill status={hasLive ? selectedBuild.status : 'waiting'} />
          </strong>
          <small>{hasLive ? `${selectedBuild.branch} · ${selectedBuild.commit}` : 'branch · commit'}</small>
        </article>
        <article className="ai-stat-card">
          <span>Risk score</span>
          <strong>{summary.riskScore ?? 0}/100</strong>
          <small>{hasLive ? `${selectedBuild.duration || '—'} duration` : 'Fills after ingest'}</small>
        </article>
        <article className="ai-stat-card">
          <span>Findings</span>
          <strong>{summary.totalFindings ?? 0}</strong>
          <small>{summary.critical ?? 0} critical · {summary.high ?? 0} high</small>
        </article>
      </section>

      {analyzeMessage ? (
        <div className="ai-inline-note">
          <Sparkles size={14} />
          <span>{analyzeMessage}</span>
        </div>
      ) : null}

      <section className="ai-workspace">
        <div className="ai-workspace-main">
          <Panel
            className="ai-analysis-panel"
            title="AI analysis"
            subtitle={
              selectedBuild
                ? `Stored verdict for ${selectedBuild.jobName} #${selectedBuild.buildNumber}`
                : 'Live verdict from the AI agent when a build is ingested'
            }
            action={(
              <span className="ai-live">
                <Sparkles size={13} /> {analysis?.model || (agentStatus.online ? 'ready' : 'offline')}
              </span>
            )}
          >
            {!analysis ? (
              <div className="ai-empty-inline">
                <Bot size={22} />
                <div>
                  <strong>{hasLive ? 'No analysis stored yet' : 'Analysis waiting for a pipeline'}</strong>
                  <p>
                    {hasLive
                      ? 'Click Re-run analysis to call the AI agent backend.'
                      : 'Ask the copilot general IT questions now. After Jenkins publishes, analysis and remediation fill here.'}
                  </p>
                  <button type="button" className="text-button" onClick={runAnalysis} disabled={analyzing}>
                    {hasLive ? 'Run AI analysis' : 'Ask agent about missing pipeline'} <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="ai-verdict-hero">
                  <div className="ai-orb"><Bot size={22} /></div>
                  <div className="ai-verdict-copy">
                    <span>{analysis.confidence}% confidence</span>
                    <strong>{analysis.verdict}</strong>
                  </div>
                  <div
                    className="ai-confidence-ring"
                    style={{ '--confidence': `${Number(analysis.confidence || 0)}%` }}
                  >
                    <em>{analysis.confidence || 0}</em>
                  </div>
                </div>
                <p className="ai-narrative-block">{analysis.narrative}</p>
              </>
            )}
          </Panel>

          <Panel title="Remediation plan" subtitle="Prioritized actions from the AI agent">
            {!priorities.length ? (
              <div className="ai-empty-inline">
                <ShieldCheck size={22} />
                <div>
                  <strong>{hasLive ? 'No remediation steps yet' : 'Remediation unlocks after ingest'}</strong>
                  <p>
                    {hasLive
                      ? 'Run AI analysis to generate prioritized fixes.'
                      : 'Push the pipeline, then request analysis — remediation cards become clickable chat prompts.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="remediation-modern">
                {priorities.map((item, index) => (
                  <article className="remediation-card" key={`${item.priority}-${item.title}`}>
                    <header>
                      <em>{item.priority || `P${index + 1}`}</em>
                      <small>{item.effort || '—'}</small>
                    </header>
                    <strong>{item.title}</strong>
                    <p>{item.impact}</p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => ask(`Explain how to implement: ${item.title}`)}
                    >
                      Ask AI about this <ChevronRight size={14} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Key findings" subtitle="Evidence chips — click to interrogate the agent">
            {!topFindings.length ? (
              <div className="panel-placeholder">
                {hasLive
                  ? 'No findings linked to this build yet.'
                  : 'Findings appear after scanner reports are ingested. Chat still works for general IT guidance.'}
              </div>
            ) : (
              <div className="ai-finding-chips">
                {topFindings.map((finding) => (
                  <button
                    key={finding.id || finding.findingKey}
                    type="button"
                    className="ai-finding-chip"
                    onClick={() => ask(`Explain finding ${finding.findingKey}: ${finding.title}`)}
                  >
                    <span className={classNames('severity-label', `severity-${finding.severity}`)}>
                      {finding.severity}
                    </span>
                    <strong>{finding.findingKey}</strong>
                    <small>{finding.title}</small>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="ai-chat-shell">
          <div className="ai-chat-header">
            <div className="ai-orb compact"><Bot size={18} /></div>
            <div>
              <strong>Security copilot</strong>
              <span>
                {hasLive
                  ? `Context: ${selectedBuild.jobName} #${selectedBuild.buildNumber}`
                  : 'No pipeline yet · general IT / DevSecOps chat enabled'}
              </span>
            </div>
          </div>

          <div className="ai-chat-stream">
            {messages.map((message, index) => (
              <div className={classNames('ai-bubble', message.role)} key={`${message.role}-${index}`}>
                {message.role === 'assistant' ? <Bot size={14} /> : null}
                <div>
                  <p>{message.content}</p>
                  {message.needsPipeline ? (
                    <small className="ai-need-pipeline">Push/run Jenkins to unlock build analysis</small>
                  ) : null}
                  {message.inScope === false ? (
                    <small className="ai-out-of-scope">Out of domain · DevOps / DevSecOps / cloud / networking only</small>
                  ) : null}
                  {message.citations?.length ? (
                    <small>Sources: {message.citations.join(' · ')}</small>
                  ) : null}
                </div>
              </div>
            ))}
            {sending && (
              <div className="ai-bubble assistant">
                <Bot size={14} />
                <div className="typing"><i /><i /><i /></div>
              </div>
            )}
          </div>

          <div className="ai-suggest-row">
            {suggestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => ask(prompt)}
                disabled={sending}
              >
                {prompt}
              </button>
            ))}
          </div>

          <form className="ai-composer" onSubmit={submit}>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about DevOps, DevSecOps, networking, cloud…"
            />
            <button
              type="submit"
              disabled={sending || !question.trim()}
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </form>
        </aside>
      </section>
    </main>
  );
}
