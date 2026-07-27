import { useEffect, useState } from 'react';
import {
  ChevronDown,
  KeyRound,
  LogOut,
  Palette,
  Users,
} from 'lucide-react';

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function CollapseCard({
  id,
  title,
  summary,
  icon: Icon,
  open,
  onToggle,
  badge,
  children,
}) {
  return (
    <section className={classNames('settings-collapse', open && 'open')}>
      <button
        type="button"
        className="settings-collapse-trigger"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={onToggle}
      >
        <span className="settings-collapse-icon"><Icon size={16} /></span>
        <span className="settings-collapse-copy">
          <strong>{title}</strong>
          <em>{summary}</em>
        </span>
        {badge ? <span className="settings-collapse-badge">{badge}</span> : null}
        <ChevronDown size={16} className="settings-collapse-chevron" />
      </button>
      <div
        id={`${id}-body`}
        className="settings-collapse-body"
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}

export default function SettingsView({
  themePreference,
  resolvedTheme,
  onThemeChange,
  user,
  onAuthChange,
  onLogout,
  Monitor,
  Moon,
  Sun,
}) {
  const [credForm, setCredForm] = useState({
    currentUsername: user?.username || '',
    currentPassword: '',
    newUsername: '',
    confirmNewUsername: '',
    newPassword: '',
    confirmNewPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [activity, setActivity] = useState([]);
  const [openPanels, setOpenPanels] = useState({
    account: true,
    credentials: false,
    theme: false,
    activity: false,
  });

  const options = [
    { id: 'system', label: 'System', icon: Monitor },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'light', label: 'Light', icon: Sun },
  ];

  useEffect(() => {
    setCredForm((current) => ({
      ...current,
      currentUsername: user?.username || '',
    }));
  }, [user?.username]);

  useEffect(() => {
    if (!user) {
      setActivity([]);
      return undefined;
    }
    let cancelled = false;
    fetch('/api/auth/activity?limit=12', { credentials: 'include' })
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled) setActivity(payload.activity || []);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  function togglePanel(key) {
    setOpenPanels((current) => ({ ...current, [key]: !current[key] }));
  }

  function updateCred(key, value) {
    setCredForm((current) => ({ ...current, [key]: value }));
  }

  async function submitCredentialChange(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (credForm.newUsername !== credForm.confirmNewUsername) {
        throw new Error('New username fields do not match');
      }
      if (credForm.newPassword !== credForm.confirmNewPassword) {
        throw new Error('New password fields do not match');
      }
      const response = await fetch('/api/auth/change-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(credForm),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to change credentials');
      onAuthChange(payload.user);
      setMessage('Credentials updated. Use your new username and password next time you sign in.');
      setCredForm({
        currentUsername: payload.user.username,
        currentPassword: '',
        newUsername: '',
        confirmNewUsername: '',
        newPassword: '',
        confirmNewPassword: '',
      });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setMessage('');
    try {
      await onLogout();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTheme(nextTheme) {
    onThemeChange(nextTheme);
    if (!user) return;
    try {
      const response = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ themePreference: nextTheme }),
      });
      const payload = await response.json();
      if (response.ok && payload.user) onAuthChange(payload.user);
    } catch {
      /* keep local theme */
    }
  }

  const themeSummary = themePreference === 'system'
    ? `System · ${resolvedTheme}`
    : `${resolvedTheme} mode`;

  return (
    <main className="dashboard settings-dashboard">
      <div className="view-toolbar">
        <div>
          <h2>Settings</h2>
          <p>Account profile, credential rotation, and appearance</p>
        </div>
      </div>

      <div className="settings-stack">
        <CollapseCard
          id="account"
          title="Account"
          summary={`${user.displayName} · @${user.username}`}
          icon={Users}
          open={openPanels.account}
          onToggle={() => togglePanel('account')}
          badge="Signed in"
        >
          <div className="account-signed-in compact">
            <div className="account-identity">
              <strong>{user.displayName}</strong>
              <span>@{user.username} · {user.email}</span>
            </div>
            <button type="button" className="outline-button" disabled={busy} onClick={logout}>
              <LogOut size={15} /> Log out
            </button>
          </div>
        </CollapseCard>

        <CollapseCard
          id="credentials"
          title="Change credentials"
          summary="Confirm old credentials, then enter matching new username and password"
          icon={KeyRound}
          open={openPanels.credentials}
          onToggle={() => togglePanel('credentials')}
        >
          <form className="account-form credentials-form" onSubmit={submitCredentialChange}>
            <label>
              <span>Current username</span>
              <input
                value={credForm.currentUsername}
                onChange={(e) => updateCred('currentUsername', e.target.value)}
                required
              />
            </label>
            <label>
              <span>Current password</span>
              <input
                type="password"
                value={credForm.currentPassword}
                onChange={(e) => updateCred('currentPassword', e.target.value)}
                required
              />
            </label>
            <div className="credentials-divider">New credentials</div>
            <label>
              <span>New username</span>
              <input
                value={credForm.newUsername}
                onChange={(e) => updateCred('newUsername', e.target.value)}
                required
              />
            </label>
            <label>
              <span>Confirm new username</span>
              <input
                value={credForm.confirmNewUsername}
                onChange={(e) => updateCred('confirmNewUsername', e.target.value)}
                required
              />
            </label>
            <label>
              <span>New password</span>
              <input
                type="password"
                value={credForm.newPassword}
                onChange={(e) => updateCred('newPassword', e.target.value)}
                minLength={5}
                required
              />
            </label>
            <label>
              <span>Confirm new password</span>
              <input
                type="password"
                value={credForm.confirmNewPassword}
                onChange={(e) => updateCred('confirmNewPassword', e.target.value)}
                minLength={5}
                required
              />
            </label>
            <button type="submit" className="outline-button" disabled={busy}>
              {busy ? 'Updating…' : 'Update credentials'}
            </button>
          </form>
          {message ? <p className="account-message">{message}</p> : null}
        </CollapseCard>

        <CollapseCard
          id="theme"
          title="Appearance"
          summary={themeSummary}
          icon={Palette}
          open={openPanels.theme}
          onToggle={() => togglePanel('theme')}
        >
          <div className="settings-row compact">
            <div>
              <strong>Theme</strong>
              <span>Saved to your profile</span>
            </div>
            <div className="theme-segment" role="radiogroup" aria-label="Theme">
              {options.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={themePreference === id}
                  className={classNames('theme-segment-btn', themePreference === id && 'active')}
                  onClick={() => saveTheme(id)}
                  title={label}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </CollapseCard>

        <CollapseCard
          id="activity"
          title="Recent activity"
          summary={activity.length ? `${activity.length} recent actions` : 'No saved actions yet'}
          icon={Users}
          open={openPanels.activity}
          onToggle={() => togglePanel('activity')}
        >
          {!activity.length ? (
            <div className="panel-placeholder compact">Triage a finding or ask the copilot to populate this list.</div>
          ) : (
            <div className="user-activity-list">
              {activity.map((item) => (
                <article key={item.id}>
                  <strong>{item.action}</strong>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                </article>
              ))}
            </div>
          )}
        </CollapseCard>
      </div>
    </main>
  );
}
