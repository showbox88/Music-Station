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
  size?: number;        // px square; ignored when `fluid` is true
  className?: string;
  alt?: string;
  /** Fill 100% of the parent container instead of using `size`. Used by
   *  the card-mode track grid where cell width is layout-driven. */
  fluid?: boolean;
}

export default function CoverThumb({
  src,
  size = 36,
  className = '',
  alt = '',
  fluid = false,
}: Props) {
  const [errored, setErrored] = useState(false);
  const resolved = resolveSrc(src);
  const showImg = resolved && !errored;
  const dim = `${size}px`;
  const containerStyle: React.CSSProperties = fluid
    ? { width: '100%', height: '100%' }
    : { width: dim, height: dim };
  const imgStyle: React.CSSProperties = fluid ? {} : { width: dim, height: dim };
  const fallbackFontSize: string = fluid
    ? '40%'
    : `${Math.round(size * 0.5)}px`;

  return (
    <div
      className={`${fluid ? '' : 'shrink-0 rounded'} bg-zinc-800 flex items-center justify-center overflow-hidden ${className}`}
      style={containerStyle}
    >
      {showImg ? (
        <img
          src={resolved}
          alt={alt}
          loading="lazy"
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
          style={imgStyle}
        />
      ) : (
        <span className="text-zinc-600" style={{ fontSize: fallbackFontSize }}>
          ♪
        </span>
      )}
    </div>
  );
}
