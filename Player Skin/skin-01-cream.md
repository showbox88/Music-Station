# Skin 01 — `cream` (Cream / Coral Daylight)

**Codename:** `cream`
**Source image:** `{25A9E6F1-F888-4616-A1FA-DAB45A081020}.png`
**Mood:** 友善、温暖、白天感 — Apple Music Light + 一点 fitness app 的活力。
**Best for:** 日间使用、Pop / Indie / 民谣 / 户外播放清单。

---

## 1. Color Palette

| Token | Value | 用途 |
|---|---|---|
| `--bg-base` | `#F4EFE8` | 主背景：暖米白，略带粉调，**不**用纯 `#FFFFFF` |
| `--bg-raised` | `#FFFFFF` | 卡片表面（曲目条、专辑卡） |
| `--bg-recessed` | `#EAE3D9` | 进度条凹槽、排序按钮底 |
| `--surface-tint-warm` | `#FFD9C2` | "正在播放"高亮条的浅色珊瑚 |
| `--accent` | `#FF7A45` | 主珊瑚橙（播放按钮中心） |
| `--accent-strong` | `#FF6125` | 珊瑚橙渐变末端、按钮按压 |
| `--accent-soft` | `#FFC9A8` | 进度条已播部分浅色端 |
| `--accent-glow` | `rgba(255, 122, 69, 0.30)` | 珊瑚阴影色 |
| `--text` | `#1F1A17` | 主文字（不用纯黑） |
| `--text-muted` | `#7A6E64` | 副标题、艺人名 |
| `--text-faint` | `#B5A99C` | 时间、3 点菜单图标 |
| `--hairline` | `rgba(31, 26, 23, 0.06)` | 卡片之间分隔 |
| `--heart-active` | `#FF4D5E` | 心型收藏激活态（偏红比 accent 更鲜） |
| `--list-row-alt` | `#FBF7F0` | 列表斑马纹（极弱） |

---

## 2. Background

- 主层：纯 `--bg-base` 单色（**不**加 noise，**不**加渐变）。
- 顶部状态栏区域：保持同色，无 blur，无半透明。
- **关键**：克制——这个皮肤靠"留白"取胜，不要叠装饰。

---

## 3. Album Art

- **形状**：圆角矩形，`border-radius: 22px`（不是圆形）。
- **尺寸**：占视口宽 78% 左右，正方形。
- **阴影**：双层柔和投影
  ```css
  box-shadow:
    0 2px 8px rgba(31, 26, 23, 0.06),
    0 24px 48px -12px rgba(31, 26, 23, 0.18);
  ```
- **不旋转**，**不加封套黑胶** —— 这个皮肤是静态艺术海报感。
- 角标无装饰。

---

## 4. Typography

| 角色 | font-weight | size | letter-spacing | color |
|---|---|---|---|---|
| 顶部 "NOW PLAYING" | 600 | 11px | `0.18em` UPPERCASE | `--text-muted` |
| 曲目标题 | 700 | 22px | `-0.01em` | `--text` |
| 艺人名 | 500 | 14px | normal | `--text-muted` |
| 时间标签 | 500 | 12px tabular-nums | normal | `--text-faint` |
| 列表行标题 | 600 | 15px | normal | `--text` |

字体：保持系统 sans (`-apple-system, "SF Pro", Inter`)；不引入新字体。

---

## 5. Buttons & Shadows

### 主播放按钮 (中央 ▶)

- 直径 `64px`，完美圆形。
- 渐变：`linear-gradient(135deg, #FF8B5A 0%, #FF6125 100%)`。
- icon：白色填充三角形，14px 边长，光学居中（向右偏 1px）。
- **阴影**（关键，三层堆叠模拟"悬浮"）：
  ```css
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.45) inset,    /* 顶部高光 */
    0 -2px 6px rgba(255, 97, 37, 0.35) inset,   /* 底内阴影聚焦 */
    0 12px 24px -6px rgba(255, 97, 37, 0.55),   /* 主投影 */
    0 4px 8px -2px rgba(255, 97, 37, 0.25);     /* 近距离投影 */
  ```
- hover：投影抬升至 `0 16px 32px -6px`；按下时整体下沉 1px + 投影变 `0 6px 14px`。

### Prev / Next 按钮

- 透明背景，无圆形容器（直接是图标）。
- icon 颜色 `--text`（深色），描线粗 2px，圆头圆角。
- size：`28px`。
- 无阴影，无 hover 背景；hover 时 icon 颜色变 `--accent`。

### 收藏 / 下载 / 分享 (底排小图标)

- 图标 stroke 1.75px、圆头。
- 颜色 `--text-muted`，激活态切换为 `--heart-active`（心）或 `--accent`。
- 无背景容器，无阴影。

### 列表中的"加号"小圆按钮 (右侧下载)

- 24px 圆形，背景 `#FFFFFF`，1px hairline 边框 `--hairline`。
- 阴影：`0 1px 2px rgba(31,26,23,0.06)`。
- icon：`+` 或 `→↓` 用 `--accent`。

---

## 6. Progress Bar

- 高度 3px（细）。
- 凹槽底 `--bg-recessed`。
- 已播放：`linear-gradient(90deg, var(--accent-soft) 0%, var(--accent) 100%)`。
- 拖动 thumb：`12px` 圆形，白色填充，1px 边框 `--accent`，阴影 `0 2px 6px rgba(255,97,37,0.35)`。
- 时间标签放在进度条**正下方**两侧（左 0:00，右 总时长，**不显示倒数**）。

---

## 7. List Rows ("Up next" / Album track list)

- 每行高 `64px`，左侧 `48×48` 圆角 12px 缩略图，右侧 3 点菜单。
- 当前播放行：背景 `--surface-tint-warm`，圆角 12px 整行包裹，文字保持深色。
- 非当前行：透明背景，悬停 `rgba(31, 26, 23, 0.04)`。
- 行间距：4px，**没有**水平分隔线。

---

## 8. Tab / Section Header

- "Up next ▾" 这种章节标题：`font-weight: 700; size: 28px; color: var(--text)`。
- 右侧操作按钮（sort / queue 切换）：32px 圆形白底 + hairline + 内嵌 icon。

---

## 9. Skin-specific Signature

- **Hero 卡片**：在曲目标题下、控制条上有一段 `min-height: 8px` 的留白 —— 这是这套皮肤的呼吸感来源。
- **没有任何霓虹光晕** —— 整套皮肤投影只用暖灰 + 半透明珊瑚，避免发光感。

---

## 10. Out-of-scope

- 不做暗色降级（cream 永远是 light）。
- 不做毛玻璃 / backdrop-filter。
- 不在文字、按钮上使用 `text-shadow` 或 `filter: drop-shadow` 来模拟发光。
