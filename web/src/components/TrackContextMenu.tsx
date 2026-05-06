/**
 * Right-click context menu for track rows. Each action callback is optional —
 * pass only what the calling view supports and the item is hidden when absent.
 */
import { useEffect, useRef } from 'react';

interface Props {
  anchor: { x: number; y: number };
  onClose: () => void;
  onPlay: () => void;
  onEdit?: () => void;
  onAddToPlaylist?: () => void;
  onDelete?: () => void;
}

export default function TrackContextMenu({
  anchor,
  onClose,
  onPlay,
  onEdit,
  onAddToPlaylist,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    const id = setTimeout(() => window.addEventListener('pointerdown', onPointer), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  const MENU_W = 180;
  const MENU_H = 160; // rough estimate
  const left = Math.min(anchor.x, window.innerWidth - MENU_W - 8);
  const top = Math.min(anchor.y, window.innerHeight - MENU_H - 8);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 70,
        width: MENU_W,
        background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
        border: '1px solid #050506',
        boxShadow:
          '0 12px 32px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 16px rgba(255,45,181,0.06)',
      }}
      className="rounded-lg overflow-hidden py-1"
    >
      <MenuItem icon="▶" label="播放" onClick={() => { onPlay(); onClose(); }} />

      {onAddToPlaylist && (
        <MenuItem
          icon="+"
          label="加入播放列表"
          onClick={() => { onClose(); onAddToPlaylist(); }}
        />
      )}

      {onEdit && (
        <MenuItem icon="✎" label="歌曲信息" onClick={() => { onEdit(); onClose(); }} />
      )}

      {onDelete && (
        <>
          <div className="my-1 border-t border-black/50" />
          <MenuItem
            icon="✕"
            label="删除"
            danger
            onClick={() => { onDelete(); onClose(); }}
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left ${
        danger ? 'text-red-400 hover:bg-red-950/40' : 'text-zinc-200 hover:bg-white/[0.06]'
      }`}
    >
      <span className="w-4 text-center opacity-60 text-xs">{icon}</span>
      {label}
    </button>
  );
}
