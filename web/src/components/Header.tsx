import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Status } from '../types';
import UploadZone from './UploadZone';
import DiskBar from './DiskBar';
import { useAuth } from '../AuthContext';
import ChangePasswordModal from './ChangePasswordModal';
import { useT, useLanguage } from '../i18n/useT';
import { LANGUAGES, type Language } from '../i18n';
import { usePrefs } from '../PrefsContext';

interface HeaderProps {
  onRescanned?: () => void;
  onUploaded?: () => void;
  /** Mobile-only: open the sidebar drawer. */
  onOpenSidebar?: () => void;
}

type RescanStats = Awaited<ReturnType<typeof api.rescan>>;

export default function Header({ onRescanned, onUploaded, onOpenSidebar }: HeaderProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RescanStats | null>(null);
  // Bumped whenever something changes the library so DiskBar refetches.
  const [diskRefresh, setDiskRefresh] = useState(0);

  const load = () => {
    api.status().then(setStatus).catch((e) => setErr(String(e)));
  };
  useEffect(load, []);

  async function onRescan() {
    setScanning(true);
    setErr(null);
    try {
      const result = await api.rescan();
      setLastResult(result);
      load();
      setDiskRefresh((n) => n + 1);
      onRescanned?.();
      // Auto-clear the result blurb after 8 seconds
      setTimeout(() => setLastResult(null), 8000);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <header
      className="border-b border-black/80 px-3 md:px-6 py-3 flex items-center justify-between gap-2"
      style={{
        background: 'linear-gradient(180deg, #232325 0%, #1a1a1c 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.4)',
      }}
    >
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        {/* Mobile hamburger */}
        <button
          onClick={onOpenSidebar}
          className="md:hidden w-9 h-9 rounded-full bezel text-zinc-200 hover:text-white flex items-center justify-center shrink-0"
          title="Open menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        <h1 className="text-base md:text-lg font-semibold tracking-tight glow-text truncate">♪ Music Station</h1>
        <span className="hidden md:inline text-xs text-zinc-500">
          {status ? `${status.tracks} tracks · ${status.playlists} playlists` : 'loading…'}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {err && <span className="hidden md:inline text-xs text-red-400">{err}</span>}
        {lastResult && (
          <span className="hidden lg:inline text-xs text-zinc-400">
            +{lastResult.inserted} new ·{' '}
            {lastResult.covers
              ? `${lastResult.covers.found}/${lastResult.covers.tried} covers fetched`
              : 'no cover fetch'}
          </span>
        )}
        {/* Disk + Rescan are desktop-only — they're maintenance, not core. */}
        <div className="hidden md:flex items-center gap-2">
          <DiskBar refreshKey={diskRefresh} />
        </div>
        <UploadZone
          onUploaded={() => {
            load();
            setDiskRefresh((n) => n + 1);
            onUploaded?.();
          }}
        />
        <button
          onClick={onRescan}
          disabled={scanning}
          className="hidden md:inline-flex text-xs px-3 py-1.5 rounded-full bezel disabled:opacity-50 text-zinc-300 bezel-hover-glow"
          title="Scan music dir + auto-fetch missing covers from iTunes"
        >
          {scanning ? 'Scanning…' : 'Rescan + Covers'}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

/**
 * Avatar-style user menu in the top-right. Click to open a small popover
 * with display-name, change-password, and logout. Closes on outside-click
 * or Escape.
 */
function UserMenu() {
  const { user, logout } = useAuth();
  const t = useT();
  const lang = useLanguage();
  const { setPref } = usePrefs();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const initial = (user.display_name?.[0] ?? user.username[0] ?? '?').toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full bezel text-xs font-semibold flex items-center justify-center text-zinc-200 hover:text-white"
        title={user.display_name || user.username}
      >
        {initial}
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-52 rounded-lg shadow-2xl py-1 z-50"
          style={{
            background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
            border: '1px solid #050506',
          }}
        >
          <div className="px-3 py-2 border-b border-black/60">
            <div className="text-sm text-zinc-200 truncate">
              {user.display_name || user.username}
            </div>
            <div className="text-[10px] text-zinc-500 truncate">
              @{user.username}
              {!!user.is_admin && (
                <span className="ml-1 text-amber-400">· {t('user_menu.admin_label')}</span>
              )}
            </div>
          </div>
          {/* Language switcher — small two-segment pill, picks the one
              matching prefs.language (or browser default before set). */}
          <div className="px-3 py-2 border-b border-black/60">
            <div className="text-[10px] uppercase text-zinc-500 mb-1">
              {t('language.label')}
            </div>
            <div className="inline-flex rounded-full overflow-hidden text-xs"
                 style={{ border: '1px solid #050506' }}>
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setPref('language', l.code as Language)}
                  className={`px-3 py-1 ${
                    lang === l.code
                      ? 'glow-text glow-ring'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              setPwOpen(true);
              setOpen(false);
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5 hover:text-white"
          >
            {t('user_menu.change_password')}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-white/5 hover:text-red-300"
          >
            {t('user_menu.logout')}
          </button>
        </div>
      )}
      {pwOpen && (
        <ChangePasswordModal forced={false} onClose={() => setPwOpen(false)} />
      )}
    </div>
  );
}
