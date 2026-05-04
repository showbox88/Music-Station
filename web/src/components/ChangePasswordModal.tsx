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

interface Props {
  forced: boolean;
  onClose?: () => void;
}

export default function ChangePasswordModal({ forced, onClose }: Props) {
  const { changePassword, logout } = useAuth();
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
      setErr('新密码至少 6 位');
      return;
    }
    if (newPw !== confirmPw) {
      setErr('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    try {
      await changePassword(oldPw, newPw);
      setDone(true);
      // For voluntary changes, close after success. Forced changes have
      // no close — the modal unmounts automatically when must_change=0.
      if (!forced && onClose) {
        setTimeout(onClose, 800);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setErr(msg.includes('401') ? '当前密码错误' : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl shadow-2xl p-6 space-y-4"
        style={{
          background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
          border: '1px solid #050506',
          boxShadow:
            '0 20px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 30px rgba(255,45,181,0.08)',
        }}
      >
        <div>
          <h2 className="text-base font-semibold">
            {forced ? '首次登录请修改密码' : '修改密码'}
          </h2>
          {forced && (
            <p className="text-xs text-zinc-500 mt-1">
              为了账户安全，请把默认密码改成只有你知道的。
            </p>
          )}
        </div>

        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">当前密码</span>
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
          <span className="text-xs uppercase text-zinc-500 mb-1 block">新密码（≥ 6 位）</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="input w-full"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">再次输入新密码</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="input w-full"
          />
        </label>

        {err && <div className="text-sm text-red-400 bg-red-950/30 p-2 rounded">{err}</div>}
        {done && (
          <div className="text-sm text-emerald-400 bg-emerald-950/30 p-2 rounded">
            密码已修改{forced ? '，正在进入应用…' : ''}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {!forced && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
            >
              取消
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !oldPw || !newPw || !confirmPw}
            className="flex-1 px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-50"
          >
            {busy ? '提交中…' : '修改密码'}
          </button>
          {forced && (
            <button
              type="button"
              onClick={() => logout()}
              className="px-3 py-1.5 rounded-full bezel text-sm text-zinc-400 hover:text-red-400"
              title="退出登录"
            >
              退出
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
