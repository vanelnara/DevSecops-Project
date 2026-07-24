import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  Bell,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Clock3,
  Command,
  FileSearch,
  GitBranch,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Network,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  TrendingDown,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function Sidebar({ open, onClose }) {
  const navigation = [
    { label: 'Security overview', icon: LayoutDashboard, active: true },
    { label: 'Pipelines', icon: Workflow, count: 4 },
    { label: 'Findings', icon: ShieldAlert, count: 47 },
    { label: 'AI investigations', icon: Bot },
    { label: 'Assets', icon: Boxes },
    { label: 'Compliance', icon: ShieldCheck },
  ];

  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="Close navigation" />}
      <aside className={classNames('sidebar', open && 'sidebar-open')}>
        <div className="brand">
          <div className="brand-mark"><Shield size={19} /></div>
          <div>
            <strong>SentinelOps</strong>
            <span>Security Intelligence</span>
          </div>
          <button className="icon-button sidebar-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">DL</div>
          <div>
            <strong>DevSecOps Lab</strong>
            <span>Production workspace</span>
          </div>
          <ChevronDown size={16} />
        </div>

        <nav className="nav-list">
          <span className="nav-heading">Monitor</span>
          {navigation.map(({ label, icon: Icon, count, active }) => (
            <button key={label} className={classNames('nav-item', active && 'active')}>
              <Icon size={18} />
              <span>{label}</span>
              {count && <em>{count}</em>}
            </button>
          ))}
          <span className="nav-heading nav-heading-spaced">Manage</span>
          <button className="nav-item"><Network size={18} /><span>Integrations</span></button>
          <button className="nav-item"><Settings size={18} /><span>Settings</span></button>
        </nav>

        <div className="sidebar-status">
          <div className="status-ring"><Activity size={17} /></div>
          <div>
            <strong>All systems operational</strong>
            <span>9 collectors connected</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Header({ onMenu, generatedAt, onRefresh, refreshing }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button menu-button" onClick={onMenu}><Menu size={20} /></button>
        <div className="page-title">
          <div className="eyebrow">SECURITY COMMAND CENTER</div>
          <h1>Pipeline intelligence</h1>
        </div>
      </div>
      <div className="topbar-actions">
        <label className="search-box">
          <Search size={17} />
          <input placeholder="Search CVEs, builds, assets…" />
          <kbd>⌘ K</kbd>
        </label>
        <button className="period-button">
          Last 7 days <ChevronDown size={15} />
        </button>
        <button className="icon-button" onClick={onRefresh} title={`Updated ${generatedAt}`}>
          <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
        </button>
        <button className="icon-button notification-button">
          <Bell size={18} /><span />
        </button>
        <div className="user-avatar">AD</div>
      </div>
    </header>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone, progress }) {
  return (
    <article className="metric-card">
      <div className={classNames('metric-icon', tone)}><Icon size={19} /></div>
      <div className="metric-copy">
        <span>{label}</span>
        <div className="metric-value">{value}</div>
        <small>{detail}</small>
      </div>
      {progress !== undefined && (
        <div className="metric-progress">
          <span style={{ '--progress': `${progress}%` }} />
        </div>
      )}
    </article>
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

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.dataKey}>
          <i style={{ background: item.color }} /> {item.name}: {item.value}
        </span>
      ))}
    </div>
  );
}

function RiskOverview({ data }) {
  const total = data.severity.reduce((sum, item) => sum + item.value, 0);
  return (
    <Panel
      title="Risk posture"
      subtitle="Open findings by severity"
      action={<button className="text-button">View all <ChevronRight size={15} /></button>}
    >
      <div className="risk-layout">
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie
                data={data.severity}
                dataKey="value"
                nameKey="name"
                innerRadius={68}
                outerRadius={91}
                startAngle={90}
                endAngle={-270}
                strokeWidth={0}
              >
                {data.severity.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <strong>{total}</strong>
            <span>open risks</span>
          </div>
        </div>
        <div className="severity-list">
          {data.severity.map((item) => (
            <div className="severity-row" key={item.name}>
              <div><i style={{ background: item.color }} /><span>{item.name}</span></div>
              <strong>{item.value}</strong>
              <em>{Math.round((item.value / total) * 100)}%</em>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function TrendChart({ data }) {
  return (
    <Panel
      className="trend-panel"
      title="Finding trend"
      subtitle="Open security findings over the last 7 days"
      action={<span className="positive-delta"><TrendingDown size={14} /> 18% lower</span>}
    >
      <div className="chart-legend">
        <span><i className="legend-critical" /> Critical</span>
        <span><i className="legend-high" /> High</span>
        <span><i className="legend-medium" /> Medium</span>
      </div>
      <ResponsiveContainer width="100%" height={225}>
        <AreaChart data={data} margin={{ top: 12, right: 8, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="criticalFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="highFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="medium" name="Medium" stroke="#eab308" strokeWidth={2} fill="transparent" />
          <Area type="monotone" dataKey="high" name="High" stroke="#f97316" strokeWidth={2} fill="url(#highFill)" />
          <Area type="monotone" dataKey="critical" name="Critical" stroke="#ef4444" strokeWidth={2} fill="url(#criticalFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function PipelineTable({ pipelines }) {
  return (
    <Panel
      className="pipeline-panel"
      title="Recent pipeline runs"
      subtitle="Security posture and execution status"
      action={<button className="outline-button">Open pipeline explorer</button>}
    >
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Pipeline</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Findings</th>
              <th>Duration</th>
              <th>Completed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pipelines.map((pipeline) => (
              <tr key={pipeline.id}>
                <td>
                  <div className="pipeline-name">
                    <span className="pipeline-glyph"><GitBranch size={16} /></span>
                    <div>
                      <strong>{pipeline.name} <em>#{pipeline.id}</em></strong>
                      <span>{pipeline.branch} · {pipeline.commit}</span>
                    </div>
                  </div>
                </td>
                <td><StatusPill status={pipeline.status} /></td>
                <td>
                  <div className="risk-cell">
                    <strong>{pipeline.risk}</strong>
                    <span><i style={{ width: `${pipeline.risk}%` }} /></span>
                  </div>
                </td>
                <td>{pipeline.findings}</td>
                <td>{pipeline.duration}</td>
                <td>{pipeline.finishedAt}</td>
                <td><button className="row-action"><ChevronRight size={17} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function StatusPill({ status }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={classNames('status-pill', `status-${status}`)}>
      <i /> {label}
    </span>
  );
}

function Alerts({ alerts }) {
  const sorted = [...alerts].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return (
    <Panel
      className="alerts-panel"
      title="Priority alerts"
      subtitle="Correlated across security scanners"
      action={<button className="filter-button">All severities <ChevronDown size={14} /></button>}
    >
      <div className="alert-list">
        {sorted.map((alert) => (
          <article className="alert-item" key={alert.id}>
            <div className={classNames('alert-severity', `severity-${alert.severity}`)}>
              <AlertTriangle size={17} />
            </div>
            <div className="alert-main">
              <div className="alert-title">
                <strong>{alert.title}</strong>
                <span className={classNames('severity-label', `severity-${alert.severity}`)}>{alert.severity}</span>
              </div>
              <p>{alert.asset}</p>
              <div className="alert-meta">
                <span>{alert.id}</span><i /> <span>{alert.source}</span><i />
                <span>{alert.pipeline}</span>
              </div>
            </div>
            <div className="alert-side">
              <span>{alert.age}</span>
              <small>{alert.confidence}% confidence</small>
              <StatusPill status={alert.status === 'in-progress' ? 'unstable' : alert.status} />
            </div>
          </article>
        ))}
      </div>
      <button className="panel-footer-button">View all 47 findings <ChevronRight size={15} /></button>
    </Panel>
  );
}

function Controls({ controls }) {
  return (
    <Panel title="Control coverage" subtitle="Scanner health and policy coverage">
      <div className="control-list">
        {controls.map((control) => (
          <div className="control-row" key={control.name}>
            <div className={classNames('control-state', control.status)}>
              {control.status === 'passing' ? <Check size={15} /> : <AlertTriangle size={15} />}
            </div>
            <div className="control-copy">
              <div><strong>{control.name}</strong><span>{control.tool}</span></div>
              <div className="coverage-track"><i style={{ width: `${control.coverage}%` }} /></div>
            </div>
            <strong>{control.coverage}%</strong>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StagePerformance({ data }) {
  return (
    <Panel title="Stage performance" subtitle="Duration against 30-day baseline">
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="stage"
            axisLine={false}
            tickLine={false}
            width={74}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="baseline" name="Baseline" fill="#26384a" radius={[0, 4, 4, 0]} barSize={7} />
          <Bar dataKey="duration" name="Current" fill="#38bdf8" radius={[0, 4, 4, 0]} barSize={7} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function AIAnalyst({ analysis }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'I have analyzed the latest pipeline. Ask me about risks, root causes, or remediation.',
    },
  ]);
  const [sending, setSending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!question.trim() || sending) return;
    const nextQuestion = question.trim();
    setMessages((current) => [...current, { role: 'user', content: nextQuestion }]);
    setQuestion('');
    setSending(true);
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: nextQuestion,
          jobName: analysis.jobName,
          buildNumber: analysis.buildNumber,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'AI request failed');
      setMessages((current) => [...current, { role: 'assistant', content: result.answer, citations: result.citations }]);
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: error.message }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <Panel
      className="ai-panel"
      title="AI security analyst"
      subtitle="Context-aware analysis of pipeline evidence"
      action={<span className="ai-live"><Sparkles size={13} /> Preview</span>}
    >
      <div className="ai-verdict">
        <div className="ai-orb"><Bot size={24} /></div>
        <div>
          <span>Latest verdict · {analysis.confidence}% confidence</span>
          <strong>{analysis.verdict}</strong>
        </div>
      </div>
      <p className="ai-narrative">{analysis.narrative}</p>
      <div className="remediation-list">
        <span className="section-label">Recommended actions</span>
        {analysis.priorities.map((item) => (
          <div className="remediation-item" key={item.title}>
            <em>{item.priority}</em>
            <div><strong>{item.title}</strong><span>{item.impact}</span></div>
            <small>{item.effort}</small>
          </div>
        ))}
      </div>
      <div className="chat-window">
        {messages.slice(-4).map((message, index) => (
          <div className={classNames('chat-message', message.role)} key={`${message.role}-${index}`}>
            {message.role === 'assistant' && <Bot size={16} />}
            <div>
              <p>{message.content}</p>
              {message.citations && <small>Sources: {message.citations.join(' · ')}</small>}
            </div>
          </div>
        ))}
        {sending && <div className="chat-message assistant"><Bot size={16} /><div className="typing"><i /><i /><i /></div></div>}
      </div>
      <form className="ai-prompt" onSubmit={submit}>
        <Command size={17} />
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about a finding, root cause, or remediation…"
        />
        <button type="submit" disabled={sending || !question.trim()}><Send size={16} /></button>
      </form>
      <div className="suggested-prompts">
        {['What should I fix first?', 'Explain build 35', 'Create a remediation plan'].map((prompt) => (
          <button key={prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>
        ))}
      </div>
    </Panel>
  );
}

function ActivityFeed({ activity }) {
  return (
    <Panel title="Live activity" subtitle="Latest security and deployment events">
      <div className="activity-feed">
        {activity.map((event, index) => (
          <div className="activity-row" key={`${event.actor}-${event.time}`}>
            <div className="activity-line">
              <i>{index === 0 ? <Zap size={13} /> : <Check size={13} />}</i>
              {index < activity.length - 1 && <span />}
            </div>
            <div><strong>{event.actor}</strong><p>{event.action}</p></div>
            <time>{event.time}</time>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-shield"><Shield size={30} /></div>
      <strong>Loading security intelligence</strong>
      <span>Correlating pipeline evidence…</span>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function loadDashboard() {
    setRefreshing(true);
    try {
      const response = await fetch('/api/dashboard');
      if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
      setData(await response.json());
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const updatedLabel = useMemo(() => {
    if (!data?.generatedAt) return 'Never';
    return new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [data?.generatedAt]);

  if (!data && !error) return <LoadingState />;

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-shell">
        <Header
          onMenu={() => setSidebarOpen(true)}
          generatedAt={updatedLabel}
          onRefresh={loadDashboard}
          refreshing={refreshing}
        />
        {error ? (
          <div className="error-banner">
            <AlertTriangle size={19} />
            <div><strong>Unable to load dashboard</strong><span>{error}</span></div>
            <button onClick={loadDashboard}>Retry</button>
          </div>
        ) : (
          <main className="dashboard">
            <section className="context-strip">
              <div className="live-indicator"><i /> LIVE SECURITY POSTURE</div>
              <div className="context-pipeline">
                <span>Selected pipeline</span>
                <strong>{data.selectedBuild?.jobName || data.pipelines?.[0]?.name || 'Devops-project'} <em>#{data.selectedBuild?.buildNumber || data.pipelines?.[0]?.id}</em></strong>
                <StatusPill status={data.selectedBuild?.status || data.pipelines?.[0]?.status || 'unstable'} />
              </div>
              <div className="context-meta">
                <div><GitBranch size={14} /> {data.selectedBuild?.branch || 'main'} · {data.selectedBuild?.commit || 'n/a'}</div>
                <div><Clock3 size={14} /> Updated {updatedLabel}{data.selectedBuild?.duration ? ` · ${data.selectedBuild.duration}` : ''}</div>
                <button>Open build <ChevronRight size={14} /></button>
              </div>
            </section>

            <section className="metrics-grid">
              <MetricCard
                label="Security risk score"
                value={`${data.summary.riskScore}/100`}
                detail={<span className="good-detail"><ArrowDownRight size={13} /> {Math.abs(data.summary.riskDelta)} points this week</span>}
                icon={CircleGauge}
                tone="orange"
                progress={data.summary.riskScore}
              />
              <MetricCard
                label="Critical findings"
                value={data.summary.critical}
                detail={`${data.summary.high} high severity findings`}
                icon={ShieldAlert}
                tone="red"
              />
              <MetricCard
                label="Blocked builds"
                value={data.summary.blockedBuilds}
                detail="Across 32 pipeline runs"
                icon={SquareTerminal}
                tone="purple"
              />
              <MetricCard
                label="Security coverage"
                value={`${data.summary.coverage}%`}
                detail="9 of 9 controls reporting"
                icon={ShieldCheck}
                tone="blue"
                progress={data.summary.coverage}
              />
              <MetricCard
                label="Mean time to resolve"
                value={data.summary.meanTimeToResolve}
                detail="34 minutes faster this week"
                icon={Clock3}
                tone="green"
              />
            </section>

            <section className="overview-grid">
              <RiskOverview data={data} />
              <TrendChart data={data.trend} />
            </section>

            <PipelineTable pipelines={data.pipelines} />

            <section className="analysis-grid">
              <Alerts alerts={data.alerts} />
              <AIAnalyst
                analysis={{
                  ...data.aiAnalysis,
                  jobName: data.selectedBuild?.jobName,
                  buildNumber: data.selectedBuild?.buildNumber,
                }}
              />
            </section>

            <section className="lower-grid">
              <Controls controls={data.controls} />
              <StagePerformance data={data.pipelinePerformance} />
              <ActivityFeed activity={data.activity} />
            </section>

            <footer className="dashboard-footer">
              <span><Shield size={14} /> SentinelOps Security Intelligence</span>
              <span>{data.dataMode === 'postgres' ? 'Live PostgreSQL mode' : 'Mock data mode'} · DeepSeek AI analyzer connected via /api/ai/chat</span>
            </footer>
          </main>
        )}
      </div>
    </div>
  );
}
