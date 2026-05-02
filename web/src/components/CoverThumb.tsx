/**
 * Small cover thumbnail. Falls back to a music note emoji on missing or error.
 */
import { useState } from 'react';

interface Props {
  src: string | null;
  size?: number;        // px square
  className?: string;
  alt?: string;
}

export default function CoverThumb({ src, size = 36, className = '', alt = '' }: Props) {
  const [errored, setErrored] = useState(false);
  const showImg = src && !errored;
  const dim = `${size}px`;

  return (
    <div
      className={`shrink-0 rounded bg-zinc-800 flex items-center justify-center overflow-hidden ${className}`}
      style={{ width: dim, height: dim }}
    >
      {showImg ? (
        <img
          src={src}
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
