import { useEffect, useMemo } from 'react';
import QRCode from 'react-qr-code';
import { useRemote } from './RemoteContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Host-side "show pair QR" modal. The phone scans this and lands at
 *   <origin><BASE_URL>?remote_host=<deviceId>
 * which the App's deep-link handler picks up and auto-enables remote
 * mode against this host. The phone must already be logged in for the
 * same user — auth cookies still gate every API call.
 */
export default function RemoteQRDisplay({ open, onClose }: Props) {
  const remote = useRemote();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pairUrl = useMemo(() => {
    const origin = window.location.origin;
    const base = import.meta.env.BASE_URL || '/';
    return `${origin}${base}?remote_host=${encodeURIComponent(remote.deviceId)}`;
  }, [remote.deviceId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 text-zinc-100 w-[min(90vw,360px)] rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold mb-1">手机扫码遥控</h2>
        <p className="text-xs text-zinc-400 mb-4">
          用手机相机扫这个码，自动接管这台设备的播放。
        </p>
        <div className="bg-white p-3 rounded-lg flex items-center justify-center">
          <QRCode value={pairUrl} size={240} level="M" />
        </div>
        <div className="mt-3 text-[10px] text-zinc-500 break-all leading-snug">
          {pairUrl}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
