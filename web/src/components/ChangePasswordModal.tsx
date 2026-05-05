/**
 * Forced-change-password modal.
 *
 * Renders unconditionally over the app whenever auth.user.must_change_password
 * is truthy. Has no close button — the user can't escape until they pick a
 * new password (or log out).
 *
 * Also reachable voluntarily from the user menu (Slice 4 territory).
 * `forced` toggles whether the X / cancel buttons are shown.
 */
import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useT } from '../i18n/useT';
import ModalShell from './Modal';

interface Props {
  forced: boolean;
  onClose?: () => void;
}

export default function ChangePasswordModal({ forced, onClose }: Props) {
  const { changePassword, logout } = useAuth();
  const t = useT();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (newPw.length < 6) {
      setErr(t('auth.new_password_too_short'));
      return;
    }
    if (newPw !== confirmPw) {
      setErr(t('auth.passwords_dont_match'));
      return;
    }
    setBusy(true);
    try {
      await changePassword(oldPw, newPw);
      setDone(true);
      if (!forced && onClose) {
        setTimeout(onClose, 800);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setErr(msg.includes('401') ? t('auth.old_password_wrong') : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      as="form"
      onSubmit={onSubmit}
      forced={forced}
      onClose={!forced && onClose ? onClose : undefined}
      maxWidth="max-w-sm"
      className="p-6 space-y-4"
    >
        <div>
          <h2 className="text-base font-semibold">
            {forced ? t('auth.change_password_first_time_title') : t('auth.change_password')}
          </h2>
          {forced && (
            <p className="text-xs text-zinc-500 mt-1">{t('auth.change_password_intro')}</p>
          )}
        </div>

        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">
            {t('auth.current_password')}
          </span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            className="input w-full"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">
            {t('auth.new_password')}
          </span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="input w-full"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">
            {t('auth.confirm_new_password')}
          </span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="input w-full"
          />
        </label>

        {err && <div className="error-box">{err}</div>}
        {done && (
          <div className="text-sm text-emerald-400 bg-emerald-950/30 p-2 rounded">
            {forced ? t('auth.password_changed_entering') : t('auth.password_changed')}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {!forced && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !oldPw || !newPw || !confirmPw}
            className="btn-primary flex-1"
          >
            {busy ? t('auth.submitting') : t('auth.change_password')}
          </button>
          {forced && (
            <button
              type="button"
              onClick={() => logout()}
              className="px-3 py-1.5 rounded-full bezel text-sm text-zinc-400 hover:text-red-400"
              title={t('auth.logout')}
            >
              {t('auth.logout')}
            </button>
          )}
        </div>
    </ModalShell>
  );
}
