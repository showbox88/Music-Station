/**
 * Page-wide drag-drop upload overlay + a manual "Upload" button.
 *
 * Drag any audio file(s) into the browser window → translucent overlay
 * appears → drop → POST /api/upload → on success, parent refreshes the
 * list.
 *
 * Or click the Upload button → file picker → multi-select → upload.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type UploadResponse } from '../api';

interface Props {
  onUploaded: (result: UploadResponse) => void;
}

const SUPPORTED_RE = /\.(mp3|m4a|flac|ogg|opus|wav|aac)$/i;

export default function UploadZone({ onUploaded }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Page-level drag tracking. We use a counter because dragenter/leave fire
  // on every child element transition.
  useEffect(() => {
    let counter = 0;
    function onEnter(e: DragEvent) {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      counter++;
      setDragging(true);
    }
    function onLeave() {
      counter = Math.max(0, counter - 1);
      if (counter === 0) setDragging(false);
    }
    function onDrop() {
      counter = 0;
      setDragging(false);
    }
    function onOver(e: DragEvent) {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    }
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onOver);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onOver);
    };
  }, []);

  async function handleFiles(filesList: FileList | File[] | null) {
    const files = Array.from(filesList ?? []).filter((f) => SUPPORTED_RE.test(f.name));
    if (files.length === 0) {
      setErr('No supported audio files (mp3/m4a/flac/ogg/opus/wav/aac).');
      return;
    }
    setUploading(true);
    setErr(null);
    setProgress({ loaded: 0, total: files.reduce((a, b) => a + b.size, 0) });
    try {
      const result = await api.uploadTracks(files, (loaded, total) =>
        setProgress({ loaded, total }),
      );
      onUploaded(result);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setUploading(false);
      setProgress({ loaded: 0, total: 0 });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  return (
    <>
      {/* Manual upload button (rendered inline by parent via portal-ish slot) */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.aac"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      {uploading ? (
        <UploadProgressPill loaded={progress.loaded} total={progress.total} />
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded-full bezel text-zinc-300 bezel-hover-glow"
        >
          + Upload
        </button>
      )}
      {err && <span className="text-xs text-red-400 ml-2 max-w-xs truncate">{err}</span>}

      {/* Full-page upload-in-progress overlay (separate from the drop
          hover overlay below). Stays up while bytes stream so the user
          sees real progress on a large drop. */}
      {uploading && (
        <div
          className="fixed inset-0 z-40 backdrop-blur-sm flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.55)' }}
        >
          <div
            className="rounded-xl px-8 py-6 bezel min-w-[280px] max-w-[420px]"
            style={{
              boxShadow:
                '0 0 0 1px var(--accent), 0 0 24px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <div className="text-sm font-medium glow-text mb-2">Uploading…</div>
            <UploadProgressBar loaded={progress.loaded} total={progress.total} />
            <div className="flex justify-between text-[11px] text-zinc-400 mt-2 tabular-nums">
              <span>{fmtBytes(progress.loaded)} / {fmtBytes(progress.total)}</span>
              <span>{pct(progress.loaded, progress.total)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Full-page drop overlay */}
      {dragging && (
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="fixed inset-0 z-40 backdrop-blur-sm flex items-center justify-center pointer-events-auto"
          style={{ background: 'rgba(255, 45, 181, 0.15)' }}
        >
          <div
            className="rounded-xl px-12 py-8 text-center bezel"
            style={{
              borderStyle: 'dashed',
              boxShadow:
                '0 0 0 1px var(--accent), 0 0 20px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <div className="text-4xl mb-3 glow-text">⬇</div>
            <div className="text-lg font-medium">Drop audio files to upload</div>
            <div className="text-xs text-zinc-400 mt-1">
              mp3 · m4a · flac · ogg · opus · wav · aac
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function pct(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`;
}

/** Compact in-line progress pill that replaces the Upload button while
 *  bytes are streaming. The magenta fill animates with the byte ratio. */
function UploadProgressPill({ loaded, total }: { loaded: number; total: number }) {
  const p = pct(loaded, total);
  return (
    <div
      className="text-xs px-3 py-1.5 rounded-full bezel relative overflow-hidden min-w-[5.5rem] text-center"
      title={`${fmtBytes(loaded)} / ${fmtBytes(total)}`}
    >
      <div
        className="absolute inset-y-0 left-0 pointer-events-none"
        style={{
          width: `${p}%`,
          background:
            'linear-gradient(90deg, var(--accent) 0%, var(--accent-soft) 100%)',
          opacity: 0.55,
          transition: 'width 0.18s linear',
        }}
      />
      <span className="relative tabular-nums">{p}%</span>
    </div>
  );
}

/** Wide progress bar used inside the full-screen overlay. */
function UploadProgressBar({ loaded, total }: { loaded: number; total: number }) {
  const p = pct(loaded, total);
  return (
    <div
      className="rounded-full overflow-hidden"
      style={{
        height: 8,
        background: 'linear-gradient(180deg, #0a0a0b, #1a1a1c)',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)',
      }}
    >
      <div
        style={{
          width: `${p}%`,
          height: '100%',
          background:
            'linear-gradient(90deg, var(--accent) 0%, var(--accent-soft) 100%)',
          boxShadow: '0 0 8px var(--accent-glow)',
          transition: 'width 0.18s linear',
        }}
      />
    </div>
  );
}
