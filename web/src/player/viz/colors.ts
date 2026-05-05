/** Hue mapped to bar index, for rainbow-style strips. */
export function rainbowColor(t: number, alpha = 1): string {
  const hue = (t * 300 + 280) % 360;
  return `hsla(${hue}, 95%, 60%, ${alpha})`;
}

/** Amplitude → HSL string. v in 0..1.
 *  Hue rotates 320° → 60° going clockwise through red/orange. */
export function ampColor(v: number, alpha = 1): string {
  const hue = (320 + v * 100) % 360;
  const sat = 95;
  const light = 50 + v * 12;
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}
