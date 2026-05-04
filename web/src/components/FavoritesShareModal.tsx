/**
 * Modal for managing my favorites-list visibility + share list.
 *
 * Same pattern as the playlist share modal: a public toggle plus a
 * checklist of users to share with. Replace semantics on save.
 *
 * Opened from a 🔗 button next to the "Favorites" entry in the sidebar.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ShareUser } from '../types';

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

export default function FavoritesShareModal({ onClose, onChanged }: Props) {
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<ShareUser[]>([]);
  const [shared, setShared] = useState<Set<number>>(new Set());
  const [origShared, setOrigShared] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [savingShares, setSavingShares] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.shareCandidates(), api.getFavoritesSettings()])
      .then(([cands, settings]) => {
        setCandidates(cands.users);
        setIsPublic(settings.is_public);
        const ids = new Set(settings.shared_with.map((u) => u.id));
        setShared(ids);
        setOrigShared(new Set(ids));
        setLoaded(true);
      })
      .catch((e: any) => setMsg(`加载失败：${e?.message ?? e}`));
  }, []);

  async function togglePublic() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.setFavoritesVisibility(!isPublic);
      setIsPublic(r.is_public);
      onChanged();
      setMsg(r.is_public ? '已设为公开' : '已设为私有');
    } catch (e: any) {
      setMsg(`保存失败：${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  function toggleShare(id: number) {
    setShared((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const dirty =
    shared.size !== origShared.size ||
    [...shared].some((id) => !origShared.has(id));

  async function saveShares() {
    if (savingShares || !dirty) return;
    setSavingShares(true);
    setMsg(null);
    try {
      await api.setFavoritesShares([...shared]);
      setOrigShared(new Set(shared));
      onChanged();
      setMsg(`已更新分享列表（${shared.size} 人）`);
    } catch (e: any) {
      setMsg(`保存失败：${e?.message ?? e}`);
    } finally {
      setSavingShares(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl shadow-2xl p-6 space-y-3"
        style={{
          background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
          border: '1px solid #050506',
        }}
      >
        <div>
          <h2 className="text-base font-semibold">分享我的收藏</h2>
          <p className="text-xs text-zinc-500 mt-1">
            分享/公开后，对方在侧边栏会看到一项"
            <span className="text-zinc-300">你的名字 的收藏</span>
            "，里面收藏的歌也对他们透传可见（即使是你私有的歌）。
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={togglePublic}
            disabled={busy}
          />
          公开（所有登录用户都能看到）
        </label>

        <div className="text-xs text-zinc-500">或者只分享给特定用户：</div>

        {!loaded ? (
          <div className="text-xs text-zinc-500">加载用户列表…</div>
        ) : candidates.length === 0 ? (
          <div className="text-xs text-zinc-600">暂无其他用户。</div>
        ) : (
          <div className="max-h-48 overflow-auto rounded border border-zinc-800 bg-black/30 p-1.5 space-y-0.5">
            {candidates.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 text-sm text-zinc-300 px-1.5 py-1 rounded hover:bg-white/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={shared.has(u.id)}
                  onChange={() => toggleShare(u.id)}
                />
                <span className="truncate">
                  {u.display_name || u.username}
                  <span className="text-zinc-600 ml-1">@{u.username}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {msg && <div className="text-xs text-zinc-500">{msg}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
          >
            关闭
          </button>
          {loaded && candidates.length > 0 && (
            <button
              type="button"
              onClick={saveShares}
              disabled={!dirty || savingShares}
              className="px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-40"
            >
              {savingShares ? '保存中…' : dirty ? '保存分享列表' : '已保存'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
