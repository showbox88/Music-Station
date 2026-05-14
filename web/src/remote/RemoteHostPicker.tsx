import { useEffect, useState } from 'react';
import { useRemote } from './RemoteContext';
import { usePlayer } from '../player/PlayerContext';
import type { RestoreLocalSnapshot } from '../player/PlayerContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function RemoteHostPicker({ open, onClose }: Props) {
  const remote = useRemote();
  const player = usePlayer();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) remote.refreshDevices();
  }, [open, remote]);

  if (!open) return null;

  const eligible = remote.devices.filter(
    (d) => !d.is_self && d.online && !d.following,
  );

  async function pick(deviceId: string) {
    setBusy(deviceId);
    const snap: RestoreLocalSnapshot = {
      queue: player.queue,
      cursor: player.cursor,
      shuffledOrder: player.shuffledOrder,
      position_sec: player.position,
      was_playing: player.isPlaying,
      shuffle: player.shuffle,
      repeat: player.repeat,
      current_playlist_id: player.currentPlaylistId,
    };
    try {
      await remote.enable(deviceId, snap as unknown as Record<string, unknown>);
      onClose();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 text-zinc-100 w-full md:w-96 rounded-t-2xl md:rounded-2xl p-4 max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-3">选择遥控目标</h2>
        {eligible.length === 0 ? (
          <div className="text-sm text-zinc-400 py-6 text-center">
            没有其他在线设备。
            <button
              className="block mx-auto mt-3 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs"
              onClick={() => remote.refreshDevices()}
            >
              刷新
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {eligible.map((d) => (
              <li key={d.device_id}>
                <button
                  className="w-full flex items-center justify-between rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 disabled:opacity-50"
                  disabled={busy === d.device_id}
                  onClick={() => pick(d.device_id)}
                >
                  <span className="flex flex-col items-start">
                    <span className="text-sm font-medium">{d.name}</span>
                    {d.is_host && (
                      <span className="text-xs text-fuchsia-400">正在播放</span>
                    )}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {busy === d.device_id ? '连接中…' : '选这个'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          className="mt-4 w-full py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
          onClick={onClose}
        >
          取消
        </button>
      </div>
    </div>
  );
}
