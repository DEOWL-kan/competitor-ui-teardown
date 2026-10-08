# Web 页面与功能取证

先明确要拆的区域、视口、主题和功能状态。Web 实测属于 `[浏览器]`；公开帮助属于 `[公开资料]`，两者不能替代。
深度和报告结构遵循 [research-workflow.md](research-workflow.md)。

## 当前可执行能力：页面快照

`scripts/web_probe.js` 是浏览器原生脚本。通过允许执行自有脚本的浏览器工具或开发者工具加载后运行：

```js
webProbe({selector: '#target', maxElements: 200})
```

返回 JSON 可序列化对象：

- 采集时间、视口、DPR、滚动位置、语言和系统配色偏好。
- 指定区域的元素矩形、计算样式、可读 CSS 自定义属性和伪元素样式。
- 被采元素的可见动画状态、整体 timing 及 keyframes 的分段 easing。
- 当前页面 Resource Timing 清单，最多 200 项；超出元素/资源上限会明确标记。
- 无匹配、无效参数、iframe/封闭 shadow root 等覆盖说明。

`getComputedStyle` 返回解析后的值，不等于作者源码。CSS 变量只是已采元素上浏览器暴露的变量；不是完整 design token 表。每个元素/伪元素的 CSS 变量最多保留 64 项，variables_total 和 variables_truncated 记录总量与截断；需要某个未采变量时另行定向读取。
探针遍历开放 shadow root；不进入 iframe，不宣称识别封闭 shadow root。默认 maxElements=200，最大 10000；只对目标区域运行。
固定截图由浏览器工具保存，再与快照时间和状态绑定；探针不自行截图或点击。

不采输入值与 textContent，URL 去掉 query/hash/凭据；但元素 ID、URL 路径、CSS 图片地址或变量仍可能含敏感内容。
原始产物保存在仓库外，公开前人工复核；这不是自动完整脱敏工具。

## 功能与网络：不能用资源清单替代抓包

探针没有请求方法、请求头/正文、完整响应、WebSocket 帧或 SSE 事件。
Resource Timing 的 0 大小可能来自缓存或访问限制；条目也可能已被浏览器缓冲淘汰。
页面没有新条目不证明无网络交互，更不证明本地计算或应用缓存。

完整功能研究应记录：入口/前置、输入/校验、触发规则、加载/成功/空/失败/取消、边界、并发/恢复和联动。
操作前开始观察，保存 baseline→动作→等待目标状态→after；比较操作、请求和 UI，区分时间相关与因果证据。
可选实时后端见 [tools/web-capture](../tools/web-capture/README.md)：隔离的 Playwright/Chromium 记录 HTTP、重定向、传输失败与正文状态，并通过 CDP 记录 WebSocket 帧及原生 EventSource 消息。页面探针继续只负责静态快照。

操作记录包含前后快照、时间窗口及候选请求。先使用 `demo.mjs` 验证搜索/分页、表单和流式自制样本，再按授权研究真实目标。输出必须在仓库外；各引擎正文/跨 target 覆盖以 manifest 为准：Chromium 可直接读取受限的解码正文与 Worker/OOPIF 流事件；Firefox/WebKit 无 CDP 原生 SSE。文件正文、任意 fetch 流及早期 popup 等仍有限制。
报告将入口、输入、触发、状态、数据流、边界与联动逐项写明，示例见 [功能卡](../examples/web/feature-report.md)。`check_report.py --capture` 可核对 HTTP 会话/请求/动作/正文状态，不能证明因果关系。

## 读实现与测像素如何分工

公开脚本与 source map 的定向阅读见 [web-code-tracing.md](web-code-tracing.md)。
参数可读时先读，再回到画面验证。canvas/WebGL/video 或不可读动画可以录屏、抽帧和帧差分，注明采样限制。
`backgroundImage` 的 URL 不一定是静态图，也可能是 SVG；样式声明不能独自证明绘制机制或实际资源用途。
动画可能在滚动/点击后才出现；一次空 `getAnimations()` 不能证明没有动画。

## 自制样本验证

从仓库根启动仅监听本机的静态服务：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8765/references/web-validation.html`。
预期页面显示 PASS，覆盖尺寸、样式、伪元素、开放 shadow root、关键帧 easing、iframe 提示、截断和无效输入。
删除 keyframes 采集后应显示 FAIL: keyframe easing retained；恢复后重新 PASS。
这是真值已知的本地页面测试，不代表真实网站和各种浏览器已全部验收。

## 比较与边界

响应式、深色模式、滚动与加载状态分别采样；不同条件的值不能拼成一个不存在的页面。
只把真实可访问产品当作发行参考；概念稿用于方向，不作实现规格证据。
只观察任务授权的正常交互，不按发现的端点主动探测/重放。借鉴机制，不能把竞品素材、脚本或原始日志提交仓库。
