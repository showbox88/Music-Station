/**
 * Login page. Renders fullscreen when there's no logged-in user.
 *
 * The first-time admin login uses showbox88 / changeme123 and triggers
 * the must_change_password flow, which is rendered separately by
 * ChangePasswordModal in App.tsx.
 */
import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../i18n/useT';

export default function Login() {
  const { login } = useAuth();
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await login(username.trim(), password);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setErr(msg.includes('401') ? t('auth.invalid_credentials') : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full w-full flex items-center justify-center p-4">
      {/* Login isn't a modal (no backdrop, sits in the page content area)
          so it uses the .modal-card class directly without ModalShell. */}
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl shadow-2xl modal-card p-6 space-y-4"
      >
        <div>
          <h1 className="text-xl font-semibold glow-text">Music Station</h1>
          <p className="text-xs text-zinc-500 mt-1">{t('auth.sign_in_continue')}</p>
        </div>

        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">{t('auth.username')}</span>
          <input
            type="text"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input w-full"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">{t('auth.password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full"
          />
        </label>

        {err && <div className="error-box">{err}</div>}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="btn-primary w-full py-2"
        >
          {busy ? t('auth.signing_in') : t('auth.sign_in')}
        </button>
      </form>
    </div>
  );
}
