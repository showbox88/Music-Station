import type { SkinId, SkinManifest } from './types';

/**
 * Source of truth for the available skins. Order here = order shown in
 * the picker. Specs in `Player Skin/skin-NN-<codename>.md` (repo root).
 */
export const SKINS: SkinManifest[] = [
  {
    id: 'vinyl',
    name: 'Vinyl',
    tagline: 'The original — magenta glow + spinning record.',
    swatch: { bg: '#0d0d0e', accent: '#FF2DB5' },
  },
  {
    id: 'abyss',
    name: 'Abyss',
    tagline: 'Apple-Music dark blue. Premium minimal.',
    swatch: { bg: '#0A1525', accent: '#FFFFFF' },
  },
  {
    id: 'cosmic',
    name: 'Cosmic',
    tagline: 'Deep-space neon waveform.',
    swatch: { bg: '#11121C', accent: '#E040C8' },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    tagline: 'Glassmorphism violet stage.',
    swatch: { bg: '#1F1640', accent: '#9B6BFF' },
  },
  {
    id: 'cream',
    name: 'Cream',
    tagline: 'Warm daylight, soft coral.',
    swatch: { bg: '#F4EFE8', accent: '#FF6125' },
  },
];

export const DEFAULT_SKIN: SkinId = 'vinyl';

export function isSkinId(value: unknown): value is SkinId {
  return (
    value === 'vinyl' ||
    value === 'cream' ||
    value === 'cosmic' ||
    value === 'aurora' ||
    value === 'abyss'
  );
}
