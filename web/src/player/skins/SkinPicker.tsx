import { useEffect, useRef, useState } from 'react';
import { SKINS } from './registry';
import type { SkinId } from './types';

interface Props {
  current: SkinId;
  onPick: (id: SkinId) => void;
}

/**
 * Small palette button that opens a popover with the four skin swatches.
 * Lives at the top-right of every NowPlayingView regardless of skin.
 */
export default function SkinPicker({ current, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Choose skin"
        className="w-8 h-8 rounded-full flex items-center justify-center text-current opacity-70 hover:opacity-100"
        style={{
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.16)',
        }}
      >
        {/* palette icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r="1.5" />
          <circle cx="17.5" cy="10.5" r="1.5" />
          <circle cx="8.5" cy="7.5" r="1.5" />
          <circle cx="6.5" cy="12.5" r="1.5" />
          <path d="M12 22a10 10 0 1 1 10-10c0 2.21-1.79 3-3 3h-2a2 2 0 0 0-2 2v2c0 1.66-1.34 3-3 3z" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 z-50 rounded-xl p-3 shadow-2xl"
          style={{
            background: '#16161B',
            border: '1px solid rgba(255,255,255,0.10)',
            width: 220,
            color: '#EDEDF7',
          }}
        >
          <div className="text-[11px] uppercase tracking-wider mb-2 opacity-60">Player skin</div>
          <div className="flex flex-col gap-2">
            {SKINS.map((s) => {
              const active = s.id === current;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    onPick(s.id);
                    setOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-lg p-2 text-left transition-colors"
                  style={{
                    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                    outline: active ? '1px solid rgba(255,255,255,0.18)' : 'none',
                  }}
                >
                  <span
                    aria-hidden
                    className="shrink-0 rounded-md"
                    style={{
                      width: 36,
                      height: 36,
                      background: s.swatch.bg,
                      boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.06), 0 0 0 2px ${s.swatch.accent}33`,
                      position: 'relative',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        right: 4,
                        bottom: 4,
                        width: 10,
                        height: 10,
                        borderRadius: 9999,
                        background: s.swatch.accent,
                      }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">{s.name}</span>
                    <span className="block text-[11px] opacity-70 truncate">{s.tagline}</span>
                  </span>
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
