import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Status } from '../types';
import UploadZone from './UploadZone';
import DiskBar from './DiskBar';

interface HeaderProps {
  onRescanned?: () => void;
  onUploaded?: () => void;
}

type RescanStats = Awaited<ReturnType<typeof api.rescan>>;

export default function Header({ onRescanned, onUploaded }: HeaderProps) {
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
      className="border-b border-black/80 px-6 py-3 flex items-center justify-between"
      style={{
        background: 'linear-gradient(180deg, #232325 0%, #1a1a1c 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.4)',
      }}
    >
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight glow-text">♪ Music Station</h1>
        <span className="text-xs text-zinc-500">
          {status ? `${status.tracks} tracks · ${status.playlists} playlists` : 'loading…'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {err && <span className="text-xs text-red-400">{err}</span>}
        {lastResult && (
          <span className="text-xs text-zinc-400">
            +{lastResult.inserted} new ·{' '}
            {lastResult.covers
              ? `${lastResult.covers.found}/${lastResult.covers.tried} covers fetched`
              : 'no cover fetch'}
          </span>
        )}
        <DiskBar refreshKey={diskRefresh} />
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
          className="text-xs px-3 py-1.5 rounded-full bezel disabled:opacity-50 text-zinc-300 hover:text-white"
          title="Scan music dir + auto-fetch missing covers from iTunes"
        >
          {scanning ? 'Scanning…' : 'Rescan + Covers'}
        </button>
      </div>
    </header>
  );
}
