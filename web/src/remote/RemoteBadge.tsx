import { useRemote } from './RemoteContext';

interface Props {
  /** Mobile variant — 28px circle to match MiniBtn in PlayerBar. */
  mini?: boolean;
}

/**
 * Host-side "is a phone remoting this player" indicator.
 *
 * Always visible (never disappears unless we're the phone-side
 * follower itself). Two states, matching the other bezel-button
 * vocabulary in PlayerBar:
 *
 *   - idle  (followerCount === 0): plain bezel circle, muted icon,
 *           reads as "available but nothing happening yet".
 *   - lit   (followerCount  >  0): bezel + glow-text + glow-ring,
 *           same vocabulary as an active shuffle / repeat button.
 *
 * Non-interactive on purpose — pointer-events:none so clicks pass
 * through to whatever's underneath. The user's previous version
 * dismissed itself on click; they didn't want that.
 */
export default function RemoteBadge({ mini = false }: Props) {
  const remote = useRemote();

  // Hide on the phone itself — it's already controlling the host, so
  // a "phone is remoting" indicator on the phone is meaningless.
  if (remote.isRemote) return null;

  const active = remote.followerCount > 0;
  const size = mini ? 'w-7 h-7' : 'w-8 h-8';
  const label = active
    ? remote.followerCount > 1
      ? `${remote.followerCount} 部手机正在遥控`
      : '手机正在遥控'
    : '尚无手机遥控';

  return (
    <div
      className={`${size} rounded-full bezel flex items-center justify-center select-none pointer-events-none ${
        active ? 'glow-text glow-ring' : 'text-zinc-500'
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
    </div>
  );
}
