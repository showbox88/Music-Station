/**
 * Authentication context.
 *
 * - On mount, calls /api/auth/me to check whether we're already logged in
 *   (the cookie comes along automatically). The result becomes the source
 *   of truth for the rest of the app.
 * - Subscribes to the api.ts onUnauthorized hook so any 401 from any API
 *   call flips us back to the login screen.
 * - Exposes login(), logout(), changePassword() that wrap the api helpers
 *   and update local state on success.
 *
 * Consumers: App.tsx wraps its tree in <AuthProvider> and reads useAuth()
 * to gate the UI.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, onUnauthorized, type AuthUser } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;          // true while initial /me is in flight
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  changePassword: (oldPw: string, newPw: string) => Promise<void>;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  // Initial probe: am I already logged in?
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((r) => {
        if (!cancelled) setState({ user: r.user, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ user: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from any API call → log out locally
  useEffect(() => {
    return onUnauthorized(() => {
      setState((s) => (s.user ? { user: null, loading: false } : s));
    });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.login(username, password);
    setState({ user: r.user, loading: false });
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore — clear local state regardless */
    }
    setState({ user: null, loading: false });
  }, []);

  const changePassword = useCallback(async (oldPw: string, newPw: string) => {
    await api.changePassword(oldPw, newPw);
    // Re-fetch /me so must_change_password flips to 0 in our state.
    const r = await api.me();
    setState({ user: r.user, loading: false });
  }, []);

  return (
    <Ctx.Provider value={{ ...state, login, logout, changePassword }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
