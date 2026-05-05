import { useEffect, useState } from 'react';
import { api, type TrackEdit } from '../api';
import type { Track } from '../types';
import StarRating from './StarRating';
import CoverPicker from './CoverPicker';
import { useT } from '../i18n/useT';
import ModalShell from './Modal';
import UserSharePanel from './UserSharePanel';
import LyricsField from './edit-track/LyricsField';

interface Props {
  track: Track;
  onClose: () => void;
  onSaved: (updated: Track) => void;
}

type ModalTab = 'info' | 'lyrics' | 'share';

export default function EditTrackModal({ track, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    title: track.title ?? '',
    artist: track.artist ?? '',
    album: track.album ?? '',
    genre: track.genre ?? '',
    year: track.year != null ? String(track.year) : '',
    track_no: track.track_no != null ? String(track.track_no) : '',
    rating: track.rating ?? 0,
  });
  const [coverUrl, setCoverUrl] = useState<string | null>(track.cover_url);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<ModalTab>('info');
  const t = useT();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      // Owner-only metadata fields are dropped from the payload for
      // non-owners — the server would 403 the request as a whole if any
      // owner-only key is present, so we'd lose the rating change too.
      // rating is always per-user so always sent.
      const payload: TrackEdit = track.is_owner
        ? {
            title: form.title.trim() || null,
            artist: form.artist.trim() || null,
            album: form.album.trim() || null,
            genre: form.genre.trim() || null,
            year: form.year.trim() ? Number(form.year) : null,
            track_no: form.track_no.trim() ? Number(form.track_no) : null,
            rating: form.rating,
          }
        : { rating: form.rating };
      const updated = await api.updateTrack(track.id, payload);
      // Cover URL may have been changed by CoverPicker out-of-band; reflect it
      onSaved({ ...updated, cover_url: coverUrl });
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      as="form"
      onSubmit={onSave}
      onClose={onClose}
      maxWidth="max-w-lg"
      className="flex flex-col max-h-[90vh]"
    >
        {/* Header */}
        <div className="px-6 pt-6 pb-3 shrink-0">
          <h2 className="text-lg font-semibold">{t('modal_edit.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1 truncate">{track.rel_path}</p>
          {!track.is_owner && (
            <p className="text-xs text-amber-400 mt-2">
              {t('modal_edit.non_owner_warning', {
                name: track.owner_display_name || track.owner_username || '',
              })}
            </p>
          )}
        </div>

        {/* Tab strip */}
        <div className="px-6 shrink-0 flex gap-1.5 border-b border-black/60">
          <ModalTabButton id="info" active={tab} setTab={setTab}>
            {t('modal_edit.tab.info')}
          </ModalTabButton>
          <ModalTabButton id="lyrics" active={tab} setTab={setTab}>
            {t('modal_edit.tab.lyrics')}
          </ModalTabButton>
          {track.is_owner && (
            <ModalTabButton id="share" active={tab} setTab={setTab}>
              {t('modal_edit.tab.share')}
            </ModalTabButton>
          )}
        </div>

        {/* Tab content — scrollable so the modal stays bounded */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-4 space-y-4">
          {tab === 'info' && (
            <>
              <Field label={t("modal_edit.field.cover")}>
                <CoverPicker
                  track={{ ...track, cover_url: coverUrl }}
                  onChanged={setCoverUrl}
                />
              </Field>

              <Field label={t("modal_edit.field.rating")}>
                <StarRating
                  value={form.rating}
                  onChange={(v) => setForm({ ...form, rating: v })}
                  size="md"
                />
              </Field>

              <Field label={t("modal_edit.field.title")}>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="input"
                  autoFocus
                  disabled={!track.is_owner}
                />
              </Field>
              <Field label={t("modal_edit.field.artist")}>
                <input
                  type="text"
                  value={form.artist}
                  onChange={(e) => setForm({ ...form, artist: e.target.value })}
                  className="input"
                  disabled={!track.is_owner}
                />
              </Field>
              <Field label={t("modal_edit.field.album")}>
                <input
                  type="text"
                  value={form.album}
                  onChange={(e) => setForm({ ...form, album: e.target.value })}
                  className="input"
                  disabled={!track.is_owner}
                />
              </Field>
              <Field label={t("modal_edit.field.genre")}>
                <input
                  type="text"
                  value={form.genre}
                  onChange={(e) => setForm({ ...form, genre: e.target.value })}
                  className="input"
                  disabled={!track.is_owner}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("modal_edit.field.year")}>
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    value={form.year}
                    onChange={(e) => setForm({ ...form, year: e.target.value })}
                    className="input"
                    disabled={!track.is_owner}
                  />
                </Field>
                <Field label={t("modal_edit.field.track_no")}>
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    value={form.track_no}
                    onChange={(e) => setForm({ ...form, track_no: e.target.value })}
                    className="input"
                    disabled={!track.is_owner}
                  />
                </Field>
              </div>
            </>
          )}

          {tab === 'lyrics' && <LyricsField track={track} />}

          {tab === 'share' && track.is_owner && <VisibilityField track={track} />}
        </div>

        {/* Footer */}
        {err && (
          <div className="px-6 pb-2 shrink-0">
            <div className="error-box">{err}</div>
          </div>
        )}
        <div className="px-6 pb-5 pt-3 shrink-0 flex justify-end gap-2 border-t border-black/60">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
    </ModalShell>
  );
}

function ModalTabButton({
  id,
  active,
  setTab,
  children,
}: {
  id: ModalTab;
  active: ModalTab;
  setTab: (t: ModalTab) => void;
  children: React.ReactNode;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
        isActive
          ? 'border-pink-500 glow-text'
          : 'border-transparent text-zinc-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Visibility / sharing controls for the track owner.
 *
 *  - "公开" toggle: any logged-in user can then see this track.
 *  - User picker: a checklist of all other users; checked users get this
 *    track via track_shares. PUT-replace semantics — the displayed checked
 *    set is the current truth, save commits it.
 */
function VisibilityField({ track }: { track: Track }) {
  return (
    <UserSharePanel
      maxListHeight="max-h-32"
      loadInitial={async () => {
        const r = await api.getTrackShares(track.id);
        return { is_public: track.is_public, shared_with: r.shared_with };
      }}
      setVisibility={(pub) => api.setTrackVisibility(track.id, pub)}
      setShares={(ids) => api.setTrackShares(track.id, ids)}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase text-zinc-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
