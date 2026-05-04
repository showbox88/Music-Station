/**
 * Auth API + middleware.
 *
 * Routes (mounted at /api/auth):
 *   POST   /login              { username, password } → sets mw_session cookie
 *   POST   /logout             clears cookie + deletes session
 *   GET    /me                 → current user (or 401)
 *   POST   /change-password    { old_password, new_password }
 *
 * Middleware:
 *   requireAuth(db)            attaches req.user, or 401s
 *   requireAdmin(db)           requireAuth + is_admin check
 *
 * Cookie:
 *   Name:        mw_session
 *   Value:       32-byte hex token, looked up in `sessions` table
 *   Attributes:  HttpOnly, SameSite=Lax, Path=/, 30-day expiry,
 *                Secure when NODE_ENV=production
 */
import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Database } from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const COOKIE_NAME = 'mw_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
  is_admin: number;
  must_change_password: number;
  disabled: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

interface UserRow extends AuthUser {
  password_hash: string;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function publicUser(u: AuthUser): Omit<AuthUser, 'disabled'> {
  // disabled is internal — clients don't need to see it on themselves
  // (a disabled user can't be logged in anyway).
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    is_admin: u.is_admin,
    must_change_password: u.must_change_password,
  } as Omit<AuthUser, 'disabled'>;
}

/**
 * Resolve the current user from the session cookie. Returns null if no
 * cookie, expired, user deleted, or user disabled.
 */
function lookupSession(db: Database, token: string | null): AuthUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.is_admin,
              u.must_change_password, u.disabled,
              s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as (AuthUser & { expires_at: string }) | undefined;
  if (!row) return null;
  if (row.disabled) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    is_admin: row.is_admin,
    must_change_password: row.must_change_password,
    disabled: row.disabled,
  };
}

export function requireAuth(db: Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = readCookie(req, COOKIE_NAME);
    const user = lookupSession(db, token);
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    req.user = user;
    next();
  };
}

export function requireAdmin(db: Database) {
  const auth = requireAuth(db);
  return (req: Request, res: Response, next: NextFunction): void => {
    auth(req, res, () => {
      if (!req.user || !req.user.is_admin) {
        res.status(403).json({ error: 'admin only' });
        return;
      }
      next();
    });
  };
}

export function authRouter({ db }: { db: Database }): Router {
  const r = Router();

  // POST /api/auth/login
  r.post('/login', (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!username || !password) {
      res.status(400).json({ error: 'username and password required' });
      return;
    }
    const row = db
      .prepare(
        `SELECT id, username, password_hash, display_name, is_admin,
                must_change_password, disabled
         FROM users WHERE username = ?`,
      )
      .get(username) as UserRow | undefined;
    if (!row) {
      // Constant-ish-time: still hash a dummy to avoid trivial username probing.
      bcrypt.compareSync(password, '$2a$10$invalidsaltinvalidsaltinvalidsaltinvali');
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    if (row.disabled) {
      res.status(403).json({ error: 'account disabled' });
      return;
    }
    if (!bcrypt.compareSync(password, row.password_hash)) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)`,
    ).run(token, row.id, expires, String(req.headers['user-agent'] ?? '').slice(0, 200));

    setSessionCookie(res, token);
    res.json({ ok: true, user: publicUser(row) });
  });

  // POST /api/auth/logout
  r.post('/logout', (req, res) => {
    const token = readCookie(req, COOKIE_NAME);
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // GET /api/auth/me
  r.get('/me', (req, res) => {
    const token = readCookie(req, COOKIE_NAME);
    const user = lookupSession(db, token);
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    res.json({ user: publicUser(user) });
  });

  // POST /api/auth/change-password
  // Available even when must_change_password=1 (that's the whole point).
  r.post('/change-password', (req, res) => {
    const token = readCookie(req, COOKIE_NAME);
    const user = lookupSession(db, token);
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const oldPw = String(req.body?.old_password ?? '');
    const newPw = String(req.body?.new_password ?? '');
    if (!newPw || newPw.length < 6) {
      res.status(400).json({ error: 'new password must be at least 6 chars' });
      return;
    }
    const row = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string } | undefined;
    if (!row) {
      res.status(401).json({ error: 'user gone' });
      return;
    }
    if (!bcrypt.compareSync(oldPw, row.password_hash)) {
      res.status(401).json({ error: 'old password incorrect' });
      return;
    }
    const newHash = bcrypt.hashSync(newPw, 10);
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
    ).run(newHash, user.id);
    // Invalidate other sessions but keep the current one — user stays signed in
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(user.id, token);
    res.json({ ok: true });
  });

  return r;
}
