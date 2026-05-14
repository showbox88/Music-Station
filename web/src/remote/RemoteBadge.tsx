import { useRemote } from './RemoteContext';

interface Props {
  /** Mobile variant — 28px circle to match MiniBtn in PlayerBar. */
  mini?: boolean;
}

/**
 * Host-side inline indicator that a phone is remoting this player.
 *
 * Lives in PlayerBar's action cluster so it sits next to the other
 * circular bezel buttons (shuffle/repeat/queue). Matches their
 * design language: bezel base, glow ring + glow text when active.
 *
 * Non-interactive on purpose — the user complained that the previous
 * dismissable pill disappeared on the first click. This one stays
 * visible the whole time a follower is connected and goes away on
 * its own once the follower disconnects.
 */
export default function RemoteBadge({ mini = false }: Props) {
  const remote = useRemote();
  if (remote.followerCount === 0) return null;
  // Don't show on the phone itself — only on the host being remoted.
  if (remote.isRemote) return null;

  const size = mini ? 'w-7 h-7' : 'w-8 h-8';
  const label =
    remote.followerCount > 1
      ? `${remote.followerCount} 部手机正在遥控`
      : '手机正在遥控';

  return (
    <div
      className={`${size} rounded-full bezel glow-text glow-ring flex items-center justify-center select-none pointer-events-none`}
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
      {remote.followerCount > 1 && (
        <span className="ml-0.5 text-[9px] font-semibold tabular-nums leading-none">
          {remote.followerCount}
        </span>
      )}
    </div>
  );
}
