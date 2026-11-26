# N1-D：v0.9.0 正式发布资产验收（2026-11-26）

## 基线

[正式 Release](https://github.com/bruceblink/LatestNews/releases/tag/v0.9.0)，ID 458385650，2026-11-25 16:58:51 UTC，immutable=true。tag 对象 17c19225dda69e88f0c7c9bd94d3bb8def8b4ecd，剥离后提交 baacb5d292dc0bf23467f2c2b98171d402695fca。开发基线 e28c15d。正式包不含 #33 及后续修复，验收不代表最新主线。只读下载、隔离校验、提取运行；不改 Release、标签、镜像、生产库或部署，不提交安装包及测试证书。

[机器可读证据](n1d-v0.9.0-release-2026-11-26.json)。

## 资产

| 项目 | 结果 |
| --- | --- |
| GitHub 资产 | 18/18 实际下载，共 1,138,699,189 字节；大小与 SHA-256 全匹配 |
| SHA256SUMS.txt | 17 项非自身资产，完整、无重复、全部匹配 |
| 四份 latest*.yml | 版本 0.9.0，8 个引用文件的 SHA-512 与大小通过 |
| blockmap | 发布 verifier 要求的 exe/zip blockmap 存在、SHA-256 匹配；差分升级未运行 |
| fallback | path/sha512 与 files[0] 一致 |
| deb | latestnews-desktop 0.9.0；amd64 与 arm64 |
| Web.zip | LICENSE、LICENSE.md、LICENSES、output/server/index.mjs 存在 |

复用发布提交自身的 verify-update-assets.mjs，在临时副本重新生成 SHA256SUMS.txt，与下载原件逐字节相同。四份清单为 latest.yml、latest-mac.yml、latest-linux.yml、latest-linux-arm64.yml。

**签名边界：** 同源摘要不是独立签名认证。两个 Windows NSIS 外层 EXE 的 PE 证书目录为空；外层 PE Machine 为 0x14c，不据此判断安装后的架构。macOS ZIP 无可见 Contents/_CodeSignature/CodeResources，不据此断言没有 Mach-O 内嵌签名。未执行原生签名/Gatekeeper 检查、证书链或 notarization 验证。

## Docker

[源工作流 45649085476](https://github.com/bruceblink/LatestNews/actions/runs/45649085476) 的五个桌面构建、Web 和源码验证通过，原 Publish GitHub Release 失败。恢复发布没有生成新镜像；[源 Docker 作业](https://github.com/bruceblink/LatestNews/actions/runs/45649085476/job/139580897026) 后续状态 success，日志于 2026-11-25 23:31:57 UTC 推送 0.9.0 清单，晚于 Release 发布。区别历史恢复说明与后续状态。

ghcr.io/bruceblink/latestnews:0.9.0 的 OCI index 实际字节摘要为 sha256:e290639e2e89619d13db3f7c8021c265cf7a3c5cd4eef58100061eacc06ff6d1，与源作业日志一致。linux/amd64、linux/arm64 的 manifest 与 config 按摘要获取并复算；两个 revision 均为 baacb5d，version 0.9.0，各 13 个 layer 描述。两个 attestation-manifest 描述符未验证签名或 provenance。无 Docker/Podman，未下载完整 layers 或运行镜像。

## 正式包运行

- Web.zip 提取实际发布 output，Node 22.23.4，独立目录、HOST=127.0.0.1、ENABLE_CACHE=true、INIT_TABLE=true。首页及目录成功，60 个来源；health 显示 app 0.9.0、cache ok、articleIndex ok、pending/untracked=0。来源未采集，整体健康 degraded（idle）。历史搜索 status=ok、LIKE 空结果，SIGTERM 正常关闭。未访问真实上游或生产存储。
- 已校验的 amd64.deb 使用 dpkg-deb -x，不执行系统安装或 maintainer script。Linux x64/Xvfb 启动实际发布程序：isPackaged=true、version=0.9.0、窗口数 1。临时 HOME 生成本地 CA 和 NSS 信任库，仅回环 HTTPS。真实界面显示合成新闻标题，来源目录/洞察/健康正常请求；IPC 改用回环 HTTP 被拒绝，原 HTTPS 配置不变，观察到的 pageerror 为 0，正常关闭。
- 固化为 scripts/performance/published-linux-https-smoke.ts，使用相同发布二进制复测通过。独立 HOME/profile/XDG runtime，Chromium 外部请求由拒绝代理和 DNS 规则限制，不传开发凭据、不忽略证书错误。隔离环境显式使用 --no-sandbox，不是生产 sandbox 验收。临时 CA、私钥和 profile 在 finally 清理，不改用户或系统信任存储。

## 复现

1. 下载每项正式资产到独立目录，按 GitHub API digest 和大小逐个核验。执行 sha256sum -c SHA256SUMS.txt，核对集合覆盖所有非自身资产。临时副本调用发布提交的 verifyUpdateAssets，version=0.9.0、expectedMetadata 为四份清单，生成清单与下载原件 cmp。不要覆盖原件。
2. Web ZIP 提取后，从隔离目录运行 HOST=127.0.0.1 PORT=18499 ENABLE_CACHE=true INIT_TABLE=true node /path/to/extracted/output/server/index.mjs，访问 /、/api/v1/sources、/api/v1/health/deployment、/api/v1/articles/search?q=fixture。停止服务并清理测试目录。
3. Linux 只运行已验证资产。需要 Node 22、pnpm、Playwright 依赖、OpenSSL、NSS certutil 与显示环境。若无 certutil，可将发行版 libnss3-tools deb 提取到隔离目录，不执行系统安装。dpkg-deb -x 后：

```sh
xvfb-run --auto-servernum pnpm exec tsx --tsconfig tsconfig.node.json \
  scripts/performance/published-linux-https-smoke.ts \
  --executable /path/to/extracted/opt/LatestNews/latestnews-desktop \
  --version 0.9.0 --certutil /path/to/certutil
```

仅当隔离宿主不支持 Chromium sandbox 时显式添加 --no-sandbox。脚本不承担下载或签名验证，必须先完成摘要检查。

## 剩余验收

公开资产完整性、Web 启动、Linux amd64 提取包 HTTPS 启动与 OCI 清单核验完成。真实安装/卸载/升级/回滚、AppImage 集成、Linux ARM64、Windows/macOS、托盘/原生最小化、离线读取、签名与 Docker 双架构运行仍开放。不修改不可变 Release、不擅自发布新版本。N4-P3 正式 1800 秒、N4-N 双端长测、独立人工质量复核、目标 D1 仍独立验收；N2-D1/D2/D3 延后。

回归：653/653 Vitest（117 文件）、lint、Node/Web/Electron 类型检查通过。此次仅新增隔离验收工具、报告与计划；未重新构建或修改正式资产。
