import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Status } from '../types';
import UploadZone from './UploadZone';
import DiskBar from './DiskBar';

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
          className="hidden md:inline-flex text-xs px-3 py-1.5 rounded-full bezel disabled:opacity-50 text-zinc-300 hover:text-white"
          title="Scan music dir + auto-fetch missing covers from iTunes"
        >
          {scanning ? 'Scanning…' : 'Rescan + Covers'}
        </button>
      </div>
    </header>
  );
}
