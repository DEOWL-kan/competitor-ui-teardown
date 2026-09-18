# 拆解网页产品

**网页比 App 好拆得多**，而且很多人没意识到这一点：样式是明文的。
App 的规格要从像素反推，网页的规格可以**直接读出来** —— 不用猜时长、不用取色、不用量间距。

所以拆网页时，⛔ 不要一上来就截图分析像素。先把明文的拿走。

## 一、直接读规格

用浏览器自动化或开发者工具执行下面这些。拿到的是**作者写的原值**，不是你的估计值。

### 背景是怎么做的

```js
const el = document.querySelector('<选择器>');
const s = getComputedStyle(el);
({
  background: s.backgroundImage,      // 渐变的完整定义，直接可抄
  color: s.backgroundColor,
  filter: s.filter,
  backdropFilter: s.backdropFilter,   // 毛玻璃就在这
  mixBlendMode: s.mixBlendMode,
  boxShadow: s.boxShadow,
})
```

`backgroundImage` 里如果是 `radial-gradient(...)`，那就是**完整的光斑规格**：位置、尺寸、色标全在里面。
App 那边要靠降采样网格反推的东西，这里是白送的。

### 动效的真实参数

```js
// 页面上所有正在跑的动画，连时长和曲线一起
document.getAnimations().map(a => ({
  name: a.animationName || a.transitionProperty,
  duration: a.effect?.getTiming().duration,
  easing:   a.effect?.getTiming().easing,
  delay:    a.effect?.getTiming().delay,
  iterations: a.effect?.getTiming().iterations,
  target: a.effect?.target?.className,
}))
```

这一条能直接给出「2700ms / cubic-bezier(.2,.8,.2,1) / infinite」这种精确到能照抄的结果。
⛔ 别再去录屏算帧差分了 —— 那是 App 才需要的迂回手段。

### 字体与排版尺度

```js
[...document.querySelectorAll('h1,h2,h3,p,button,a')].map(e => {
  const s = getComputedStyle(e);
  return `${e.tagName} ${s.fontSize}/${s.lineHeight} w${s.fontWeight} ls${s.letterSpacing} ${s.fontFamily.split(',')[0]}`;
}).filter((v,i,a) => a.indexOf(v) === i)   // 去重，得到的就是这个页面的字阶表
```

### 设计变量（如果对方用了 CSS 变量）

```js
const r = getComputedStyle(document.documentElement);
[...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules] } catch { return [] } })
  .flatMap(rule => rule.style ? [...rule.style] : [])
  .filter(p => p.startsWith('--'))
  .filter((v,i,a) => a.indexOf(v) === i)
  .map(v => `${v}: ${r.getPropertyValue(v).trim()}`)
```

用了设计系统的站点，这一步**等于直接拿到对方的 design token 表**。

## 二、资源清单

对应 App 那边的 `apk_assets.py`。看资源类型能立刻判断「背景是视频还是图」：

```js
performance.getEntriesByType('resource')
  .filter(r => /\.(png|jpe?g|webp|avif|mp4|webm|svg|woff2?|json)/.test(r.name))
  .map(r => ({ url: r.name.split('/').pop(), kb: Math.round(r.transferSize/1024), type: r.initiatorType }))
  .sort((a,b) => b.kb - a.kb)
  .slice(0, 30)
```

也可以离线看：

```bash
curl -s <url> | grep -oE 'src="[^"]+\.(mp4|webm|png|jpg|webp)"' | sort -u
```

⚠️ 现代站点大量用懒加载和 CDN 转换（`?w=800&fmt=webp`），首屏清单未必完整 —— 滚动一遍再取。

## 三、什么时候还是要测像素

明文读不到的情况：

- 背景是**一张图**而不是渐变 → 下载那张图，用 `image_probe.py` 分析（有没有颗粒、光斑在哪）
- 效果来自 **canvas / WebGL / video** → 只能录屏，用 `frame_diff.py` 量节奏
- 关键视觉被**打包进图片**（很多营销页把整块内容做成图）

判断方法很简单：`backgroundImage` 是 `url(...)` 就是图，是 `linear/radial-gradient(...)` 就是代码画的。

## 四、⚠️ 网页特有的坑

**别把概念稿当成发行产品。** 设计社区（Dribbble、Behance）上的漂亮登录页，很多是
**没有工程约束的概念图** —— 没有真实文案长度、没有多语言、没有加载态、没有错误态、
没有无障碍要求。照着它做，到实现阶段会发现处处不成立。

判断依据：能不能**在真实域名上打开并交互**。不能，就只当情绪板，⛔ 不当规格来源。

**响应式会改变结论。** 你在 1440px 宽看到的布局，可能和移动端完全是两套。
拆解前先明确要拆哪个断点，`resize` 之后重新取一遍计算样式。

**深色模式同理。** 取色前先确认当前处于哪个模式，两套值都要取。

**首屏和滚动后不是一回事。** 很多动效是 `IntersectionObserver` 触发的，
不滚动就取不到 —— `getAnimations()` 在动画没开始时返回不了它。

## 五、边界

网页的样式是公开可见的，读取计算样式没有额外的授权问题。但结论一样：

- 借鉴**机制**（渐变结构、动效曲线、字阶比例）✅
- 复制**素材**（图片、字体文件、插画、文案）⛔
- 整页克隆 ⛔

拿到 `cubic-bezier(.2,.8,.2,1)` 这种参数不构成抄袭 —— 它是物理规律级别的通用值。
把对方的英雄图下载下来用，是另一回事。
