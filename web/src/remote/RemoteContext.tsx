// web/src/remote/RemoteContext.tsx

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api, type RemoteDeviceEntry, type RemoteSnapshot, type RemoteAction } from '../api';
import { openRemoteStream, type RemoteSseHandle } from './sse';
import { useAuth } from '../AuthContext';

const LS_DEVICE_ID = 'mw.remote.device_id';
const LS_DEVICE_NAME = 'mw.remote.device_name';
const SS_ON = 'mw.remote.on';
const SS_HOST = 'mw.remote.host';
export const SS_RESTORE = 'mw.remote.restore';

function getOrCreateDeviceId(): string {
  let id = window.localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    window.localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

export type CommandIncoming = {
  from: string | null;
  action: RemoteAction;
  args: unknown;
};

export type RestoreSnapshot = { [k: string]: unknown };

interface RemoteContextValue {
  deviceId: string;
  devices: RemoteDeviceEntry[];
  isRemote: boolean;
  selectedHost: string | null;
  hostSnapshot: RemoteSnapshot | null;
  hostName: string | null;
  lastCommand: { seq: number; payload: CommandIncoming } | null;
  followerCount: number;
  hostOffline: boolean;

  enable(hostId: string, restoreSnapshot: RestoreSnapshot | null): Promise<void>;
  disable(): Promise<RestoreSnapshot | null>;
  sendCommand(action: RemoteAction, args?: unknown): Promise<void>;
  publishState(snapshot: RemoteSnapshot): Promise<void>;
  refreshDevices(): Promise<void>;
}

const Ctx = createContext<RemoteContextValue | null>(null);

export function useRemote(): RemoteContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRemote must be inside RemoteProvider');
  return v;
}

export function RemoteProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const deviceId = useMemo(getOrCreateDeviceId, []);
  const [devices, setDevices] = useState<RemoteDeviceEntry[]>([]);
  const [selectedHost, setSelectedHost] = useState<string | null>(
    () => window.sessionStorage.getItem(SS_HOST) || null,
  );
  const [remoteOn, setRemoteOn] = useState<boolean>(
    () => window.sessionStorage.getItem(SS_ON) === '1',
  );
  const [hostSnapshot, setHostSnapshot] = useState<RemoteSnapshot | null>(null);
  const [lastCommand, setLastCommand] = useState<RemoteContextValue['lastCommand']>(null);
  const [hostOffline, setHostOffline] = useState(false);
  const sseRef = useRef<RemoteSseHandle | null>(null);
  const cmdSeqRef = useRef(0);

  useEffect(() => {
    if (!user) {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    let cancelled = false;
    api
      .registerRemote(deviceId, window.localStorage.getItem(LS_DEVICE_NAME) || undefined)
      .catch(() => {/* non-fatal */})
      .then(() => {
        if (cancelled) return;
        // Use the same base prefix as api.ts so SSE goes through the
        // /app→backend Tailscale-serve rule, not the /→port-3001 fallback.
        const apiBase = `${import.meta.env.BASE_URL}api`;
        sseRef.current = openRemoteStream(deviceId, apiBase, (ev) => {
          switch (ev.type) {
            case 'presence':
              setDevices(ev.data.devices);
              break;
            case 'state':
              setHostSnapshot(ev.data);
              setHostOffline(false);
              break;
            case 'command':
              cmdSeqRef.current += 1;
              setLastCommand({ seq: cmdSeqRef.current, payload: ev.data });
              break;
            case 'host-offline':
              setHostOffline(true);
              break;
            case 'welcome':
              break;
          }
        });
      });
    return () => {
      cancelled = true;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [user, deviceId]);

  // Re-follow on reload if remote was active.
  useEffect(() => {
    if (!remoteOn || !selectedHost || !user) return;
    api
      .followHost(deviceId, selectedHost)
      .then((r) => setHostSnapshot(r.snapshot))
      .catch(() => setHostOffline(true));
  }, [user, remoteOn, selectedHost, deviceId]);

  const followerCount = useMemo(
    () => devices.filter((d) => d.following === deviceId).length,
    [devices, deviceId],
  );

  const hostName = useMemo(() => {
    if (!selectedHost) return null;
    return devices.find((d) => d.device_id === selectedHost)?.name ?? null;
  }, [selectedHost, devices]);

  const enable = useCallback(
    async (hostId: string, restoreSnapshot: RestoreSnapshot | null) => {
      const r = await api.followHost(deviceId, hostId);
      setSelectedHost(hostId);
      setRemoteOn(true);
      setHostSnapshot(r.snapshot);
      setHostOffline(false);
      window.sessionStorage.setItem(SS_HOST, hostId);
      window.sessionStorage.setItem(SS_ON, '1');
      if (restoreSnapshot) {
        window.sessionStorage.setItem(SS_RESTORE, JSON.stringify(restoreSnapshot));
      } else {
        window.sessionStorage.removeItem(SS_RESTORE);
      }
    },
    [deviceId],
  );

  const disable = useCallback(async (): Promise<RestoreSnapshot | null> => {
    setRemoteOn(false);
    setHostSnapshot(null);
    setHostOffline(false);
    window.sessionStorage.removeItem(SS_ON);
    window.sessionStorage.removeItem(SS_HOST);
    api.unfollowHost(deviceId).catch(() => {/* ignore */});
    const raw = window.sessionStorage.getItem(SS_RESTORE);
    window.sessionStorage.removeItem(SS_RESTORE);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RestoreSnapshot;
    } catch {
      return null;
    }
  }, [deviceId]);

  const sendCommand = useCallback(
    async (action: RemoteAction, args: unknown = null) => {
      if (!selectedHost) return;
      try {
        await api.sendRemoteCommand(deviceId, selectedHost, action, args);
      } catch (e) {
        if (String(e).includes('409')) setHostOffline(true);
      }
    },
    [selectedHost, deviceId],
  );

  const publishState = useCallback(
    async (snapshot: RemoteSnapshot) => {
      try {
        await api.publishRemoteState(deviceId, snapshot);
      } catch {
        /* next push will retry */
      }
    },
    [deviceId],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const r = await api.listRemoteDevices(deviceId);
      setDevices(r.devices);
    } catch {
      /* ignore */
    }
  }, [deviceId]);

  const value: RemoteContextValue = {
    deviceId,
    devices,
    isRemote: remoteOn && !!selectedHost,
    selectedHost,
    hostSnapshot,
    hostName,
    lastCommand,
    followerCount,
    hostOffline,
    enable,
    disable,
    sendCommand,
    publishState,
    refreshDevices,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
