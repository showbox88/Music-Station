/**
 * Reusable share-control panel:
 *   1. "Public" checkbox toggle that calls setVisibility().
 *   2. List of other users with checkboxes; saving calls setShares()
 *      with the chosen ids (replace semantics — server overwrites the
 *      whole share list with what we send).
 *
 * Replaces the near-identical state machine that used to live in three
 * places: VisibilityField inside EditTrackModal, FavoritesShareModal,
 * and PlaylistShareModal inside PlaylistView. Only the API endpoints
 * differed; the UI/state logic was 90% identical.
 *
 * Caller injects three callbacks so the same component works for
 * tracks, playlists, and favorites — see the three call sites for the
 * concrete API wiring.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ShareUser } from '../types';
import { useT } from '../i18n/useT';

interface Props {
  /** One-shot fetch of the current public flag + share list for whatever
   *  resource this panel is about. Called once on mount. */
  loadInitial: () => Promise<{ is_public: boolean; shared_with: ShareUser[] }>;
  /** Server call to flip public on/off. Returns the new value, which
   *  the panel uses to confirm the state. */
  setVisibility: (isPublic: boolean) => Promise<{ is_public: boolean }>;
  /** Server call to replace the share list with the given user_ids. */
  setShares: (userIds: number[]) => Promise<unknown>;
  /** Notify the parent after a successful visibility / share change so
   *  it can refresh its own view (e.g. update a sidebar badge). */
  onChanged?: () => void;
  /** Tailwind max-height class for the user list scroll area. Defaults
   *  to max-h-48 (matches PlaylistShareModal / FavoritesShareModal).
   *  EditTrackModal uses max-h-32 because it's nested inside a tab
   *  with limited vertical space. */
  maxListHeight?: string;
}

export default function UserSharePanel({
  loadInitial,
  setVisibility,
  setShares,
  onChanged,
  maxListHeight = 'max-h-48',
}: Props) {
  const t = useT();
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<ShareUser[]>([]);
  const [shared, setShared] = useState<Set<number>>(new Set());
  const [origShared, setOrigShared] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [savingShares, setSavingShares] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.shareCandidates(), loadInitial()])
      .then(([cands, init]) => {
        if (cancelled) return;
        setCandidates(cands.users);
        setIsPublic(init.is_public);
        const ids = new Set(init.shared_with.map((u) => u.id));
        setShared(ids);
        setOrigShared(new Set(ids));
        setLoaded(true);
      })
      .catch((e: any) => {
        if (!cancelled) setMsg(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
    // loadInitial is captured at first call — caller must give a stable
    // reference (typical usage: a closure over a fixed track id, etc.).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function togglePublic() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await setVisibility(!isPublic);
      setIsPublic(r.is_public);
      onChanged?.();
      setMsg(r.is_public ? t('share.now_public') : t('share.now_private'));
    } catch (e: any) {
      setMsg(t('share.save_failed', { err: e?.message ?? String(e) }));
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
      await setShares([...shared]);
      setOrigShared(new Set(shared));
      onChanged?.();
      setMsg(t('share.saved_share_count', { count: shared.size }));
    } catch (e: any) {
      setMsg(t('share.save_failed', { err: e?.message ?? String(e) }));
    } finally {
      setSavingShares(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={togglePublic}
          disabled={busy}
        />
        {t('share.public_toggle')}
      </label>

      <div className="text-xs text-zinc-500">
        {t('share.or_share_with_specific')}
      </div>

      {!loaded ? (
        <div className="text-xs text-zinc-500">{t('share.loading_users')}</div>
      ) : candidates.length === 0 ? (
        <div className="text-xs text-zinc-600">{t('share.no_other_users')}</div>
      ) : (
        <div
          className={`${maxListHeight} overflow-auto rounded border border-zinc-800 bg-black/30 p-1.5 space-y-0.5`}
        >
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

      {loaded && candidates.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveShares}
            disabled={!dirty || savingShares}
            className="px-3 py-1 rounded-full bezel text-xs glow-text glow-ring disabled:opacity-40"
          >
            {savingShares
              ? t('common.saving')
              : dirty
                ? t('share.save_share_list')
                : t('share.saved')}
          </button>
        </div>
      )}

      {msg && <div className="text-xs text-zinc-500">{msg}</div>}
    </div>
  );
}
