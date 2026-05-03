/**
 * 5-star rating control. Click n-th star → sets rating to n.
 * Click already-set star → clears (sets 0). Hover preview.
 */
import { useState } from 'react';

interface Props {
  value: number;            // 0..5
  onChange?: (v: number) => void;   // omit → read-only
  size?: 'sm' | 'md';
}

export default function StarRating({ value, onChange, size = 'sm' }: Props) {
  const [hover, setHover] = useState(0);
  const display = hover || value;
  const cls = size === 'md' ? 'text-base' : 'text-xs';
  const readonly = !onChange;

  return (
    <span className={`inline-flex ${cls} ${readonly ? '' : 'cursor-pointer'}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onMouseEnter={readonly ? undefined : () => setHover(n)}
          onMouseLeave={readonly ? undefined : () => setHover(0)}
          onClick={
            readonly
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  onChange?.(value === n ? 0 : n);
                }
          }
          className={`px-px ${
            n <= display ? 'glow-text' : 'text-zinc-700 hover:text-zinc-500'
          }`}
        >
          ★
        </span>
      ))}
    </span>
  );
}
