/**
 * Favorites-list sharing API (Slice 5).
 *
 * The "favorites list" is a per-user concept — every user has exactly one,
 * stored as user_favorites rows. This router exposes endpoints for:
 *
 *   - reading/setting MY visibility + share list
 *   - listing OTHERS whose favorites are visible to me
 *   - reading another user's favorites (visibility-checked)
 *
 * Routes (mounted at /api/favorites):
 *   GET /settings           → my { is_public, shared_with: ShareUser[] }
 *   PUT /visibility         body { is_public }
 *   PUT /shares             body { user_ids: [...] }   (replace)
 *   GET /visible-owners     → who shares their favorites with me + counts
 *   GET /of/:userId         → another user's favorites (visibility-checked)
 *
 * A track inside someone's shared favorites is transitively visible to the
 * recipient — that path is wired into VISIBLE_PREDICATE in tracks.ts so
 * /tracks endpoints reflect it automatically.
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';

interface Deps {
  db: Database;
  publicUrl: string;
}

interface TrackRow {
  id: number;
  rel_path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  track_no: number | null;
  duration_sec: number | null;
  size_bytes: number;
  bitrate: number | null;
  mime: string | null;
  rating: number | null;
  cover_filename: string | null;
  added_at: string;
  modified_at: string;
  last_edited_at: string | null;
  owner_id: number | null;
  is_public: number;
  owner_username: string | null;
  owner_display_name: string | null;
  favorited_by_me: number;
  my_rating: number | null;
}

function buildAudioUrl(publicUrl: string, relPath: string): string {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `${publicUrl.replace(/\/+$/, '')}/audio/${encoded}`;
}

function trackDto(row: TrackRow, publicUrl: string, meId: number) {
  const isOwner = row.owner_id === meId;
  let source: 'mine' | 'public' | 'shared' = 'mine';
  if (!isOwner) source = row.is_public ? 'public' : 'shared';
  return {
    id: row.id,
    rel_path: row.rel_path,
    title: row.title,
    artist: row.artist,
    album: row.album,
    genre: row.genre,
    year: row.year,
    track_no: row.track_no,
    duration_sec: row.duration_sec,
    size_bytes: row.size_bytes,
    bitrate: row.bitrate,
    mime: row.mime,
    rating: row.my_rating ?? 0,
    favorited: !!row.favorited_by_me,
    added_at: row.added_at,
    modified_at: row.modified_at,
    last_edited_at: row.last_edited_at,
    url: buildAudioUrl(publicUrl, row.rel_path),
    cover_url: row.cover_filename
      ? `/api/covers/${encodeURIComponent(row.cover_filename)}?v=${encodeURIComponent(row.modified_at)}`
      : null,
    owner_id: row.owner_id,
    owner_username: row.owner_username,
    owner_display_name: row.owner_display_name,
    is_public: !!row.is_public,
    is_owner: isOwner,
    shared_with_me: !isOwner && !row.is_public,
    source,
  };
}

export function favoritesRouter({ db, publicUrl }: Deps): Router {
  const r = Router();

  function meId(req: any): number {
    return req.user!.id as number;
  }

  // GET /api/favorites/settings — my visibility + shares list
  r.get('/settings', (req, res) => {
    const me = meId(req);
    const u = db
      .prepare('SELECT favorites_public FROM users WHERE id = ?')
      .get(me) as { favorites_public: number };
    const shared = db
      .prepare(
        `SELECT u.id, u.username, u.display_name
         FROM favorites_shares fs JOIN users u ON u.id = fs.with_user_id
         WHERE fs.owner_user_id = ?
         ORDER BY u.username ASC`,
      )
      .all(me);
    res.json({ is_public: !!u.favorites_public, shared_with: shared });
  });

  // PUT /api/favorites/visibility — { is_public }
  r.put('/visibility', (req, res) => {
    const me = meId(req);
    const v = req.body?.is_public ? 1 : 0;
    db.prepare('UPDATE users SET favorites_public = ? WHERE id = ?').run(v, me);
    res.json({ ok: true, is_public: !!v });
  });

  // PUT /api/favorites/shares — replace shared-with list
  r.put('/shares', (req, res) => {
    const me = meId(req);
    const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
    const userIds: number[] = ids
      .map((x: any) => Number(x))
      .filter((n: number) => Number.isInteger(n) && n > 0 && n !== me);
    const tx = db.transaction((targetIds: number[]) => {
      db.prepare('DELETE FROM favorites_shares WHERE owner_user_id = ?').run(me);
      const ins = db.prepare(
        'INSERT OR IGNORE INTO favorites_shares (owner_user_id, with_user_id) VALUES (?, ?)',
      );
      for (const uid of targetIds) {
        const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid);
        if (exists) ins.run(me, uid);
      }
    });
    tx(userIds);
    const shared = db
      .prepare(
        `SELECT u.id, u.username, u.display_name
         FROM favorites_shares fs JOIN users u ON u.id = fs.with_user_id
         WHERE fs.owner_user_id = ?
         ORDER BY u.username ASC`,
      )
      .all(me);
    res.json({ ok: true, shared_with: shared });
  });

  // GET /api/favorites/visible-owners — every user (≠ me) whose favorites I can see
  // Returns { user, count, is_public, shared_with_me } per visible owner.
  r.get('/visible-owners', (req, res) => {
    const me = meId(req);
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.display_name,
                u.favorites_public,
                CASE WHEN fs.with_user_id IS NULL THEN 0 ELSE 1 END AS shared_with_me,
                (SELECT COUNT(*) FROM user_favorites uf WHERE uf.user_id = u.id) AS count
         FROM users u
         LEFT JOIN favorites_shares fs
           ON fs.owner_user_id = u.id AND fs.with_user_id = @me
         WHERE u.id <> @me
           AND u.disabled = 0
           AND (u.favorites_public = 1 OR fs.with_user_id IS NOT NULL)
         ORDER BY u.username ASC`,
      )
      .all({ me }) as Array<{
        id: number;
        username: string;
        display_name: string | null;
        favorites_public: number;
        shared_with_me: number;
        count: number;
      }>;
    res.json({
      owners: rows.map((r) => ({
        user: { id: r.id, username: r.username, display_name: r.display_name },
        count: r.count,
        is_public: !!r.favorites_public,
        shared_with_me: !!r.shared_with_me,
      })),
    });
  });

  // GET /api/favorites/of/:userId — another user's favorites (visibility-checked)
  r.get('/of/:userId(\\d+)', (req, res) => {
    const me = meId(req);
    const uid = Number(req.params.userId);

    const owner = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.favorites_public, u.disabled,
                CASE WHEN fs.with_user_id IS NULL THEN 0 ELSE 1 END AS shared_with_me
         FROM users u
         LEFT JOIN favorites_shares fs
           ON fs.owner_user_id = u.id AND fs.with_user_id = @me
         WHERE u.id = @uid`,
      )
      .get({ me, uid }) as
      | {
          id: number;
          username: string;
          display_name: string | null;
          favorites_public: number;
          disabled: number;
          shared_with_me: number;
        }
      | undefined;
    if (!owner) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    const isOwner = owner.id === me;
    const visible =
      isOwner ||
      owner.favorites_public === 1 ||
      owner.shared_with_me === 1;
    if (!visible) {
      res.status(403).json({ error: 'favorites not shared with you' });
      return;
    }

    const tracks = db
      .prepare(
        `SELECT t.*,
                tu.username     AS owner_username,
                tu.display_name AS owner_display_name,
                CASE WHEN myf.track_id IS NULL THEN 0 ELSE 1 END AS favorited_by_me,
                utr.rating AS my_rating
         FROM user_favorites uf
         JOIN tracks t ON t.id = uf.track_id
         LEFT JOIN users tu ON tu.id = t.owner_id
         LEFT JOIN user_favorites myf ON myf.track_id = t.id AND myf.user_id = @me
         LEFT JOIN user_track_ratings utr ON utr.track_id = t.id AND utr.user_id = @me
         WHERE uf.user_id = @uid
         ORDER BY uf.added_at DESC`,
      )
      .all({ me, uid }) as TrackRow[];

    res.json({
      user: {
        id: owner.id,
        username: owner.username,
        display_name: owner.display_name,
      },
      is_public: !!owner.favorites_public,
      shared_with_me: !!owner.shared_with_me,
      is_owner: isOwner,
      tracks: tracks.map((t) => trackDto(t, publicUrl, me)),
    });
  });

  return r;
}
