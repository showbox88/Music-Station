/**
 * Monochrome line icons used across the player UI.
 *
 * Stroke uses currentColor so callers control color via `text-*` classes
 * (white when inactive, magenta when active via .glow-text). No fills,
 * no platform emoji — keeps the look consistent with the bezel buttons.
 */
import type { SVGProps } from 'react';

const baseProps: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function RepeatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" {...baseProps} {...props}>
      <path d="M17 2l3 3-3 3" />
      <path d="M3 11V9a4 4 0 0 1 4-4h13" />
      <path d="M7 22l-3-3 3-3" />
      <path d="M21 13v2a4 4 0 0 1-4 4H4" />
    </svg>
  );
}

export function RepeatOneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" {...baseProps} {...props}>
      <path d="M17 2l3 3-3 3" />
      <path d="M3 11V9a4 4 0 0 1 4-4h13" />
      <path d="M7 22l-3-3 3-3" />
      <path d="M21 13v2a4 4 0 0 1-4 4H4" />
      <text
        x="12"
        y="14.5"
        textAnchor="middle"
        fontSize="6"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        1
      </text>
    </svg>
  );
}

export function ShuffleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" {...baseProps} {...props}>
      <polyline points="16 3 21 3 21 8" />
      <path d="M4 20L21 3" />
      <polyline points="21 16 21 21 16 21" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
    </svg>
  );
}

export function VolumeIcon({ level, ...props }: { level: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" {...baseProps} {...props}>
      {/* Speaker body */}
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      {/* Sound waves — show 0/1/2 based on level */}
      {level === 0 && (
        <>
          <path d="M16 9l5 6" />
          <path d="M21 9l-5 6" />
        </>
      )}
      {level >= 1 && level < 2 && <path d="M16 9a4 4 0 0 1 0 6" />}
      {level >= 2 && (
        <>
          <path d="M16 9a4 4 0 0 1 0 6" />
          <path d="M19 6a8 8 0 0 1 0 12" />
        </>
      )}
    </svg>
  );
}
