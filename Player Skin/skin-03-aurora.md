# Skin 03 — `aurora` (Aurora Glass)

**Codename:** `aurora`
**Source image:** `{3A0B600D-2D01-4245-9F05-277540B27644}.png`
**Mood:** 梦幻、艺术家肖像感、玻璃拟态、舞台聚光。
**Best for:** R&B / Pop ballad / Indie，氛围聆听。

---

## 1. Color Palette

| Token | Value | 用途 |
|---|---|---|
| `--bg-base` | `#0F0A1F` | 底色（深紫黑） |
| `--bg-tint-top` | `#3B2A66` | 顶部紫雾 |
| `--bg-tint-mid` | `#1F1640` | 中部过渡 |
| `--accent` | `#9B6BFF` | 主紫 |
| `--accent-soft` | `#C7A8FF` | 浅紫 |
| `--accent-glow` | `rgba(155,107,255,0.45)` | 辉光基色 |
| `--glass-fill` | `rgba(255, 255, 255, 0.06)` | 玻璃面板填充 |
| `--glass-border` | `rgba(255, 255, 255, 0.10)` | 玻璃边 |
| `--glass-highlight` | `rgba(255, 255, 255, 0.18)` | 玻璃顶高光 |
| `--text` | `#F2EEFF` | 主文字 |
| `--text-muted` | `#B6AAD6` | 副文字 |
| `--text-faint` | `#7A6FA0` | 极弱文字 |
| `--lyric-current` | `#FFFFFF` | 当前歌词 |
| `--lyric-other` | `rgba(242,238,255,0.38)` | 其它歌词 |

---

## 2. Background (signature 玻璃拟态)

**底层** —— 当前曲目封面被放大 `120%`，应用：
```css
filter: blur(60px) saturate(1.4) brightness(0.55);
```
铺满整个视口。

**覆盖层 1** —— 纵向渐变，加暗下半部分：
```css
background: linear-gradient(180deg,
  rgba(15,10,31,0.20) 0%,
  rgba(15,10,31,0.85) 100%);
```

**覆盖层 2** —— 顶部柔光：
```css
background: radial-gradient(ellipse 80% 50% at 50% 0%,
  rgba(155,107,255,0.35) 0%,
  transparent 60%);
```

当封面切换时，背景做 600ms 交叉淡入淡出。

**关键**：背景必须随当前曲目变化 —— 这是 aurora 的核心。如果某曲目没封面，则 fallback 到固定紫色 noise 背景。

---

## 3. Album Art (Hero)

- **形状**：圆形（**不是**正方形）。
- **尺寸**：直径 `200px`。
- **外环**：`2px` 半透明白边 `rgba(255,255,255,0.18)`。
- **辉光 halo**：
  ```css
  box-shadow:
    0 0 60px 8px rgba(155,107,255,0.35),
    0 20px 40px rgba(0,0,0,0.5);
  ```
- 居中略微偏上（垂直 35% 处）。

---

## 4. Typography

| 角色 | weight | size | color |
|---|---|---|---|
| 标题 (Attention) | 700 | 26px | `--text` + `text-shadow: 0 2px 12px rgba(0,0,0,0.6)` |
| 艺人 (Charlie Puth) | 500 | 14px | `--text-muted` |
| 时间 | 500 | 11px | `--text-faint` |
| 当前歌词 | 700 | 22px | `--lyric-current` + `text-shadow: 0 2px 16px rgba(155,107,255,0.5)` |
| 其它歌词 | 500 | 18px | `--lyric-other` |

字体仍用系统 sans。

---

## 5. Buttons & Shadows

### 主播放按钮

- 56px 圆形。
- 背景：`linear-gradient(135deg, #B68EFF 0%, #7A4DFF 100%)`。
- icon：白色三角 13px。
- 阴影：
  ```css
  box-shadow:
    0 1px 0 rgba(255,255,255,0.35) inset,
    0 0 24px 2px rgba(155,107,255,0.55),
    0 12px 32px -8px rgba(122,77,255,0.6),
    0 6px 12px -2px rgba(0,0,0,0.45);
  ```
- **不像 cosmic 那么强烈的霓虹** —— 更柔，像聚光灯下的玻璃球。

### Prev / Next / Shuffle / Repeat

- 32px 透明圆形容器。
- 容器背景：`--glass-fill`（玻璃感）。
- 容器边：1px `--glass-border`。
- 容器顶部 `1px` 高光：`linear-gradient(180deg, var(--glass-highlight) 0%, transparent 30%)` 用 `::before` 实现。
- icon：白色，stroke 1.75px。
- **整个容器**：`backdrop-filter: blur(12px) saturate(1.2)`。

### Heart (顶部左侧)

- 28px 圆形玻璃容器，规格同上。
- 激活时心形填充 `--accent-soft`，加 `filter: drop-shadow(0 0 6px var(--accent-glow))`。

### Share (顶部右侧)

- 同 Heart，但永远只描边。

### 底部 Tab Bar (Lyrics / 等)

- 整条底栏是一块玻璃面板：
  ```css
  background: rgba(255,255,255,0.04);
  backdrop-filter: blur(20px) saturate(1.3);
  border-top: 1px solid rgba(255,255,255,0.08);
  ```
- "Lyrics" 文字按钮：选中时下方 2px 紫色短下划线 `--accent`，无背景。

---

## 6. Progress Bar

- 高度 `2px`（极细）。
- 凹槽：`rgba(255,255,255,0.10)`。
- 已播：纯 `--accent-soft`，**无渐变** —— 这皮肤靠背景渐变就够了。
- thumb：`10px` 白色圆点 + `0 0 10px var(--accent-glow)`，hover 时放大到 12px。

---

## 7. Lyrics View (sub-mode)

aurora 必须支持「沉浸歌词模式」（图 3 的右屏）：

- 隐藏顶部 Hero 封面 + 控制按钮变小贴底。
- 居中歌词列表，每行间距 24px。
- 当前行 22px 白色加阴影；前后 2 行 18px 38% 透明度；再往外淡出。
- 顶部小区域显示曲目封面 1/4 大小 + 标题。

---

## 8. Skin-specific Signature

- **背景必须随封面变化** —— 这是 aurora 的灵魂。
- **所有装饰元素必须有 `backdrop-filter: blur(...)`** —— 任何卡片、按钮容器都要透出底下的封面色。

---

## 9. Out-of-scope

- 不支持低性能设备的 fallback —— `backdrop-filter` 必须开启（macOS/iOS 现代浏览器都支持）。
- 不做亮色版本。
- 不使用平面无 backdrop 的容器。
