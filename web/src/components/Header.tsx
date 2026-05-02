import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Status } from '../types';
import UploadZone from './UploadZone';

interface HeaderProps {
  onRescanned?: () => void;
  onUploaded?: () => void;
}

export default function Header({ onRescanned, onUploaded }: HeaderProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    api.status().then(setStatus).catch((e) => setErr(String(e)));
  };
  useEffect(load, []);

  async function onRescan() {
    setScanning(true);
    setErr(null);
    try {
      await api.rescan();
      load();
      onRescanned?.();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <header className="border-b border-zinc-800 bg-zinc-900 px-6 py-3 flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight">🎵 Music Station</h1>
        <span className="text-xs text-zinc-500">
          {status ? `${status.tracks} tracks · ${status.playlists} playlists` : 'loading…'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {err && <span className="text-xs text-red-400">{err}</span>}
        <UploadZone
          onUploaded={() => {
            load();
            onUploaded?.();
          }}
        />
        <button
          onClick={onRescan}
          disabled={scanning}
          className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Rescan'}
        </button>
      </div>
    </header>
  );
}
