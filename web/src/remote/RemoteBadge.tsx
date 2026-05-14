import { useRemote } from './RemoteContext';

/**
 * Host-side indicator showing "a phone is remoting this page".
 *
 * Design intent (per user feedback): passive and subtle, NOT a CTA. It
 * must stay visible the whole time a follower is connected — earlier
 * versions had a click-to-dismiss pill that the user could not bring back
 * without a page reload, which they didn't want. So no dismiss, no
 * pointer events, no hover interaction. The host can ignore it visually,
 * but always knows at a glance that the phone is in control.
 */
export default function RemoteBadge() {
  const remote = useRemote();

  if (remote.followerCount === 0) return null;
  // Don't show on the remote/phone itself — only on the host being remoted.
  if (remote.isRemote) return null;

  return (
    <div
      className="fixed top-2 left-2 z-30 pointer-events-none flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide select-none"
      style={{
        background: 'rgba(20, 6, 18, 0.55)',
        color: '#ff66cc',
        border: '1px solid rgba(255, 45, 181, 0.35)',
        boxShadow: '0 0 6px rgba(255, 45, 181, 0.25)',
        backdropFilter: 'blur(4px)',
      }}
      title="phone-remote-active"
      aria-label="A phone is remote-controlling this player"
    >
      <span aria-hidden className="text-[12px] leading-none">📱</span>
      <span className="leading-none">REMOTE</span>
      {remote.followerCount > 1 && (
        <span className="leading-none opacity-80">·{remote.followerCount}</span>
      )}
    </div>
  );
}
