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

设备断开时 `adb` 会报 `no devices/emulators found`。重新插线或 `adb kill-server && adb start-server`。

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
- 录之前先让目标界面**停在那一屏**，别把导航过程录进去

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

**前提：已经取得用户授权**（见 SKILL.md 的授权表）。

设备上已装的：

```bash
P=$(adb shell pm path <pkg> | head -1 | sed 's/package://' | tr -d '\r')
adb shell ls -la "$P"          # 先看体积，几十 MB 是正常的
adb pull "$P" app.apk
```

拆分 APK（`pm path` 返回多行 `base.apk` + `split_*.apk`）时，资源通常在 `base.apk` 里，
先拉 base 就够；确实找不到资源再拉 split。

设备上没装的：⛔ **不要替用户操作 Google Play 账号**。请用户自己在设备上安装，
装好之后按上面的流程从设备拉取。

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
