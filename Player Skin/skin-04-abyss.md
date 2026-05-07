# Skin 04 — `abyss` (Apple-Music Dark Blue)

**Codename:** `abyss`
**Source image:** `{EE9E90E1-4331-4985-8214-DF199334581B}.png`
**Mood:** 极简、克制、premium —— 类似 Apple Music dark。
**Best for:** 通用、Hip-Hop / Electronic / Rock。

---

## 1. Color Palette

| Token | Value | 用途 |
|---|---|---|
| `--bg-base` | `#0A1525` | 主背景：极深的蓝调黑 |
| `--bg-tint` | `#0E2240` | 顶部柔光 |
| `--bg-bottom` | `#05080F` | 底部加深 |
| `--bg-card` | `#16223A` | 列表卡片 |
| `--accent-blue` | `#5AA8FF` | 主蓝（按钮、播放图标可选） |
| `--accent-mute` | `#3D5878` | 弱化的蓝灰 |
| `--accent-play-bg` | `#FFFFFF` | 主播放按钮背景：纯白 |
| `--accent-play-icon` | `#0A1525` | 主播放按钮内 icon 色 |
| `--shuffle-blue` | `#4A6CFF` | "Shuffle" 按钮专用蓝 |
| `--play-green` | `#1FD86E` | "Play" 按钮专用绿（专辑页用） |
| `--text` | `#FFFFFF` | 主文字（这皮肤可以用纯白） |
| `--text-muted` | `#8FA3BD` | 副文字 |
| `--text-faint` | `#506580` | 时间 / 占位 |
| `--hairline` | `rgba(255,255,255,0.08)` | 卡片描边 |

---

## 2. Background

- 纵向渐变：
  ```css
  background: linear-gradient(180deg,
    #0E2240 0%,
    #0A1525 35%,
    #05080F 100%);
  ```
- 顶部 60% 高度叠一层舞台顶光：
  ```css
  background: radial-gradient(ellipse 100% 50% at 50% 0%,
    rgba(90,168,255,0.10),
    transparent 70%);
  ```
- 不加 noise，不加 blur 装饰。

---

## 3. Album Art (Hero)

- **形状**：圆角矩形，`border-radius: 16px`。
- **尺寸**：占视口宽 70%，正方形。
- **阴影**（**关键** —— 这皮肤最重要的细节）：
  ```css
  box-shadow:
    0 4px 8px rgba(0,0,0,0.30),
    0 32px 64px -16px rgba(0,0,0,0.60),
    0 0 80px -20px rgba(90,168,255,0.20);  /* 极淡的蓝色辉光，模拟舞台 */
  ```
- 不旋转，不加边框。

---

## 4. Typography

| 角色 | weight | size | spacing | color |
|---|---|---|---|---|
| 标题 (ROCKSTAR.) | 700 | 22px | `0.01em` | `--text` |
| 艺人 (roddy ricch) | 500 | 14px | normal | `--text-muted` |
| "Top Tracks" / 区段标题 | 700 | 20px | `0.01em` | `--text` |
| 列表行标题 | 600 | 15px | normal | `--text` |
| 列表艺人 | 500 | 13px | normal | `--text-muted` |
| 时间 | 500 | 11px tabular-nums | normal | `--text-faint` |

---

## 5. Buttons & Shadows

### 主播放按钮 (中央)

- **不是彩色** —— 是 **纯白圆形**！这是 abyss 跟其他皮肤的最大差异。
- 直径 `56px`，背景 `#FFFFFF`。
- icon：`--accent-play-icon`（深蓝黑）填充三角，13px。
- 阴影（克制）：
  ```css
  box-shadow:
    0 2px 6px rgba(0,0,0,0.30),
    0 8px 20px -4px rgba(255,255,255,0.10);
  ```
- 按下：背景变 `#E8E8E8`，阴影减半。

### Prev / Next

- 28px 透明，icon 纯白 `--text`，stroke 1.5px。
- 无背景，无阴影。

### Shuffle / Repeat

- 22px 透明，icon `--text-muted`。
- 激活时变白 + 下方加 1px 白色小圆点（dot indicator）。

### Heart / 三点菜单 (右上)

- 28px 透明，icon `--text-muted`，无容器。
- 心形激活：变 `--accent-blue`（**不是红色** —— 这皮肤的 highlight 全用蓝）。

### 专辑页 "Play" / "Shuffle" 按钮

- 高 36px，圆角 8px，flex 内含 icon + 文字。
- "Play"：背景 `--play-green`，文字白色。
  - 阴影：`0 2px 6px rgba(31,216,110,0.25)`。
- "Shuffle"：背景 `--shuffle-blue`，文字白色。
  - 阴影：`0 2px 6px rgba(74,108,255,0.25)`。
- 两个按钮宽度等分占满容器，间距 8px。

### 底部 "Lyrics" 按钮

- 透明文字按钮，无背景，font-weight 600。
- 选中态：上方 2px 高度的白色圆角短指示条（24px 宽），居中对齐。

---

## 6. Progress Bar

- 高度 `4px`，圆角 2px。
- 凹槽：`rgba(255,255,255,0.12)`。
- 已播：纯白。
- thumb：`12px` 圆形纯白，无边框，阴影 `0 1px 4px rgba(0,0,0,0.4)`。
- 时间标签**居于进度条下方两侧**，左侧已用秒数，右侧 **倒数（`-3:01` 这种）** —— 这是 Apple Music 风格的细节。

---

## 7. Volume Slider (新元素)

abyss 在底部加一条音量条（其他皮肤可选；abyss 必须有）：

- 长度占视口宽 60%，居中。
- 左右两侧各一个小喇叭 icon (`8px` / `14px`)，颜色 `--text-faint`。
- 滑条样式同进度条但更细 (2px)。

---

## 8. List Rows (Top Tracks)

- 每行高 `60px`，左侧 `48×48` 圆角 8px 缩略图，左对齐。
- 行号显示在缩略图**左侧**（`1`, `2`, `3`），颜色 `--text-faint`。
- 当前行：缩略图叠加播放波形 icon（白色），背景**不变色** —— 只靠缩略图覆盖图示状态。
- 行间距 4px，无分隔线。

---

## 9. Skin-specific Signature

- **白色播放按钮 + 倒数时间** 是这套皮肤辨识度。
- **彩色出现得极克制** —— 只有 Play(绿) / Shuffle(蓝) / favorite-active(蓝) 三个地方。其它一律灰阶。

---

## 10. Out-of-scope

- 不支持亮色降级。
- 不做玻璃拟态 / backdrop-filter。
- 不在主播放按钮上使用渐变 —— 必须保持纯白。
