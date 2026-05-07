# Skin 05 — `vinyl` (The Original)

**Codename:** `vinyl`
**Source:** the original Music-Station player UI before the skin refactor (commit `5a4575f`).
**Mood:** 复古黑胶、霓虹紫红、舞台聚光 —— turntable + glow。
**Best for:** 默认皮肤、所有曲风通用。

---

## 1. Color Palette

这套皮肤复用 `web/src/index.css` 的全局 token，**不**在 skin 容器内重新定义变量：

| Global token | Hex / value | 用途 |
|---|---|---|
| `--bg-base` | `#1c1c1e` | 默认深灰底（被本皮肤的 radial gradient 覆盖） |
| `--bg-recessed` | `#0d0d0e` | 进度条凹槽 |
| `--accent` | `#ff2db5` | 主洋红 |
| `--accent-soft` | `#ff66cc` | 渐变末端 |
| `--accent-glow` | `rgba(255, 45, 181, 0.55)` | 辉光阴影 |
| `--accent-glow-strong` | `rgba(255, 45, 181, 0.85)` | 强辉光 |
| `--text` | `#f4f4f5` | 主文字 |
| `--text-muted` | `#71717a` | 副文字 |

主背景：`radial-gradient(ellipse at 50% 0%, #2a1620 0%, #0d0d0e 60%), #0d0d0e`。

---

## 2. Background

- **底层**：上述 radial gradient —— 顶部偏酒红 `#2a1620`，中段渐入近黑 `#0d0d0e`。
- **顶部装饰**：固定位置 SVG `<Wave>` 元素，洋红双层波形，opacity 0.18 + stroke 1.5px，宽 100%，高 64px，从顶部 `top-12` 起绘。pointer-events 关闭（不挡点击）。

---

## 3. Album Art (Hero)

- **形状**：**圆形黑胶唱片** + 实拍封面贴在中央 label 区域。
- **尺寸**：`width: min(50vw, 300px)`，正方形比例。
- **结构**：
  - 外缘黑胶：`radial-gradient(circle at 30% 30%, #2a2a35 0%, #0d0d14 60%, #050507 100%)`，带 4 层 `inset` 同心圆 hairline 唱纹。
  - 中央 label：`28% inset`，`44% × 44%`，紫色环边 `box-shadow: 0 0 0 6px #1a0d35, 0 0 0 7px rgba(255,255,255,0.15)`。
  - 中央 spindle：12px 紫色圆 `#2d1466`。
- **旋转动画**：`@keyframes mw-spin 8s linear infinite`，播放时 running、暂停时 paused。
- **唱臂 (Tonearm)**：详细 SVG，pivot 在右上角，counterweight + 拾音头 + cartridge + 红宝石针尖（针尖发光 `--accent`）。播放时 `rotate(0)`、暂停时 `rotate(-18deg)`，700ms 缓动。

---

## 4. Visualizer / Lyrics 区

唱片下方一块 `min-h-{120px mobile, 200px desktop}` 区域，可在以下两态切换：

- **wave 模式**：渲染 `<AudioVisualizer>` 共享组件，复用 `prefs.viz_style`（用户的全局 viz 选择会被尊重）。
- **lyrics 模式**：渲染 `<LyricsPanel mode="inline">`，可点右上角 `Expand / Shrink` 让歌词区吃掉唱片区，腾出更多行高度。

切换按钮 `LRC ⇄ Wave` 浮在区域左上，用 `bezel` 圆角胶囊样式。

---

## 5. Typography

| 角色 | weight | size | color |
|---|---|---|---|
| 顶部专辑名 (`t.album`) | 500 | 16px | `#FFFFFF` |
| 顶部副标题 (`artist · year`) | 400 | 11px | `text-purple-200/70` |
| 曲目标题 | 500 | 24px | `var(--text)` + `glow-text` (洋红 text-shadow) |
| 艺人 | 400 | 14px | `text-zinc-400` |
| 时间标签 | 500 | 11px tabular | `text-zinc-500` —— 右侧用 **倒数** `-3:01` |

---

## 6. Buttons & Shadows (重点)

### 主播放按钮

- 56px 圆形，class `play-btn` （`web/src/index.css` 内）。
- 背景：洋红→粉的渐变 + 内层 inset highlight + 多层 magenta drop-shadow。
- 这是整套皮肤的视觉锚点。

### Prev / Next / Shuffle / Repeat / Heart / Add

- 32px / 40px 圆形 `bezel` 容器（也是 index.css 已有的共享类）：凸起金属感按钮，1px 黑色 hairline + 顶部 inset 白光。
- 激活态用 `glow-text glow-ring` 组合：图标变 magenta + 容器外加洋红 halo box-shadow。
- 收藏激活：心型 `#ff2db5`，box-shadow 双层洋红辉光。

### EQ / DOLBY / Lyrics 顶栏按钮

- 24px 高 + 横向 padding 的小胶囊 `bezel`，内含 10px 字体 uppercase 字母（DOLBY / EQ）或 12px icon（lyrics 麦克风）。
- 激活：`glow-text glow-ring`。

### 切换 LRC ⇄ Wave 浮按钮

- 极小胶囊 `bezel`，10px 文字。
- 浮在 viz 区左上角 `top-2 left-2`。

---

## 7. Progress Bar

- height 4px、凹槽 `#0a0a0b → #1a1a1c` 渐变。
- 已播：`var(--accent) → var(--accent-soft)` 横向渐变。
- 阴影：`inset 0 1px 2px rgba(0,0,0,0.8), 0 0 8px var(--accent-glow)`。
- 时间标签：左 `0:00`，右 **倒数**（`-3:01`）。

---

## 8. Volume Slider

只在 desktop (`md:` 及以上) 显示，phone 用硬件音量键。
- 同款 4px 高度，洋红渐变填充。
- 左侧 mute 按钮（VolumeIcon level 0/1/2 三态），右侧百分比文字 `tabular-nums`。

---

## 9. Skin-specific Signature

- **黑胶 + 唱臂 + 旋转动画** —— 这套皮肤无可替代的视觉语言。
- **洋红辉光预算**：play 按钮 / 进度条 / 标题 / 激活态按钮都共用 `--accent-glow`，整体形成统一的紫红色舞台光感。

---

## 10. Out-of-scope

- 不做亮色版本。
- 不做扁平按钮 —— 所有按钮必须用 `bezel` 凸起、`recess-pill` 凹陷或 `play-btn` 强辉光中的一种。
- 不修改 `web/src/index.css` 的全局 token —— vinyl 直接复用，其它 4 个皮肤在自己的 `.skin-*` scope 内覆写。
