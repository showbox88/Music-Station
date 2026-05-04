/**
 * Admin API — user management.
 *
 * Routes (mounted at /api/admin, gated by requireAdmin):
 *   GET    /users                       list all users
 *   POST   /users                       create user { username, password, display_name?, is_admin? }
 *   PUT    /users/:id                   update { display_name?, is_admin?, disabled? }
 *   POST   /users/:id/reset-password    body { new_password } → set + must_change_password=1
 *   DELETE /users/:id                   delete user (cascades sessions / future ownership rows)
 *
 * Self-protection rules: an admin cannot delete themselves, demote
 * themselves (is_admin=0), or disable themselves. This prevents the only
 * admin from accidentally locking everyone out.
 */
import { Router, type Request, type Response } from 'express';
import type { Database } from 'better-sqlite3';
import bcrypt from 'bcryptjs';

interface Deps {
  db: Database;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  is_admin: number;
  must_change_password: number;
  disabled: number;
  created_at: string;
}

function listUsers(db: Database): UserRow[] {
  return db
    .prepare(
      `SELECT id, username, display_name, is_admin, must_change_password,
              disabled, created_at
       FROM users
       ORDER BY id ASC`,
    )
    .all() as UserRow[];
}

function getUser(db: Database, id: number): UserRow | undefined {
  return db
    .prepare(
      `SELECT id, username, display_name, is_admin, must_change_password,
              disabled, created_at
       FROM users WHERE id = ?`,
    )
    .get(id) as UserRow | undefined;
}

export function adminRouter({ db }: Deps): Router {
  const r = Router();

  // GET /api/admin/users
  r.get('/users', (_req, res) => {
    res.json({ users: listUsers(db) });
  });

  // POST /api/admin/users
  r.post('/users', (req, res) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const displayName = req.body?.display_name
      ? String(req.body.display_name).trim()
      : null;
    const isAdmin = req.body?.is_admin ? 1 : 0;

    if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
      res.status(400).json({
        error: 'username must be 2-32 chars: lowercase letters, digits, _ or -',
      });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'password must be at least 6 chars' });
      return;
    }

    const exists = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username);
    if (exists) {
      res.status(409).json({ error: 'username already taken' });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, is_admin, must_change_password)
         VALUES (?, ?, ?, ?, 1)`,
      )
      .run(username, hash, displayName, isAdmin);

    const created = getUser(db, Number(result.lastInsertRowid));
    res.status(201).json({ ok: true, user: created });
  });

  // PUT /api/admin/users/:id
  r.put('/users/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    const target = getUser(db, id);
    if (!target) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    const me = req.user!;  // requireAdmin guarantees this

    const sets: string[] = [];
    const args: any[] = [];

    if (req.body?.display_name !== undefined) {
      const dn = req.body.display_name === null ? null : String(req.body.display_name).trim();
      sets.push('display_name = ?');
      args.push(dn);
    }
    if (req.body?.is_admin !== undefined) {
      const v = req.body.is_admin ? 1 : 0;
      if (id === me.id && v === 0) {
        res.status(400).json({ error: 'cannot demote yourself' });
        return;
      }
      sets.push('is_admin = ?');
      args.push(v);
    }
    if (req.body?.disabled !== undefined) {
      const v = req.body.disabled ? 1 : 0;
      if (id === me.id && v === 1) {
        res.status(400).json({ error: 'cannot disable yourself' });
        return;
      }
      sets.push('disabled = ?');
      args.push(v);
      // Disabling kicks all open sessions of that user
      if (v === 1) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
    }

    if (sets.length === 0) {
      res.json({ ok: true, user: target });
      return;
    }

    args.push(id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    res.json({ ok: true, user: getUser(db, id) });
  });

  // POST /api/admin/users/:id/reset-password
  r.post('/users/:id(\\d+)/reset-password', (req, res) => {
    const id = Number(req.params.id);
    const target = getUser(db, id);
    if (!target) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    const newPw = String(req.body?.new_password ?? '');
    if (newPw.length < 6) {
      res.status(400).json({ error: 'password must be at least 6 chars' });
      return;
    }
    const hash = bcrypt.hashSync(newPw, 10);
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`,
    ).run(hash, id);
    // Force re-login on this user
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ ok: true });
  });

  // DELETE /api/admin/users/:id
  r.delete('/users/:id(\\d+)', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const me = req.user!;
    if (id === me.id) {
      res.status(400).json({ error: 'cannot delete yourself' });
      return;
    }
    const target = getUser(db, id);
    if (!target) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true, deleted_id: id });
  });

  return r;
}
