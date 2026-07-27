import { useState } from 'react';
import SentinelOpsLogo from './SentinelOpsLogo.jsx';

export default function LoginPage({ onAuthenticated, resolvedTheme }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
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
      onAuthenticated(payload.user);
    } catch (err) {
      setError(err.message || 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`login-page ${resolvedTheme === 'light' ? 'login-light' : ''}`} data-theme={resolvedTheme}>
      <section className="login-brand-pane" aria-label="SentinelOps branding">
        <div className="login-brand-glow" />
        <div className="login-brand-content">
          <img
            className="login-hero-logo"
            src="/sentinelops-logo.png"
            alt="SentinelOps"
            width={132}
            height={132}
          />
          <h1>SentinelOps</h1>
          <p>Security command center for pipelines, findings, and AI-assisted investigations.</p>
          <ul className="login-brand-points">
            <li>Live PostgreSQL security intelligence</li>
            <li>Per-user triage and chat history</li>
            <li>DevSecOps-ready operator workspace</li>
          </ul>
        </div>
        <footer>DevSecOps Project · Local lab</footer>
      </section>

      <section className="login-form-pane">
        <div className="login-card">
          <div className="login-card-header">
            <SentinelOpsLogo size={42} />
            <div>
              <strong>Welcome back</strong>
              <span>Sign in to continue to SentinelOps</span>
            </div>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
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
              {busy ? 'Signing in…' : 'Log in'}
            </button>
          </form>

          <p className="login-hint">
            Default credentials: <code>admin</code> / <code>admin</code>
          </p>
        </div>
      </section>
    </div>
  );
}
