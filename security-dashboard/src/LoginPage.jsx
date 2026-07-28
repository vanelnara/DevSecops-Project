import { useState } from 'react';
import SentinelOpsLogo from './SentinelOpsLogo.jsx';

export default function LoginPage({ onAuthenticated, resolvedTheme, forcePassword = false, user: lockedUser = null }) {
  const [step, setStep] = useState(forcePassword ? 'set-password' : 'login'); // login | set-password
  const [username, setUsername] = useState(lockedUser?.username || 'admin');
  const [password, setPassword] = useState('admin');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingUser, setPendingUser] = useState(lockedUser);

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Login failed');
      if (payload.user?.mustChangePassword) {
        setPendingUser(payload.user);
        setStep('set-password');
        setNewPassword('');
        setConfirmPassword('');
        return;
      }
      onAuthenticated(payload.user);
    } catch (err) {
      setError(err.message || 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          newPassword,
          confirmNewPassword: confirmPassword,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to save password');
      onAuthenticated(payload.user || { ...pendingUser, mustChangePassword: false });
    } catch (err) {
      setError(err.message || 'Unable to save password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`login-page ${resolvedTheme === 'light' ? 'login-light' : ''}`} data-theme={resolvedTheme}>
      <section className="login-brand-pane" aria-label="SentinelOps branding">
        <div className="login-brand-glow" />
        <div className="login-brand-content">
          <SentinelOpsLogo size={132} className="login-hero-logo-svg" showWordmark />
          <p>Security command center for pipelines, findings, and AI-assisted investigations.</p>
          <ul className="login-brand-points">
            <li>Live PostgreSQL security intelligence</li>
            <li>Per-user triage and chat history</li>
            <li>DevSecOps-ready operator workspace</li>
          </ul>
        </div>
        <footer>DevSecOps Project · Local lab</footer>
      </section>

      <section className="login-form-pane login-form-pane-white">
        <div className="login-card login-card-jenkins">
          <div className="login-card-header">
            <SentinelOpsLogo size={56} />
            <div>
              <strong>{step === 'login' ? 'Sign in' : 'Set a new password'}</strong>
              <span>
                {step === 'login'
                  ? 'Enter your SentinelOps credentials'
                  : 'Default password must be replaced before continuing'}
              </span>
            </div>
          </div>

          {step === 'login' ? (
            <form className="login-form" onSubmit={handleLogin}>
              <label>
                <span>Username</span>
                <input
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  required
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>

              {error ? <div className="login-error" role="alert">{error}</div> : null}

              <button type="submit" className="login-submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form className="login-form" onSubmit={handleSetPassword}>
              <p className="login-force-note">
                Signed in as <strong>{pendingUser?.username || username}</strong>. Choose a new password to protect this lab account.
              </p>
              <label>
                <span>New password</span>
                <input
                  autoFocus
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="At least 5 characters"
                  required
                  minLength={5}
                />
              </label>
              <label>
                <span>Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat new password"
                  required
                  minLength={5}
                />
              </label>

              {error ? <div className="login-error" role="alert">{error}</div> : null}

              <button type="submit" className="login-submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save password & continue'}
              </button>
            </form>
          )}

          {step === 'login' ? (
            <p className="login-hint">
              Default credentials: <code>admin</code> / <code>admin</code>
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
