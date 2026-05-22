import { useState } from 'react';
import { useRemote } from './RemoteContext';
import RemoteQRDisplay from './RemoteQRDisplay';

interface Props {
  /** Mobile variant — 28px circle to match MiniBtn in PlayerBar. */
  mini?: boolean;
}

/**
 * Host-side "remote" button. Two states, matching the other bezel-button
 * vocabulary in PlayerBar:
 *
 *   - idle  (followerCount === 0): plain bezel circle, click to show
 *           the pair-QR so a phone can scan and take over.
 *   - lit   (followerCount  >  0): bezel + glow-text + glow-ring,
 *           reads as "a phone is currently remoting this host". Still
 *           clickable — opens the QR again so another phone can pair.
 *
 * Hidden on the follower side (`remote.isRemote === true`) — a phone
 * that's already controlling someone else has nothing to host.
 */
export default function RemoteBadge({ mini = false }: Props) {
  const remote = useRemote();
  const [qrOpen, setQrOpen] = useState(false);

  if (remote.isRemote) return null;

  const active = remote.followerCount > 0;
  const size = mini ? 'w-7 h-7' : 'w-8 h-8';
  const label = active
    ? remote.followerCount > 1
      ? `${remote.followerCount} 部手机正在遥控 · 点击扫码新增`
      : '手机正在遥控 · 点击扫码新增'
    : '点击扫码遥控';

  return (
    <>
      <button
        type="button"
        onClick={() => setQrOpen(true)}
        className={`${size} rounded-full bezel flex items-center justify-center ${
          active ? 'glow-text glow-ring' : 'text-zinc-300 hover:text-white'
        }`}
        title={label}
        aria-label={label}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
        {active && remote.followerCount > 1 && (
          <span className="ml-0.5 text-[9px] font-semibold tabular-nums leading-none">
            {remote.followerCount}
          </span>
        )}
      </button>
      <RemoteQRDisplay open={qrOpen} onClose={() => setQrOpen(false)} />
    </>
  );
}
