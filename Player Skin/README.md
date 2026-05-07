# Player Skins — Visual Spec Library

This folder is the **source of truth** for the 4 skin styles available on the Music-Station fullscreen "Now Playing" view. Each `skin-NN-<codename>.md` file is a self-contained design spec used to drive (and audit) the UI implementation in `web/src/player/skins/<codename>.tsx`.

When upgrading or extending player UI later, **read the spec first**, then update the code. If a spec change is needed, edit the spec file and propagate.

---

## Skin Roster

| # | Codename | Mood | Source image | Spec file |
|---|---|---|---|---|
| 1 | **`cream`**  | Warm daylight, soft coral, rounded tiles    | `{25A9E6F1-...}.png` | [skin-01-cream.md](./skin-01-cream.md) |
| 2 | **`cosmic`** | Deep-space neon, gradient waveform, ring UI | `{2B7BE580-...}.png` | [skin-02-cosmic.md](./skin-02-cosmic.md) |
| 3 | **`aurora`** | Glassmorphism violet, blurred-cover stage   | `{3A0B600D-...}.png` | [skin-03-aurora.md](./skin-03-aurora.md) |
| 4 | **`abyss`**  | Apple-Music dark blue, premium minimal      | `{EE9E90E1-...}.png` | [skin-04-abyss.md](./skin-04-abyss.md) |

Default skin: **`abyss`** (closest to the existing Music-Station dark vibe).

---

## What's in each spec

Every skin spec covers, in this order:

1. **Color Palette** — every CSS-variable token with hex/rgba and purpose
2. **Background** — base layer, gradients, blur, decorative tints
3. **Album Art** — shape, size, shadow, rotation
4. **Typography** — every text role (title, artist, time, list rows…) with weight/size/spacing/color
5. **Buttons & Shadows** — main play button, prev/next, secondary icons, list-row buttons, with **multi-layer box-shadow** definitions
6. **Progress Bar** — height, fill style, thumb shape
7. **List Rows** — height, active state, separators
8. **Skin-specific Signature** — the one visual element that makes this skin unmistakable
9. **Out-of-scope** — what NOT to do in this skin (avoids drift over time)

---

## How skins map to code

```
Player Skin/skin-NN-<codename>.md  ←  design source of truth (you are here)
                ↓
web/src/player/skins/<codename>.tsx     ←  React component implementing the skin
web/src/player/skins/skins.css          ←  CSS variables for all skins, scoped per .skin-* class
web/src/player/skins/registry.ts        ←  Skin manifest registry
```

User selection persists via `prefs.player_skin` (server-synced through `PrefsContext.tsx`).

---

## Adding a new skin

1. Add a reference image to this folder.
2. Copy `skin-04-abyss.md` as a template, rename to next index, update all sections.
3. Add a manifest entry in `registry.ts`.
4. Create `<codename>.tsx` component following the spec.
5. Add a CSS variable block in `skins.css` under `.skin-<codename> { ... }`.
6. Add a thumbnail swatch in `SkinPicker.tsx`.
