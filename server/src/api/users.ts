/**
 * Users API — read-only listings used by sharing UIs.
 *
 * GET /api/users/share-candidates
 *   Returns every other (non-disabled) user, minimal columns. Used by the
 *   "share this track with…" picker so users can pick recipients.
 *
 * Mounted behind requireAuth — any logged-in user can list candidates.
 */
import { Router } from 'express';
import type { Database } from 'better-sqlite3';

interface Deps {
  db: Database;
}

export function usersRouter({ db }: Deps): Router {
  const r = Router();

  r.get('/share-candidates', (req, res) => {
    const me = req.user!.id;
    const rows = db
      .prepare(
        `SELECT id, username, display_name
         FROM users
         WHERE id <> ? AND disabled = 0
         ORDER BY username ASC`,
      )
      .all(me);
    res.json({ users: rows });
  });

  return r;
}
