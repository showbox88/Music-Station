/**
 * Admin panel — user management.
 *
 * Only mounted from Sidebar when the current user has is_admin=1.
 * The server enforces the same check on every endpoint, so the UI gate
 * is just a convenience.
 *
 * Operations:
 *   - List all users
 *   - Add user (username + initial password + admin flag)
 *   - Reset password
 *   - Toggle disabled (封锁)
 *   - Toggle admin (with self-protection on the server)
 *   - Delete user
 */
import { useEffect, useState } from 'react';
import { api, type AdminUser } from '../api';
import { useAuth } from '../AuthContext';

export default function AdminPanel() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .adminListUsers()
      .then((r) => {
        if (!cancelled) setUsers(r.users);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const refresh = () => setRefreshTick((n) => n + 1);

  return (
    <main className="flex-1 min-w-0 overflow-auto p-5">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold">⚙︎ 管理员后台 · 用户</h1>
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 rounded-full bezel glow-text glow-ring text-xs"
          >
            ＋ 添加用户
          </button>
        </div>

        {err && <div className="text-sm text-red-400 bg-red-950/30 p-2 rounded">{err}</div>}

        {loading ? (
          <div className="text-sm text-zinc-500">加载中…</div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isMe={u.id === me?.id}
                onChanged={refresh}
                onError={setErr}
              />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onError={setErr}
        />
      )}
    </main>
  );
}

function UserRow({
  user,
  isMe,
  onChanged,
  onError,
}: {
  user: AdminUser;
  isMe: boolean;
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function toggleDisabled() {
    if (isMe) return;
    if (busy) return;
    setBusy(true);
    try {
      await api.adminUpdateUser(user.id, { disabled: !user.disabled });
      onChanged();
    } catch (e: any) {
      onError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin() {
    if (isMe) return;
    if (busy) return;
    setBusy(true);
    try {
      await api.adminUpdateUser(user.id, { is_admin: !user.is_admin });
      onChanged();
    } catch (e: any) {
      onError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (isMe) return;
    if (busy) return;
    if (!confirm(`确认删除用户 ${user.username}？这会删除其会话。`)) return;
    setBusy(true);
    try {
      await api.adminDeleteUser(user.id);
      onChanged();
    } catch (e: any) {
      onError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-lg p-3 flex items-center gap-3"
      style={{
        background: 'linear-gradient(180deg, #232325 0%, #1a1a1c 100%)',
        border: '1px solid #050506',
        opacity: user.disabled ? 0.55 : 1,
      }}
    >
      <div className="w-9 h-9 rounded-full bezel flex items-center justify-center text-sm font-semibold text-zinc-200 shrink-0">
        {(user.display_name?.[0] ?? user.username[0]).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-zinc-200 truncate">
          {user.display_name || user.username}
          {!!user.is_admin && (
            <span className="ml-2 text-[10px] text-amber-400">admin</span>
          )}
          {!!user.must_change_password && (
            <span className="ml-2 text-[10px] text-sky-400">需改密</span>
          )}
          {!!user.disabled && (
            <span className="ml-2 text-[10px] text-red-400">已封锁</span>
          )}
          {isMe && <span className="ml-2 text-[10px] text-zinc-500">（我）</span>}
        </div>
        <div className="text-[11px] text-zinc-500 truncate">
          @{user.username} · 注册于 {user.created_at.slice(0, 10)}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 shrink-0">
        <button
          onClick={() => setResetting(true)}
          disabled={busy}
          className="px-2.5 py-1 rounded-full bezel text-[11px] text-zinc-300 hover:text-white"
        >
          重置密码
        </button>
        <button
          onClick={toggleAdmin}
          disabled={busy || isMe}
          className="px-2.5 py-1 rounded-full bezel text-[11px] text-zinc-300 hover:text-white disabled:opacity-40"
          title={isMe ? '不能改自己的管理员身份' : ''}
        >
          {user.is_admin ? '降为普通' : '设为管理员'}
        </button>
        <button
          onClick={toggleDisabled}
          disabled={busy || isMe}
          className="px-2.5 py-1 rounded-full bezel text-[11px] text-zinc-300 hover:text-white disabled:opacity-40"
          title={isMe ? '不能封锁自己' : ''}
        >
          {user.disabled ? '解封' : '封锁'}
        </button>
        <button
          onClick={remove}
          disabled={busy || isMe}
          className="px-2.5 py-1 rounded-full bezel text-[11px] text-red-400 hover:text-red-300 disabled:opacity-40"
          title={isMe ? '不能删除自己' : ''}
        >
          删除
        </button>
      </div>
      {resetting && (
        <ResetPasswordModal
          user={user}
          onClose={() => setResetting(false)}
          onDone={() => {
            setResetting(false);
            onChanged();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (s: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setLocalErr(null);
    if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
      setLocalErr('用户名 2-32 位，小写字母 / 数字 / _ / -');
      return;
    }
    if (password.length < 6) {
      setLocalErr('密码至少 6 位');
      return;
    }
    setBusy(true);
    try {
      await api.adminCreateUser({
        username,
        password,
        display_name: displayName.trim() || null,
        is_admin: isAdmin,
      });
      onCreated();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes('409')) setLocalErr('用户名已存在');
      else if (msg.includes('400')) setLocalErr('输入有误：' + msg);
      else {
        setLocalErr(msg);
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl shadow-2xl p-6 space-y-3"
        style={{
          background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
          border: '1px solid #050506',
        }}
      >
        <h2 className="text-base font-semibold">添加用户</h2>
        <p className="text-xs text-zinc-500">
          新用户首次登录会被强制改密。
        </p>

        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">用户名</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().trim())}
            placeholder="alice"
            autoFocus
            className="input w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">显示名（可选）</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alice Wang"
            className="input w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">初始密码（≥6 位）</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="把这个发给用户，他登录后必须改"
            className="input w-full font-mono"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
          />
          设为管理员
        </label>

        {localErr && (
          <div className="text-sm text-red-400 bg-red-950/30 p-2 rounded">{localErr}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !username || !password}
            className="px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-50"
          >
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
  onError,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
  onError: (s: string) => void;
}) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pw.length < 6) {
      setLocalErr('密码至少 6 位');
      return;
    }
    setBusy(true);
    try {
      await api.adminResetPassword(user.id, pw);
      onDone();
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setLocalErr(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl shadow-2xl p-6 space-y-3"
        style={{
          background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
          border: '1px solid #050506',
        }}
      >
        <h2 className="text-base font-semibold">重置 {user.username} 的密码</h2>
        <p className="text-xs text-zinc-500">
          重置后该用户被强制下线，下次登录用新密码并被要求再改一次。
        </p>
        <label className="block">
          <span className="text-xs uppercase text-zinc-500 mb-1 block">新密码（≥6 位）</span>
          <input
            type="text"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="input w-full font-mono"
          />
        </label>
        {localErr && (
          <div className="text-sm text-red-400 bg-red-950/30 p-2 rounded">{localErr}</div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || pw.length < 6}
            className="px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-50"
          >
            {busy ? '提交中…' : '重置'}
          </button>
        </div>
      </form>
    </div>
  );
}
