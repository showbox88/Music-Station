// web/src/remote/sse.ts
//
// Thin wrapper around EventSource. Browsers handle auto-reconnect; we
// add typed event registration and a clean disposer.

import type { RemoteSnapshot, RemoteDeviceEntry, RemoteAction } from '../api';

export type RemoteSseEvent =
  | { type: 'welcome'; data: { device_id: string; user_id: number } }
  | { type: 'presence'; data: { devices: RemoteDeviceEntry[] } }
  | { type: 'state'; data: RemoteSnapshot }
  | { type: 'command'; data: { from: string | null; action: RemoteAction; args: unknown } }
  | { type: 'host-offline'; data: { host: string } };

export interface RemoteSseHandle {
  close(): void;
}

export function openRemoteStream(
  deviceId: string,
  apiBase: string,
  onEvent: (ev: RemoteSseEvent) => void,
  onOpen?: () => void,
  onError?: (err: Event) => void,
): RemoteSseHandle {
  const url = `${apiBase}/me/remote/stream?device_id=${encodeURIComponent(deviceId)}`;
  const es = new EventSource(url, { withCredentials: true });

  const wrap = (type: RemoteSseEvent['type']) => (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type, data } as RemoteSseEvent);
    } catch {
      /* malformed payload — ignore */
    }
  };

  es.addEventListener('welcome', wrap('welcome'));
  es.addEventListener('presence', wrap('presence'));
  es.addEventListener('state', wrap('state'));
  es.addEventListener('command', wrap('command'));
  es.addEventListener('host-offline', wrap('host-offline'));

  if (onOpen) es.addEventListener('open', onOpen);
  if (onError) es.addEventListener('error', onError);

  return {
    close: () => es.close(),
  };
}
