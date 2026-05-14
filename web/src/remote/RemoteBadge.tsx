import { useState } from 'react';
import { useRemote } from './RemoteContext';

export default function RemoteBadge() {
  const remote = useRemote();
  const [dismissed, setDismissed] = useState(false);

  if (remote.followerCount === 0 || dismissed) return null;
  if (remote.isRemote) return null;

  return (
    <button
      type="button"
      onClick={() => setDismissed(true)}
      className="hidden md:flex fixed bottom-24 right-4 z-40 items-center gap-2 rounded-full bg-fuchsia-600/95 text-white text-xs font-medium px-3 py-1.5 shadow-lg hover:bg-fuchsia-500"
      title="手机正在遥控此页面 — 点击隐藏"
    >
      <span aria-hidden>📱</span>
      <span>手机正在遥控</span>
      {remote.followerCount > 1 && <span>×{remote.followerCount}</span>}
    </button>
  );
}
