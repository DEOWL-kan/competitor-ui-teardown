# APK 基础画像

`apk_profile.py` 对每个输入包记录 SHA-256、大小、DEX/资源/ABI 路径，不提取 ZIP，不下载或合并 split。可选调用已安装的 apkanalyzer 获取 Manifest、DEX 类树、资源包、字符串配置和默认字符串名。其余资源类型和值未自动解码。

```sh
python3 scripts/preflight.py --android-static
python3 scripts/apk_profile.py /scratch/base.apk /scratch/feature.apk --expected /scratch/pm-path.txt --json /scratch/new-profile.json
python3 scripts/apk_profile.py /scratch/base.apk --no-tools
```

`--expected` 接收每行文件名或已保存的 `pm path` 输出。它只能比对文件名：重复 basename 标为歧义，未拉取 split 列 missing；没有预期清单则集合完整性未知。匹配清单也不涵盖之后才下载的动态模块。包名/versionCode 或已知 versionName 冲突单独报告，不合并解释。

Manifest 的权限表示声明，exported 缺省为 unresolved，intent-filter 不证明设备上可达。Flutter/RN 采用多个文件线索，允许混合，仍不证明某 UI 使用了该栈。哈希不是官方正版证明，签名核验未执行。

可选命令使用参数数组、20 秒超时、8 MiB 保留输出限制。工具失败/超时/截断不会删除 ZIP 画像；查看每条 command/status，不能只看进程退出 0。超大 ZIP 声明跳过工具。目录扫描不做 CRC 全量验证，损坏条目可能由后续工具才发现。输出 JSON 必须是仓库外的新文件，权限 0600；包含包内字符串的材料仍须人工隐私检查。

工具来源与边界：[Android 官方 apkanalyzer 文档](https://developer.android.com/tools/apkanalyzer)。工具路径、启动脚本哈希、SDK source.properties（可取得时）随结果保存；不把不支持的 `--version` 帮助输出误写为版本号。

自制二进制 Manifest/DEX 样本的构建与静态追踪见 [Android fixture](../examples/android-fixture/README.md)。无真机时只交静态结论，运行路径为 SKIP。
