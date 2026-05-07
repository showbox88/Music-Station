# Skin 02 — `cosmic` (Cosmic Neon)

**Codename:** `cosmic`
**Source image:** `{2B7BE580-D942-4933-9C67-3E6667AE2C02}.png`
**Mood:** 赛博、深空、霓虹 — 电子乐 / Synthwave / 80s retro。
**Best for:** EDM / Synthwave / 深夜聆听。

---

## 1. Color Palette

| Token | Value | 用途 |
|---|---|---|
| `--bg-base` | `#11121C` | 主背景，深空藏青 |
| `--bg-panel` | `#1A1B2A` | 右侧曲目列表面板 |
| `--bg-card` | `#1F2033` | 列表行卡片 |
| `--bg-card-active` | `linear-gradient(135deg, #2D1F4A 0%, #4A1F4A 100%)` | 当前播放行高亮 |
| `--accent-magenta` | `#E040C8` | 主洋红 |
| `--accent-violet` | `#7C3AED` | 主紫 |
| `--accent-pink` | `#FF6FB5` | 浅粉过渡色 |
| `--accent-orange-dot` | `#FF9D4D` | 进度环上的小橙圆点（独有装饰） |
| `--ring-gradient` | `conic-gradient(from -90deg, #7C3AED, #E040C8, #FF6FB5, transparent 75%)` | 圆形封面外环进度 |
| `--text` | `#EDEDF7` | 主文字（不是纯白） |
| `--text-muted` | `#9B9CC4` | 副文字（淡紫灰） |
| `--text-faint` | `#5C5E80` | 时间标签 |
| `--hairline` | `rgba(255,255,255,0.06)` | 极弱描边 |

---

## 2. Background

- 主背景纯 `--bg-base`。
- 左半"播放区"和右半"列表区"用 1px hairline 分隔；左右色差极弱（几乎察觉不到）。
- 在播放区中央可叠加一层径向晕：
  ```css
  background:
    radial-gradient(ellipse 60% 40% at 50% 60%,
                    rgba(124,58,237,0.18) 0%,
                    transparent 70%);
  ```

---

## 3. Album Art (Hero)

- **形状**：圆形 (`border-radius: 50%`)。
- **尺寸**：直径 `220px`（mobile `180px`）。
- **外环**：`6px` 厚的 conic-gradient 进度环，已播部分用 `--ring-gradient`，未播部分 `rgba(255,255,255,0.05)`。
- **进度小圆点**（cosmic 的视觉锚）：在已播尾端，`10px` 圆形，`--accent-orange-dot` 填充：
  ```css
  box-shadow: 0 0 8px rgba(255,157,77,0.8),
              0 0 16px rgba(255,157,77,0.4);
  ```
- 内圆封面图片之间留 `4px` 黑色间隙（`background: var(--bg-base)`）形成「黑胶 + 光盘」感。
- 时间 `0:00 / 5:16` 悬浮在外环左右两侧（不在外环上）。
- **不旋转**（图里是静态）。

---

## 4. Waveform Visualizer (signature)

- 圆形封面下方紧跟一个**全宽**的霓虹渐变波形。
- 高度 `100px`。
- 波形线性渐变（横向）：
  ```
  #7C3AED → #E040C8 → #FF6FB5 → #FF9D4D → #FF6FB5 → #E040C8 → #7C3AED
  ```
- 每根 bar 顶部加 `filter: blur(0.5px) drop-shadow(0 0 4px currentColor)`。
- 实现：复用 `<AudioVisualizer>`，新增 `drawCosmicWave()` 函数注册到 viz registry。

---

## 5. Typography

| 角色 | weight | size | spacing | color |
|---|---|---|---|---|
| 主标题 (Mirrors) | 600 | 28px | `0.04em` | `--text` |
| 艺人 | 400 | 14px | `0.02em` | `--text-muted` |
| 列表标题 (Hello) | 700 | 22px | normal | `--text` |
| 列表艺人 | 500 | 13px | normal | `--accent-pink`（高亮行）/ `--text-muted`（其他） |
| 时间 | 500 | 11px tabular-nums | `0.05em` | `--text-faint` |

---

## 6. Buttons & Shadows (重点)

### 主播放按钮 (Mirrors 那个)

- 直径 `60px` 圆形，**双圈**结构：
  - 外圈 `2px` 边框，`linear-gradient(135deg, #7C3AED, #E040C8)`（用 `border-image` 或叠层 `::before`）。
  - 内圈 `52px`，深色 `#181927`。
  - icon：白色三角，14px。
- **发光阴影**（**关键** — 这是 cosmic 的灵魂）：
  ```css
  box-shadow:
    0 0 0 1px rgba(124,58,237,0.4) inset,
    0 0 12px 1px rgba(224,64,200,0.55),     /* 近距离辉光 */
    0 0 32px 4px rgba(124,58,237,0.35),     /* 远距离辉光 */
    0 8px 24px -4px rgba(224,64,200,0.5);   /* 投影 */
  ```
- 按下：内圈背景由 `#181927` 变 `#0E0F1A`，外辉光强度 ×1.3。

### 列表当前行的"暂停"小圆按钮

- 36px 圆形，渐变 `--accent-violet → --accent-magenta`。
- 阴影：
  ```css
  box-shadow:
    0 0 16px rgba(224,64,200,0.5),
    0 4px 12px rgba(0,0,0,0.4);
  ```

### 列表非当前行的"播放"小圆按钮

- 36px 圆形，**只有 1.5px 描边**，颜色 `rgba(255,255,255,0.18)`。
- 内部 icon：白色实心三角。
- 无阴影；hover 时描边变 `--accent-pink`。

### Prev / Next

- 28px 透明，icon stroke 1.75px，颜色 `--text-muted`。
- hover：颜色变 `--accent-pink`，加 `filter: drop-shadow(0 0 4px var(--accent-pink))`。

### Shuffle / Repeat (左右最外侧)

- 22px 透明，颜色更暗 `--text-faint`。
- 激活时（如 shuffle on）：颜色变 `--accent-violet` + 同款 drop-shadow 发光。

### Heart / Download / Share (中间一排)

- 24px，icon stroke 颜色用渐变描边（用 SVG `stroke="url(#cosmicGradient)"`）。
- 这是 cosmic 独有：**图标线条本身就是渐变色**。

---

## 7. Progress Bar

- **不存在传统横条进度** —— 进度通过外环 conic-gradient 表达。
- 这是 cosmic 跟其他三个皮肤最大的结构差异，UI 实现要专门走一条分支。

---

## 8. List Panel (右侧)

- 每行 `72px` 高。
- 当前行：渐变背景 `--bg-card-active`，圆角 14px，**右侧时间标签会被柔光照亮**变成 `#FFB4A0`。
- 非当前行：背景 `--bg-card`，圆角 14px，行间距 8px。
- 缩略图位置左侧 `48×48` 圆角 50%（**圆形**，跟 hero 呼应）。
- 列表无分隔线，靠间距 + 圆角分组。

---

## 9. Skin-specific Signature

- **小橙点**：进度环上的橙色发光小圆，是这个皮肤的视觉锚点 —— 任何动效（拖动 / 自动推进）都要让这个点平滑跟随，**带 6px 拖尾光**。
- **辉光预算**：整个屏幕同时只能有 ≤2 个强发光元素（播放按钮 + 进度橙点 OR 当前行）；其它发光必须降到 ≤30% 强度，避免一片糊。

---

## 10. Out-of-scope

- 不做亮色版本（永远黑）。
- 不允许硬边纯白色 —— 所有"白"必须降到 `#EDEDF7`。
- 不使用扁平无阴影按钮 —— cosmic 必须有发光层。
