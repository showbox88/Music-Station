/**
 * Per-user prefs + per-user-per-track EQ (Slice 6).
 *
 * user_prefs.data is a free-form JSON blob — schema-less so we can grow new
 * settings without DB migrations. Currently expected fields:
 *   {
 *     spatial_preset:   'off' | 'cinema' | 'hall' | 'club',
 *     viz_style:        string,
 *     global_eq_enabled: boolean,
 *     global_eq:        { gains: number[], preamp: number, bypass: boolean }
 *   }
 *
 * Routes (mounted at /api/me):
 *   GET    /prefs                  → my full prefs JSON
 *   PUT    /prefs                  body { ...partial }  → merged into stored JSON
 *   GET    /track-eq               → map of { track_id: EQState } for me
 *   PUT    /track-eq/:trackId      body { gains, preamp, bypass } → save
 *   DELETE /track-eq/:trackId      → remove (track falls back to flat)
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';

interface Deps {
  db: Database;
}

function getPrefs(db: Database, userId: number): Record<string, unknown> {
  const row = db.prepare('SELECT data FROM user_prefs WHERE user_id = ?').get(userId) as
    | { data: string }
    | undefined;
  if (!row) return {};
  try {
    const j = JSON.parse(row.data);
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function savePrefs(db: Database, userId: number, data: Record<string, unknown>): void {
  const json = JSON.stringify(data);
  db.prepare(
    `INSERT INTO user_prefs (user_id, data) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`,
  ).run(userId, json);
}

export function prefsRouter({ db }: Deps): Router {
  const r = Router();

  function meId(req: any): number {
    return req.user!.id as number;
  }

  // GET /api/me/prefs
  r.get('/prefs', (req, res) => {
    res.json(getPrefs(db, meId(req)));
  });

  // PUT /api/me/prefs — merge body into stored JSON (PATCH-like).
  // Sending null for a key removes it; sending a value replaces it.
  // Top-level only — nested objects are replaced wholesale.
  r.put('/prefs', (req, res) => {
    const me = meId(req);
    const incoming = req.body && typeof req.body === 'object' ? req.body : null;
    if (!incoming) {
      res.status(400).json({ error: 'body must be a JSON object' });
      return;
    }
    // Cap size — defensive against runaway clients.
    if (JSON.stringify(incoming).length > 64 * 1024) {
      res.status(413).json({ error: 'prefs too large (max 64KB)' });
      return;
    }
    const existing = getPrefs(db, me);
    for (const [k, v] of Object.entries(incoming)) {
      if (v === null) delete existing[k];
      else existing[k] = v;
    }
    savePrefs(db, me, existing);
    res.json(existing);
  });

  // GET /api/me/track-eq — full map of my per-track EQ entries.
  r.get('/track-eq', (req, res) => {
    const me = meId(req);
    const rows = db
      .prepare('SELECT track_id, data FROM user_track_eq WHERE user_id = ?')
      .all(me) as Array<{ track_id: number; data: string }>;
    const out: Record<number, unknown> = {};
    for (const row of rows) {
      try {
        out[row.track_id] = JSON.parse(row.data);
      } catch {
        /* skip corrupted entry */
      }
    }
    res.json(out);
  });

  // PUT /api/me/track-eq/:trackId — body is the EQState JSON
  r.put('/track-eq/:trackId(\\d+)', (req, res) => {
    const me = meId(req);
    const trackId = Number(req.params.trackId);
    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'body must be a JSON object' });
      return;
    }
    // Verify the track exists. We don't visibility-check here — saving an
    // EQ for a track you can see today doesn't grant any cross-user access,
    // and visibility may change.
    const exists = db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId);
    if (!exists) {
      res.status(404).json({ error: 'track not found' });
      return;
    }
    const json = JSON.stringify(body);
    if (json.length > 8 * 1024) {
      res.status(413).json({ error: 'eq blob too large' });
      return;
    }
    db.prepare(
      `INSERT INTO user_track_eq (user_id, track_id, data) VALUES (?, ?, ?)
       ON CONFLICT(user_id, track_id) DO UPDATE SET data = excluded.data`,
    ).run(me, trackId, json);
    res.json({ ok: true });
  });

  // DELETE /api/me/track-eq/:trackId
  r.delete('/track-eq/:trackId(\\d+)', (req, res) => {
    const me = meId(req);
    const trackId = Number(req.params.trackId);
    db.prepare('DELETE FROM user_track_eq WHERE user_id = ? AND track_id = ?').run(me, trackId);
    res.json({ ok: true });
  });

  return r;
}
