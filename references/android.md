# Android 真机与安装包操作

只在需要具体命令时读这份。`adb` 需要在 PATH 上，设备要开启 USB 调试。

## 设备

```bash
adb devices -l                       # 有设备且状态是 device 才能继续
adb shell pm list packages -3        # 只看三方应用（系统应用噪音太大）
adb shell pm list packages -3 | grep -i <关键词>
```

**共用设备先看占用**，别把别人正在跑的东西挤掉：

```bash
adb shell ps -A | grep -iE '<pkg1>|<pkg2>'
adb shell dumpsys activity activities | grep -m1 topResumedActivity
```

设备断开时先检查连接与授权。共用设备环境不要直接重启 adb server，以免中断其他会话。

## 截图与录屏

```bash
adb exec-out screencap -p > shot.png                    # 截图（exec-out 不会有换行污染）
adb shell screenrecord --time-limit 12 --bit-rate 12000000 /sdcard/rec.mp4
adb pull /sdcard/rec.mp4 .
adb shell rm /sdcard/rec.mp4                            # 用完清掉，别留在别人设备上
```

录屏注意：
- `--time-limit` 最大 180 秒，但拆解动效 **8–15 秒足够**，太长反而难分析
- 循环类动效至少要录到**两个完整周期**，否则算不出周期长度
- 稳态录制先停在目标屏；入场动效必须先起录再冷启动，两种样本分开记录。

## 启动与导航

```bash
adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1   # 启动
adb shell input keyevent KEYCODE_BACK                             # 返回
adb shell input tap <x> <y>                                       # 点击
adb shell input swipe <x1> <y1> <x2> <y2> <ms>                    # 滑动
```

⚠️ 在**别人的账号**里操作要克制：可以看、可以返回，⛔ 不要点会产生数据的按钮
（开始录音、发送、购买、删除）。拆解设计不需要改对方的数据。

## 取安装包

设备上已安装的包可只读拉取；从公开渠道下载免费安装包须先取得授权并核版本。禁止操作商店账号。
先列出全部路径，包与中间素材保存在仓库外：

```bash
adb shell pm path <pkg>
# 对输出中的每条 package: 路径逐条执行（去掉 package: 前缀）
adb pull '<完整路径>' '<仓库外分析目录>/'
```

功能/技术调研传入每个已取得 APK，报告实际覆盖的包。视觉分析可先看 base，
目标素材缺失时继续检查 split；单体 APK 的原生库也可以位于 base。

设备没有安装时，可由用户自行安装，或授权后从公开渠道取得免费包，按 SKILL.md 核验版本与来源。

## 读安装包

```bash
python3 scripts/apk_assets.py app.apk                      # 清单 + 按屏分组
python3 scripts/apk_assets.py app.apk --screen login
python3 scripts/apk_assets.py app.apk --min-kb 100         # 只看大件
python3 scripts/apk_assets.py app.apk --extract login bg   # 提取到 ./out
```

也可以直接用 `unzip`：

```bash
unzip -l app.apk | grep -iE 'login|signin' | sort -rn -k1
unzip -o -j app.apk "path/in/apk/*.jpg" -d ./probe
```

常见资源布局：

| 技术栈 | 资源位置 |
|---|---|
| Flutter | `assets/flutter_assets/...`，第三方包在 `packages/<pkg>/assets/` |
| React Native | `assets/`、`res/drawable-*/`（名字常被打平成 `src_assets_images_xxx`） |
| 原生 Android | `res/drawable-*/`、`res/mipmap-*/`、`assets/` |

看到 `res/drawable-mdpi-v4/src_assets_images_...` 这种打平命名，基本可以判断是 React Native。

## 网页产品

网页不需要 APK，直接看：

```bash
curl -s <url> | grep -oE 'background[^;]*'      # 粗看
```

更实际的是用浏览器开发者工具或浏览器自动化工具取计算样式和资源清单。
背景渐变往往直接写在 CSS 里 —— 那就是现成的规格，不用反推。

## 清理

拆解完把中间产物清掉，别让竞品安装包和素材散在项目里：

```bash
rm -rf ./out ./probe app.apk
```

需要长期留存的**只有你自己做的分析图**（拼图、曲线、对照），
放进归档目录并配一个 README 写明来源与「仅供分析、禁止用作素材」。

## 可选静态分析

设备暂不可用但已有合法 APK 时，可先运行 [apk_profile](apk-analysis.md) 并按 [代码追踪流程](code-tracing.md) 阅读自制或授权样本。工具不会自动取包；实时表现仍需设备证据。
