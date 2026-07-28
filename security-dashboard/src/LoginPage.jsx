import { useState } from 'react';
import SentinelOpsLogo from './SentinelOpsLogo.jsx';

export default function LoginPage({ onAuthenticated, resolvedTheme, forcePassword = false, user: lockedUser = null }) {
  const [step, setStep] = useState(forcePassword ? 'set-password' : 'login'); // login | set-password
  const [username, setUsername] = useState(lockedUser?.username || '');
  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(true);
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
        body: JSON.stringify({
          username,
          password,
          rememberMe: keepSignedIn,
        }),
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
          <SentinelOpsLogo size={148} className="login-hero-logo-svg" showWordmark />
          <p className="login-brand-tagline">
            Security command center for pipelines, findings, and AI-assisted investigations.
          </p>
        </div>
      </section>

      <section className="login-form-pane login-form-pane-white">
        <div className="login-form-plain">
          <header className="login-plain-header">
            <h1>{step === 'login' ? 'Sign in' : 'Set a new password'}</h1>
            <p>
              {step === 'login'
                ? 'Enter your SentinelOps credentials'
                : 'Default password must be replaced before continuing'}
            </p>
          </header>

          {step === 'login' ? (
            <form className="login-form login-form-jenkins" onSubmit={handleLogin}>
              <label>
                <span>Username</span>
                <input
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
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
                  required
                />
              </label>

              <label className="login-keep-signed-in">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(event) => setKeepSignedIn(event.target.checked)}
                />
                <span>Keep me signed in</span>
              </label>

              {error ? <div className="login-error" role="alert">{error}</div> : null}

              <button type="submit" className="login-submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form className="login-form login-form-jenkins" onSubmit={handleSetPassword}>
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
        </div>
      </section>
    </div>
  );
}
