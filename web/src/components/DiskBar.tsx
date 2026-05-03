/**
 * Compact disk-space bar shown in the header. Polls /api/status/disk on
 * mount and whenever `refreshKey` changes (parent bumps it after upload
 * or rescan). Color shifts amber/red as the disk fills up so a glance
 * tells you whether there's room for the next album.
 */
import { useEffect, useState } from 'react';
import { api, type DiskInfo } from '../api';

interface Props {
  refreshKey?: number;
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export default function DiskBar({ refreshKey = 0 }: Props) {
  const [info, setInfo] = useState<DiskInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .disk()
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (err) {
    return <span className="text-xs text-red-400">disk: {err}</span>;
  }
  if (!info) {
    return <span className="text-xs text-zinc-500">disk: …</span>;
  }

  const pct = info.total_bytes > 0 ? (info.used_bytes / info.total_bytes) * 100 : 0;
  // Library share of total — shown as a brighter sub-segment so the user
  // can tell apart "music we put here" vs "everything else on the disk".
  const libPct =
    info.total_bytes > 0 ? (info.library_bytes / info.total_bytes) * 100 : 0;

  // Color the fill based on overall fullness.
  let fillColor = 'var(--accent)'; // healthy
  let glow = 'var(--accent-glow)';
  if (pct >= 90) {
    fillColor = '#ef4444';
    glow = 'rgba(239,68,68,0.5)';
  } else if (pct >= 75) {
    fillColor = '#f59e0b';
    glow = 'rgba(245,158,11,0.45)';
  }

  return (
    <div
      className="flex items-center gap-2"
      title={`Disk: ${fmtBytes(info.used_bytes)} used of ${fmtBytes(
        info.total_bytes,
      )} · Library: ${fmtBytes(info.library_bytes)} · Free: ${fmtBytes(info.free_bytes)}`}
    >
      <div
        className="relative rounded-full overflow-hidden"
        style={{
          width: 120,
          height: 6,
          background: 'linear-gradient(180deg, #0a0a0b, #1a1a1c)',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)',
        }}
      >
        {/* Total used (everything on the partition) */}
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: fillColor,
            boxShadow: `0 0 6px ${glow}`,
            transition: 'width 0.3s ease',
          }}
        />
        {/* Library subset — overlaid brighter so it pops within the used bar */}
        <div
          className="absolute inset-y-0 left-0 pointer-events-none"
          style={{
            width: `${Math.min(100, libPct)}%`,
            background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-soft) 100%)',
            opacity: 0.85,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span className="text-xs text-zinc-400 tabular-nums whitespace-nowrap">
        {fmtBytes(info.free_bytes)} free
      </span>
    </div>
  );
}
