# ROADMAP

按价值排序的待办。每条都对应 README「Known limitations」里的一项。

## 1. 跨案例验证（最高优先）⭐

整套流程和八条坑都是从**一次**拆解里提炼的，没在别的 App 上验证过。
最能暴露问题的做法：**拿它去实拆一个全新的 App**，全程记录哪里不顺、哪个脚本给了错结论。

重点观察：
- `apk_assets.py` 的屏幕分类正则在命名不规范 / 混淆的 App 上会不会失效
- `SKILL.md` 的五步流程在「没有真机」「只有网页」「iOS 产品」这几种情况下够不够用
- 有没有出现新的坑（一旦出现就补进 `references/pitfalls.md`）

## 2. 触发准确性评测

`SKILL.md` 的 `description` 是凭感觉写的，没测过。
`skill-creator` 有现成的优化循环：

```bash
cd ~/.claude/skills/skill-creator
python -m scripts.run_loop \
  --eval-set <trigger-eval.json> \
  --skill-path ~/competitor-ui-teardown \
  --model <当前会话的 model id> \
  --max-iterations 5 --verbose
```

需要先准备 20 条评测 query（8–10 条应触发 + 8–10 条不应触发，**近似案例最有价值**，
比如「帮我设计一个登录页」应该**不**触发，「分析下别人家登录页怎么做的」应该触发）。

## 3. iOS 支持

当前完全不支持 —— 非越狱设备拿不到 IPA，资源清单这一步在 iOS 上直接缺失。
可做的替代路径：
- 录屏 + 截图分析仍然有效（`frame_diff.py` / `image_probe.py`）
- 调研 `ipatool` 之类的公开工具是否可行、是否合规
- 至少在 SKILL.md 里**明确告诉用户 iOS 只能做到哪一步**，避免碰壁

## 4. 自动推荐 --crop

现在要用户自己截图量坐标。可以先扫一遍录屏，**找出全程不变化的区域**（固定 UI），
自动推荐动效区域的 crop 参数。

## 5. 区域对比度

`image_probe.py --contrast` 现在拿全图极值比，对「文字只出现在某一块」的情况过于悲观。
加一个 `--region WxH+X+Y`，只在指定区域内取极值。

## 6. split APK

`pm path` 返回多个 apk 时，现在只能手工挑 base。可以自动合并多个包的资源清单。

## 7. 回归样本

两个 bug（HLS 饱和度劫持、阈值写死）都是靠手工比对发现的。
应该固化几个样本 + 期望输出，改动后能一键回归。
