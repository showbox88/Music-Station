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
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="text-xs px-3 py-1.5 rounded-full bezel glow-text glow-ring disabled:opacity-50"
      >
        {uploading ? `${Math.round((progress.loaded / Math.max(1, progress.total)) * 100)}%` : '+ Upload'}
      </button>
      {err && <span className="text-xs text-red-400 ml-2 max-w-xs truncate">{err}</span>}

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
