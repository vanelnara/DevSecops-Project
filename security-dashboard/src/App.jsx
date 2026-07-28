import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Clock3,
  Database,
  GitBranch,
  LayoutDashboard,
  Menu,
  Network,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Sun,
  Moon,
  Monitor,
  LogOut,
  TrendingDown,
  User,
  UserRound,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import AIView from './AIView.jsx';
import LoginPage from './LoginPage.jsx';
import SettingsView from './SettingsView.jsx';
import SentinelOpsLogo from './SentinelOpsLogo.jsx';

const VIEWS = {
  overview: 'Security overview',
  pipelines: 'Pipelines',
  findings: 'Findings',
  ai: 'AI investigations',
  settings: 'Settings',
};

const THEME_STORAGE_KEY = 'sentinelops-theme';

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveTheme(preference) {
  return preference === 'system' ? getSystemTheme() : preference;
}

function applyTheme(preference) {
  const resolved = resolveTheme(preference);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

function readThemePreference() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    /* ignore */
  }
  return 'system';
}

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

function EmptyState({ icon: Icon = Database, title, detail, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={28} /></div>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-shield"><Shield size={30} /></div>
      <strong>Loading security intelligence</strong>
      <span>Reading pipeline results from PostgreSQL…</span>
    </div>
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

function Sidebar({ open, onClose, view, onNavigate, counts, user }) {
  const items = [
    { id: 'overview', label: 'Security overview', icon: LayoutDashboard },
    { id: 'pipelines', label: 'Pipelines', icon: Workflow, count: counts.builds },
    { id: 'findings', label: 'Findings', icon: ShieldAlert, count: counts.findings },
    { id: 'ai', label: 'AI investigations', icon: Bot },
  ];
  const initials = user?.displayName
    ? user.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : 'DL';

  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="Close navigation" />}
      <aside className={classNames('sidebar', open && 'sidebar-open')}>
        <div className="brand">
          <div className="brand-mark">
            <SentinelOpsLogo size={36} />
          </div>
          <div>
            <strong>SentinelOps</strong>
            <span>Security Intelligence</span>
          </div>
          <button className="icon-button sidebar-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">{initials}</div>
          <div>
            <strong>{user?.displayName || 'DevSecOps Lab'}</strong>
            <span>{user ? `@${user.username}` : 'Guest workspace'}</span>
          </div>
        </div>

        <nav className="nav-list">
          <span className="nav-heading">Monitor</span>
          {items.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              className={classNames('nav-item', view === id && 'active')}
              onClick={() => { onNavigate(id); onClose(); }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {count !== undefined && <em>{count}</em>}
            </button>
          ))}
          <span className="nav-heading nav-heading-spaced">System</span>
          <button className="nav-item" disabled title="Coming in next phase">
            <Network size={18} /><span>Integrations</span>
          </button>
          <button
            className={classNames('nav-item', view === 'settings' && 'active')}
            onClick={() => { onNavigate('settings'); onClose(); }}
          >
            <Settings size={18} /><span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-status">
          <div className="status-ring"><Activity size={17} /></div>
          <div>
            <strong>{counts.mode === 'postgres' ? 'Live PostgreSQL' : 'Awaiting pipeline data'}</strong>
            <span>{counts.mode === 'postgres' ? `${counts.builds} builds ingested` : 'Run Jenkins publish stages'}</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Header({
  onMenu,
  title,
  generatedAt,
  onRefresh,
  refreshing,
  search,
  onSearch,
  user,
  onOpenSettings,
  onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = user?.displayName
    ? user.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : null;

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDocClick(event) {
      if (!event.target.closest('.user-menu')) setMenuOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button menu-button" onClick={onMenu}><Menu size={20} /></button>
        <div className="page-title">
          <div className="eyebrow">SECURITY COMMAND CENTER</div>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="topbar-actions">
        <label className="search-box">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search findings, builds, assets…"
          />
        </label>
        <button className="icon-button" onClick={onRefresh} title={`Updated ${generatedAt}`}>
          <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
        </button>

        <div className="user-menu">
          <button
            type="button"
            className={classNames('user-menu-trigger', user && 'signed-in', menuOpen && 'open')}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={user ? user.displayName : 'Account'}
          >
            {initials ? <span className="user-menu-avatar">{initials}</span> : <UserRound size={18} />}
          </button>
          {menuOpen ? (
            <div className="user-menu-popover" role="menu">
              {user ? (
                <>
                  <div className="user-menu-identity">
                    <strong>{user.displayName}</strong>
                    <span>@{user.username}</span>
                    <em>{user.email}</em>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenSettings();
                    }}
                  >
                    <User size={15} /> Account settings
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={async () => {
                      setMenuOpen(false);
                      await onLogout();
                    }}
                  >
                    <LogOut size={15} /> Log out
                  </button>
                </>
              ) : (
                <>
                  <div className="user-menu-identity guest">
                    <strong>Guest</strong>
                    <span>Sign in to save your workspace</span>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenSettings();
                    }}
                  >
                    <User size={15} /> Sign in / Create account
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone, onClick }) {
  const Tag = onClick ? 'button' : 'article';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={classNames('metric-card', onClick && 'metric-card-clickable')}
      onClick={onClick}
    >
      <div className={classNames('metric-icon', tone)}><Icon size={19} /></div>
      <div className="metric-copy">
        <span>{label}</span>
        <div className="metric-value">{value}</div>
        <small>{detail}</small>
      </div>
      {onClick ? <ChevronRight className="metric-card-chevron" size={16} /> : null}
    </Tag>
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

function DetailDrawer({ title, onClose, children }) {
  return (
    <div className="drawer-root">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close details" />
      <aside className="drawer-panel">
        <div className="drawer-header">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function OverviewView({
  data,
  onOpenBuild,
  onOpenFinding,
  onGoFindings,
  onGoPipelines,
  onGoPipelinesSuccess,
}) {
  const hasLive = data.dataMode === 'postgres' && data.selectedBuild;
  const total = data.severity.reduce((sum, item) => sum + item.value, 0);
  const delta = data.summary.riskDelta || 0;
  const chartSeverity = total > 0
    ? data.severity
    : data.severity.map((item) => ({ ...item, value: item.value || 0.0001 }));
  const trendMax = Math.max(
    4,
    ...((data.trend || []).flatMap((row) => [row.critical, row.high, row.medium, row.total || 0])),
  );

  function openSelectedOrPipelines() {
    if (data.selectedBuild) {
      onOpenBuild(data.selectedBuild.jobName, data.selectedBuild.buildNumber);
      return;
    }
    onGoPipelines();
  }

  function openControl(control) {
    if (data.selectedBuild) {
      onOpenBuild(data.selectedBuild.jobName, data.selectedBuild.buildNumber, {
        stage: control.stage,
        source: control.sourceKey || control.tool,
      });
      return;
    }
    onGoPipelines();
  }

  function openStage(stageName) {
    if (data.selectedBuild) {
      onOpenBuild(data.selectedBuild.jobName, data.selectedBuild.buildNumber, { stage: stageName });
      return;
    }
    onGoPipelines();
  }

  return (
    <main className="dashboard">
      {!hasLive && (
        <div className="waiting-banner">
          <Database size={16} />
          <span>{data.waitingReason || 'Dashboard shell ready — metrics fill automatically when Jenkins publishes a build.'}</span>
        </div>
      )}

      <section className="context-strip">
        <div className="live-indicator"><i /> {hasLive ? 'LIVE FROM POSTGRES' : 'AWAITING PIPELINE DATA'}</div>
        {hasLive ? (
          <button className="context-pipeline" onClick={() => onOpenBuild(data.selectedBuild.jobName, data.selectedBuild.buildNumber)}>
            <span>Selected build</span>
            <strong>{data.selectedBuild.jobName} <em>#{data.selectedBuild.buildNumber}</em></strong>
            <StatusPill status={data.selectedBuild.status} />
          </button>
        ) : (
          <div className="context-pipeline">
            <span>Selected build</span>
            <strong>No build ingested yet</strong>
            <StatusPill status="waiting" />
          </div>
        )}
        <div className="context-meta">
          <div><GitBranch size={14} /> {hasLive ? `${data.selectedBuild.branch} · ${data.selectedBuild.commit}` : 'branch · commit'}</div>
          <div><Clock3 size={14} /> {hasLive ? `${data.selectedBuild.duration} · ${data.selectedBuild.finishedAt}` : 'duration · waiting'}</div>
        </div>
      </section>

      <section className="metrics-grid metrics-grid-live">
        <MetricCard
          label="Security risk score"
          value={`${data.summary.riskScore}/100`}
          detail={
            hasLive ? (
              <span className={delta <= 0 ? 'good-detail' : 'bad-detail'}>
                {delta <= 0 ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
                {Math.abs(delta)} vs previous build
              </span>
            ) : 'Fills after ingest'
          }
          icon={CircleGauge}
          tone="orange"
        />
        <MetricCard
          label="Critical findings"
          value={data.summary.critical}
          detail={`${data.summary.high} high · ${data.summary.totalFindings} total open`}
          icon={ShieldAlert}
          tone="red"
          onClick={onGoFindings}
        />
        <MetricCard
          label="Unstable / failed builds"
          value={data.summary.blockedBuilds}
          detail={`Across ${data.summary.totalBuilds} ingested builds`}
          icon={SquareTerminal}
          tone="purple"
          onClick={onGoPipelines}
        />
        <MetricCard
          label="Control coverage"
          value={`${data.summary.coverage}%`}
          detail="Derived from scanner findings on this build"
          icon={ShieldCheck}
          tone="blue"
          onClick={openSelectedOrPipelines}
        />
        <MetricCard
          label="Successful builds"
          value={data.summary.successfulBuilds ?? 0}
          detail="Click to open successful pipelines"
          icon={Check}
          tone="green"
          onClick={onGoPipelinesSuccess}
        />
      </section>

      <section className="overview-grid">
        <Panel title="Risk posture" subtitle="Findings on selected build" action={<button className="text-button" onClick={onGoFindings}>View findings <ChevronRight size={15} /></button>}>
          <div className="risk-layout">
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={chartSeverity} dataKey="value" nameKey="name" innerRadius={68} outerRadius={91} startAngle={90} endAngle={-270} strokeWidth={0}>
                    {chartSeverity.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center"><strong>{total}</strong><span>findings</span></div>
            </div>
            <div className="severity-list">
              {data.severity.map((item) => (
                <button className="severity-row severity-row-btn" key={item.name} onClick={onGoFindings}>
                  <div><i style={{ background: item.color }} /><span>{item.name}</span></div>
                  <strong>{item.value}</strong>
                  <em>{total ? Math.round((item.value / total) * 100) : 0}%</em>
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="trend-panel" title="Finding trend" subtitle="Critical / high / medium over recent builds" action={<span className="positive-delta"><TrendingDown size={14} /> {hasLive ? 'live' : 'ready'}</span>}>
          <div className="chart-legend">
            <span><i className="legend-critical" /> Critical</span>
            <span><i className="legend-high" /> High</span>
            <span><i className="legend-medium" /> Medium</span>
          </div>
          <ResponsiveContainer width="100%" height={225}>
            <LineChart data={data.trend} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 12 }}
                allowDecimals={false}
                domain={[0, trendMax]}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="medium" name="Medium" stroke="#eab308" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="high" name="High" stroke="#f97316" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              <Line type="monotone" dataKey="critical" name="Critical" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      <Panel title="Recent pipeline runs" subtitle="Click a row to inspect stages and findings" action={<button className="outline-button" onClick={onGoPipelines}>Open pipelines</button>}>
        {!data.pipelines.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pipeline</th><th>Status</th><th>Risk</th><th>Findings</th><th>Duration</th><th>Completed</th><th />
                </tr>
              </thead>
              <tbody>
                <tr className="placeholder-row">
                  <td colSpan={7}>No builds yet — Jenkins Store Security Findings will populate this table.</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pipeline</th><th>Status</th><th>Risk</th><th>Findings</th><th>Duration</th><th>Completed</th><th />
                </tr>
              </thead>
              <tbody>
                {data.pipelines.slice(0, 8).map((pipeline) => (
                  <tr key={`${pipeline.jobName}-${pipeline.id}`} className="click-row" onClick={() => onOpenBuild(pipeline.jobName, pipeline.id)}>
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
                    <td><ChevronRight size={17} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <section className="analysis-grid">
        <Panel title="Priority alerts" subtitle="Open findings on selected build" action={<button className="text-button" onClick={onGoFindings}>All findings <ChevronRight size={15} /></button>}>
          {!data.alerts.length ? (
            <div className="panel-placeholder">No open alerts yet. Scanner findings appear here after ingest.</div>
          ) : (
            <div className="alert-list">
              {data.alerts.slice(0, 6).map((alert) => (
                <button className="alert-item alert-item-btn" key={alert.id || alert.findingKey} onClick={() => onOpenFinding(alert)}>
                  <div className={classNames('alert-severity', `severity-${alert.severity}`)}><AlertTriangle size={17} /></div>
                  <div className="alert-main">
                    <div className="alert-title">
                      <strong>{alert.title}</strong>
                      <span className={classNames('severity-label', `severity-${alert.severity}`)}>{alert.severity}</span>
                    </div>
                    <p>{alert.asset}</p>
                    <div className="alert-meta">
                      <span>{alert.findingKey || alert.id}</span><i /><span>{alert.source}</span><i /><span>{alert.pipeline}</span>
                    </div>
                  </div>
                  <div className="alert-side">
                    <span>{alert.age}</span>
                    <StatusPill status={alert.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="AI security analyst" subtitle={data.selectedBuild ? `Verdict for ${data.selectedBuild.jobName} #${data.selectedBuild.buildNumber}` : 'Verdict stored for this build'} action={<span className="ai-live"><Sparkles size={13} /> {data.aiAnalysis?.model || 'pending'}</span>}>
          {!data.aiAnalysis ? (
            <div className="ai-verdict">
              <div className="ai-orb"><Bot size={24} /></div>
              <div>
                <span>Waiting for AI Security Analysis stage</span>
                <strong>No verdict stored yet</strong>
              </div>
            </div>
          ) : (
            <>
              <div className="ai-verdict">
                <div className="ai-orb"><Bot size={24} /></div>
                <div>
                  <span>
                    Build #{data.selectedBuild?.buildNumber} · {data.aiAnalysis.confidence}% confidence
                  </span>
                  <strong>{data.aiAnalysis.verdict}</strong>
                </div>
              </div>
              <p className="ai-narrative">{data.aiAnalysis.narrative}</p>
            </>
          )}
        </Panel>
      </section>

      <section className="lower-grid">
        <Panel title="Control coverage" subtitle="Click a control to open its pipeline stage">
          <div className="control-list">
            {data.controls.map((control) => (
              <button
                type="button"
                className="control-row control-row-btn"
                key={control.name}
                onClick={() => openControl(control)}
              >
                <div className={classNames('control-state', control.status)}>
                  {control.status === 'passing' ? <Check size={15} /> : <AlertTriangle size={15} />}
                </div>
                <div className="control-copy">
                  <div>
                    <strong>{control.name}</strong>
                    <span>{control.tool} · {control.stage || 'stage'}</span>
                  </div>
                  <div className="coverage-track"><i style={{ width: `${control.coverage}%` }} /></div>
                </div>
                <strong>{control.coverage}%</strong>
                <ChevronRight size={16} className="control-row-chevron" />
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Stage performance" subtitle="Click a stage to open that pipeline step">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.pipelinePerformance} layout="vertical" margin={{ left: 10, right: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="stage" axisLine={false} tickLine={false} width={100} tick={{ fill: 'var(--muted)', fontSize: 13 }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="duration" name="Duration (s)" fill="#38bdf8" radius={[0, 4, 4, 0]} barSize={10} />
            </BarChart>
          </ResponsiveContainer>
          <div className="stage-link-list">
            {(data.pipelinePerformance || []).map((stage) => (
              <button
                type="button"
                key={stage.stage}
                className="stage-link-btn"
                onClick={() => openStage(stage.stage)}
              >
                <strong>{stage.stage}</strong>
                <span>{stage.duration || 0}s · {stage.status || '—'}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Live activity" subtitle="Events written by ingest and AI">
          {!data.activity.length ? (
            <div className="panel-placeholder">Activity feed fills when builds are ingested or findings are updated.</div>
          ) : (
            <div className="activity-feed">
              {data.activity.map((event, index) => (
                <div className="activity-row" key={`${event.actor}-${event.time}-${index}`}>
                  <div className="activity-line">
                    <i>{index === 0 ? <Zap size={13} /> : <Check size={13} />}</i>
                    {index < data.activity.length - 1 && <span />}
                  </div>
                  <div><strong>{event.actor}</strong><p>{event.action}</p></div>
                  <time>{event.time}</time>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>
    </main>
  );
}

function PipelinesView({ builds, statusFilter, onStatusFilter, search, onOpenBuild, loading }) {
  const filtered = builds.filter((build) => {
    const status = String(build.status || '').toLowerCase();
    const matchesStatus = statusFilter === 'all'
      || status === statusFilter
      || (statusFilter === 'success' && ['success', 'successful', 'passed'].includes(status));
    const q = search.trim().toLowerCase();
    const matchesSearch = !q
      || build.name.toLowerCase().includes(q)
      || String(build.id).includes(q)
      || (build.commit || '').toLowerCase().includes(q)
      || (build.branch || '').toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <main className="dashboard">
      <div className="view-toolbar">
        <div>
          <h2>Pipeline builds</h2>
          <p>Every ingested Jenkins build with risk and duration</p>
        </div>
        <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="unstable">Unstable</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {loading ? <LoadingState /> : !filtered.length ? (
        <EmptyState icon={Workflow} title="No builds match" detail="Adjust filters or wait for the next Jenkins publish." />
      ) : (
        <Panel title={`${filtered.length} builds`} subtitle="Click any row for stages, findings, and AI verdict">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Build</th><th>Status</th><th>Risk</th><th>Findings</th><th>Duration</th><th>Trigger</th><th>When</th><th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((pipeline) => (
                  <tr key={`${pipeline.jobName}-${pipeline.id}`} className="click-row" onClick={() => onOpenBuild(pipeline.jobName, pipeline.id)}>
                    <td>
                      <div className="pipeline-name">
                        <span className="pipeline-glyph"><GitBranch size={16} /></span>
                        <div>
                          <strong>{pipeline.name} #{pipeline.id}</strong>
                          <span>{pipeline.branch} · {pipeline.commit}</span>
                        </div>
                      </div>
                    </td>
                    <td><StatusPill status={pipeline.status} /></td>
                    <td>{pipeline.risk}</td>
                    <td>{pipeline.findings}</td>
                    <td>{pipeline.duration}</td>
                    <td>{pipeline.triggeredBy}</td>
                    <td>{pipeline.finishedAt}</td>
                    <td><ChevronRight size={17} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </main>
  );
}

function FindingsView({
  findings,
  severityFilter,
  statusFilter,
  sourceFilter,
  onSeverityFilter,
  onStatusFilter,
  onSourceFilter,
  onOpenFinding,
  onUpdateStatus,
  loading,
}) {
  const sources = useMemo(
    () => ['all', ...Array.from(new Set(findings.map((item) => item.source))).sort()],
    [findings],
  );

  return (
    <main className="dashboard">
      <div className="view-toolbar">
        <div>
          <h2>Findings</h2>
          <p>Filter and update status — changes are saved to PostgreSQL</p>
        </div>
        <div className="filter-row">
          <select value={severityFilter} onChange={(event) => onSeverityFilter(event.target.value)}>
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="triage">Triage</option>
            <option value="in-progress">In progress</option>
            <option value="accepted">Accepted</option>
            <option value="resolved">Resolved</option>
            <option value="false-positive">False positive</option>
          </select>
          <select value={sourceFilter} onChange={(event) => onSourceFilter(event.target.value)}>
            {sources.map((source) => (
              <option key={source} value={source}>{source === 'all' ? 'All sources' : source}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? <LoadingState /> : !findings.length ? (
        <EmptyState icon={ShieldAlert} title="No findings" detail="No scanner findings match these filters, or no builds have been ingested yet." />
      ) : (
        <Panel title={`${findings.length} findings`} subtitle="Click a finding for raw evidence and status controls">
          <div className="alert-list">
            {findings.map((finding) => (
              <article className="alert-item" key={finding.id}>
                <button className="alert-item-main" onClick={() => onOpenFinding(finding)}>
                  <div className={classNames('alert-severity', `severity-${finding.severity}`)}><AlertTriangle size={17} /></div>
                  <div className="alert-main">
                    <div className="alert-title">
                      <strong>{finding.title}</strong>
                      <span className={classNames('severity-label', `severity-${finding.severity}`)}>{finding.severity}</span>
                    </div>
                    <p>{finding.asset}</p>
                    <div className="alert-meta">
                      <span>{finding.findingKey}</span><i /><span>{finding.source}</span><i /><span>{finding.pipeline}</span>
                    </div>
                  </div>
                </button>
                <div className="alert-side">
                  <select
                    value={finding.status}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => onUpdateStatus(finding.id, event.target.value)}
                  >
                    <option value="open">open</option>
                    <option value="triage">triage</option>
                    <option value="in-progress">in-progress</option>
                    <option value="accepted">accepted</option>
                    <option value="resolved">resolved</option>
                    <option value="false-positive">false-positive</option>
                  </select>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}
    </main>
  );
}

export default function App() {
  const [view, setView] = useState('overview');
  const [themePreference, setThemePreference] = useState(() => readThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(readThemePreference()));
  const [data, setData] = useState(null);
  const [builds, setBuilds] = useState([]);
  const [findings, setFindings] = useState([]);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);
  const [search, setSearch] = useState('');
  const [buildStatusFilter, setBuildStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [findingStatusFilter, setFindingStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedBuildDetail, setSelectedBuildDetail] = useState(null);
  const [buildFocus, setBuildFocus] = useState(null);
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const selectedBuild = data?.selectedBuild;

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => res.json())
      .then((payload) => {
        if (payload.user) {
          setUser(payload.user);
          if (payload.user.themePreference) setThemePreference(payload.user.themePreference);
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* clear local session anyway */
    }
    setUser(null);
    setView('overview');
  }

  function handleAuthenticated(nextUser) {
    setUser(nextUser);
    if (nextUser?.themePreference) setThemePreference(nextUser.themePreference);
  }

  async function loadDashboard(jobName, buildNumber) {
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (jobName) params.set('job', jobName);
      if (buildNumber) params.set('build', String(buildNumber));
      const response = await fetch(`/api/dashboard?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Dashboard API returned ${response.status}`);
      }
      setData(payload);
      setError('');
    } catch (loadError) {
      // Keep the dashboard shell usable even if the API is briefly unreachable.
      setData((current) => current || {
        generatedAt: new Date().toISOString(),
        organization: 'DevSecOps Lab',
        dataMode: 'empty',
        waitingReason: loadError.message,
        summary: {
          riskScore: 0, riskDelta: 0, totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0,
          blockedBuilds: 0, successfulBuilds: 0, meanTimeToResolve: '—', coverage: 0, totalBuilds: 0,
        },
        severity: [
          { name: 'Critical', value: 0, color: '#ef4444' },
          { name: 'High', value: 0, color: '#f97316' },
          { name: 'Medium', value: 0, color: '#eab308' },
          { name: 'Low', value: 0, color: '#38bdf8' },
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
          { stage: 'Checkout', duration: 0 }, { stage: 'Unit Tests', duration: 0 },
          { stage: 'SAST', duration: 0 }, { stage: 'OWASP', duration: 0 },
          { stage: 'Gitleaks', duration: 0 }, { stage: 'Build', duration: 0 },
          { stage: 'Trivy', duration: 0 }, { stage: 'Cosign', duration: 0 },
          { stage: 'Deploy', duration: 0 },
        ],
        pipelines: [],
        alerts: [],
        controls: [
          { name: 'SAST', tool: 'SonarQube', status: 'passing', coverage: 0 },
          { name: 'SCA', tool: 'OWASP Dependency-Check', status: 'passing', coverage: 0 },
          { name: 'Secrets', tool: 'Gitleaks', status: 'passing', coverage: 0 },
          { name: 'Container', tool: 'Trivy', status: 'passing', coverage: 0 },
          { name: 'Signing', tool: 'Cosign', status: 'passing', coverage: 0 },
          { name: 'Deployment', tool: 'Argo CD', status: 'passing', coverage: 0 },
        ],
        aiAnalysis: null,
        activity: [],
        selectedBuild: null,
      });
      setError('');
    } finally {
      setRefreshing(false);
    }
  }

  async function loadLists() {
    setLoadingLists(true);
    try {
      const findingsParams = new URLSearchParams();
      if (severityFilter !== 'all') findingsParams.set('severity', severityFilter);
      if (findingStatusFilter !== 'all') findingsParams.set('status', findingStatusFilter);
      if (sourceFilter !== 'all') findingsParams.set('source', sourceFilter);
      if (search.trim()) findingsParams.set('q', search.trim());
      if (selectedBuild?.jobName) findingsParams.set('job', selectedBuild.jobName);

      const [buildsRes, findingsRes] = await Promise.all([
        fetch('/api/builds?limit=100', { credentials: 'include' }),
        fetch(`/api/findings?${findingsParams.toString()}&limit=200`, { credentials: 'include' }),
      ]);
      const buildsJson = await buildsRes.json();
      const findingsJson = await findingsRes.json();
      setBuilds(buildsJson.builds || []);
      setFindings(findingsJson.findings || []);
    } catch (listError) {
      console.error(listError);
    } finally {
      setLoadingLists(false);
    }
  }

  useEffect(() => {
    const resolved = applyTheme(themePreference);
    setResolvedTheme(resolved);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      /* ignore */
    }

    if (themePreference !== 'system' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setResolvedTheme(applyTheme('system'));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [themePreference]);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (view === 'pipelines' || view === 'findings' || view === 'overview' || view === 'ai') {
      loadLists();
    }
  }, [view, severityFilter, findingStatusFilter, sourceFilter, search, selectedBuild?.jobName, selectedBuild?.buildNumber]);

  // Soft-poll so overview/AI fill automatically when Jenkins publishes a build.
  useEffect(() => {
    if (view !== 'overview' && view !== 'ai') return undefined;
    const timer = setInterval(() => {
      loadDashboard(selectedBuild?.jobName, selectedBuild?.buildNumber);
      if (view === 'ai') loadLists();
    }, 15000);
    return () => clearInterval(timer);
  }, [view, selectedBuild?.jobName, selectedBuild?.buildNumber]);

  async function selectBuild(jobName, buildNumber) {
    await loadDashboard(jobName, buildNumber);
  }

  async function openBuild(jobName, buildNumber, focus = null) {
    const response = await fetch(`/api/builds/${encodeURIComponent(jobName)}/${buildNumber}`);
    const detail = await response.json();
    if (!response.ok) {
      setError(detail.error || 'Failed to load build');
      return;
    }
    setBuildFocus(focus);
    setSelectedBuildDetail(detail);
    await loadDashboard(jobName, buildNumber);
  }

  async function updateFindingStatus(id, status) {
    const response = await fetch(`/api/findings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status }),
    });
    const updated = await response.json();
    if (!response.ok) {
      setError(updated.error || 'Failed to update finding');
      return;
    }
    setFindings((current) => current.map((item) => (item.id === id ? updated : item)));
    if (selectedFinding?.id === id) setSelectedFinding(updated);
    await loadDashboard(selectedBuild?.jobName, selectedBuild?.buildNumber);
  }

  async function rerunAnalysis() {
    if (!selectedBuild) {
      throw new Error('No pipeline build available to analyze');
    }
    setAnalyzing(true);
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobName: selectedBuild.jobName,
          buildNumber: selectedBuild.buildNumber,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.guidance || result.error || 'Analyze failed');
      }
      await loadDashboard(selectedBuild.jobName, selectedBuild.buildNumber);
    } finally {
      setAnalyzing(false);
    }
  }

  const updatedLabel = useMemo(() => {
    if (!data?.generatedAt) return 'Never';
    return new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [data?.generatedAt]);

  if (!authChecked) {
    return <LoadingState />;
  }

  if (!user) {
    return (
      <LoginPage
        onAuthenticated={handleAuthenticated}
        resolvedTheme={resolvedTheme}
      />
    );
  }

  if (user.mustChangePassword) {
    return (
      <LoginPage
        onAuthenticated={handleAuthenticated}
        resolvedTheme={resolvedTheme}
        forcePassword
        user={user}
      />
    );
  }

  if (!data) return <LoadingState />;

  return (
    <div className="app-shell">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        view={view}
        onNavigate={setView}
        user={user}
        counts={{
          builds: data.summary.totalBuilds || builds.length,
          findings: data.summary.totalFindings || findings.length,
          mode: data.dataMode,
        }}
      />
      <div className="main-shell">
        <Header
          onMenu={() => setSidebarOpen(true)}
          title={VIEWS[view]}
          generatedAt={updatedLabel}
          onRefresh={() => {
            loadDashboard(selectedBuild?.jobName, selectedBuild?.buildNumber);
            loadLists();
          }}
          refreshing={refreshing}
          search={search}
          onSearch={setSearch}
          user={user}
          onOpenSettings={() => setView('settings')}
          onLogout={handleLogout}
        />

        {error ? (
          <div className="error-banner">
            <AlertTriangle size={19} />
            <div><strong>Action needed</strong><span>{error}</span></div>
            <button onClick={() => { setError(''); loadDashboard(); }}>Retry</button>
          </div>
        ) : null}

        {view === 'overview' && (
          <OverviewView
            data={data}
            onOpenBuild={openBuild}
            onOpenFinding={setSelectedFinding}
            onGoFindings={() => setView('findings')}
            onGoPipelines={() => {
              setBuildStatusFilter('all');
              setView('pipelines');
            }}
            onGoPipelinesSuccess={() => {
              setBuildStatusFilter('success');
              setView('pipelines');
            }}
          />
        )}
        {view === 'pipelines' && (
          <PipelinesView
            builds={builds}
            statusFilter={buildStatusFilter}
            onStatusFilter={setBuildStatusFilter}
            search={search}
            onOpenBuild={openBuild}
            loading={loadingLists}
          />
        )}
        {view === 'findings' && (
          <FindingsView
            findings={findings}
            severityFilter={severityFilter}
            statusFilter={findingStatusFilter}
            sourceFilter={sourceFilter}
            onSeverityFilter={setSeverityFilter}
            onStatusFilter={setFindingStatusFilter}
            onSourceFilter={setSourceFilter}
            onOpenFinding={setSelectedFinding}
            onUpdateStatus={updateFindingStatus}
            loading={loadingLists}
          />
        )}
        {view === 'ai' && (
          <AIView
            data={data}
            builds={builds.length ? builds : data.pipelines}
            onSelectBuild={selectBuild}
            onAnalyze={rerunAnalysis}
            analyzing={analyzing}
            user={user}
            onRefresh={() => {
              loadDashboard(selectedBuild?.jobName, selectedBuild?.buildNumber);
              loadLists();
            }}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            themePreference={themePreference}
            resolvedTheme={resolvedTheme}
            onThemeChange={setThemePreference}
            user={user}
            onAuthChange={setUser}
            onLogout={handleLogout}
            Monitor={Monitor}
            Moon={Moon}
            Sun={Sun}
          />
        )}

        <footer className="dashboard-footer">
          <span><Shield size={14} /> SentinelOps Security Intelligence</span>
          <span>
            {data.dataMode === 'postgres'
              ? `Live PostgreSQL · build #${selectedBuild?.buildNumber || '—'}`
              : 'Waiting for real pipeline ingest — no mock data'}
          </span>
        </footer>
      </div>

      {selectedBuildDetail && (
        <DetailDrawer
          title={`${selectedBuildDetail.build.name} #${selectedBuildDetail.build.id}`}
          onClose={() => {
            setSelectedBuildDetail(null);
            setBuildFocus(null);
          }}
        >
          <div className="drawer-meta">
            <StatusPill status={selectedBuildDetail.build.status} />
            <span>Risk {selectedBuildDetail.build.risk}</span>
            <span>{selectedBuildDetail.build.duration}</span>
            <span>{selectedBuildDetail.build.finishedAt}</span>
          </div>
          {buildFocus?.stage || buildFocus?.source ? (
            <p className="drawer-focus-note">
              Focused on {buildFocus.stage ? `stage ${buildFocus.stage}` : null}
              {buildFocus.stage && buildFocus.source ? ' · ' : null}
              {buildFocus.source ? `source ${buildFocus.source}` : null}
            </p>
          ) : null}
          <h4>Stages</h4>
          <div className="drawer-list">
            {selectedBuildDetail.stages.map((stage) => {
              const focused = buildFocus?.stage
                && String(stage.name).toLowerCase().includes(String(buildFocus.stage).toLowerCase());
              return (
                <div
                  key={stage.name}
                  className={classNames('drawer-row', focused && 'drawer-row-focused')}
                >
                  <strong>{stage.name}</strong>
                  <StatusPill status={stage.status} />
                  <span>{stage.duration}</span>
                </div>
              );
            })}
            {!selectedBuildDetail.stages.length && <p className="muted">No stage rows for this build.</p>}
          </div>
          <h4>Findings ({selectedBuildDetail.findings.length})</h4>
          <div className="drawer-list">
            {selectedBuildDetail.findings.slice(0, 20).map((finding) => {
              const focused = buildFocus?.source
                && String(finding.source || '').toLowerCase().includes(String(buildFocus.source).toLowerCase());
              return (
                <button
                  key={finding.id}
                  className={classNames('drawer-row drawer-row-btn', focused && 'drawer-row-focused')}
                  onClick={() => setSelectedFinding(finding)}
                >
                  <strong>{finding.findingKey}</strong>
                  <span className={classNames('severity-label', `severity-${finding.severity}`)}>{finding.severity}</span>
                  <span>{finding.source}</span>
                </button>
              );
            })}
          </div>
          {selectedBuildDetail.aiAnalysis && (
            <>
              <h4>AI verdict</h4>
              <p>{selectedBuildDetail.aiAnalysis.verdict}</p>
            </>
          )}
        </DetailDrawer>
      )}

      {selectedFinding && (
        <DetailDrawer title={selectedFinding.findingKey} onClose={() => setSelectedFinding(null)}>
          <div className="drawer-meta">
            <span className={classNames('severity-label', `severity-${selectedFinding.severity}`)}>{selectedFinding.severity}</span>
            <StatusPill status={selectedFinding.status} />
            <span>{selectedFinding.source}</span>
          </div>
          <h4>{selectedFinding.title}</h4>
          <p className="muted">{selectedFinding.asset}</p>
          <p className="muted">{selectedFinding.pipeline} · {selectedFinding.age}</p>
          <label className="drawer-field">
            <span>Status</span>
            <select
              value={selectedFinding.status}
              onChange={(event) => updateFindingStatus(selectedFinding.id, event.target.value)}
            >
              <option value="open">open</option>
              <option value="triage">triage</option>
              <option value="in-progress">in-progress</option>
              <option value="accepted">accepted</option>
              <option value="resolved">resolved</option>
              <option value="false-positive">false-positive</option>
            </select>
          </label>
          <h4>Raw evidence</h4>
          <pre className="raw-json">{JSON.stringify(selectedFinding.raw || {}, null, 2)}</pre>
        </DetailDrawer>
      )}
    </div>
  );
}
