/**
 * Small cover thumbnail. Falls back to a music note emoji on missing or error.
 *
 * Server returns cover URLs as `/api/covers/<file>` (relative to backend
 * root). In production the app is mounted at `/app/`, so we need to prefix
 * BASE_URL minus its trailing slash, yielding `/app/api/covers/<file>`,
 * which Tailscale routes to music-station and strips `/app` → backend
 * static serves from /api/covers/. In dev BASE_URL is `/` and the prefix
 * collapses, so vite proxy /api still works.
 */
import { useState } from 'react';

function resolveSrc(src: string | null): string | null {
  if (!src) return null;
  if (/^https?:/i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (src.startsWith('/')) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    return `${base}${src}`;
  }
  return src;
}

interface Props {
  src: string | null;
  size?: number;        // px square
  className?: string;
  alt?: string;
}

export default function CoverThumb({ src, size = 36, className = '', alt = '' }: Props) {
  const [errored, setErrored] = useState(false);
  const resolved = resolveSrc(src);
  const showImg = resolved && !errored;
  const dim = `${size}px`;

  return (
    <div
      className={`shrink-0 rounded bg-zinc-800 flex items-center justify-center overflow-hidden ${className}`}
      style={{ width: dim, height: dim }}
    >
      {showImg ? (
        <img
          src={resolved}
          alt={alt}
          loading="lazy"
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
          style={{ width: dim, height: dim }}
        />
      ) : (
        <span className="text-zinc-600" style={{ fontSize: Math.round(size * 0.5) }}>
          ♪
        </span>
      )}
    </div>
  );
}
