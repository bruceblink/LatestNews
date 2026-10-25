# Docker 原生依赖构建修复

日期：2026-10-25。失败基线：`8614166802eb076be54639549f6d4a9fd115ef0b`。

## 失败证据与范围

GitHub Actions 的 `Docker nightly release` 运行 `40134227695`、构建 job `120992378632` 在安装依赖时失败。`better-sqlite3@13.0.3` 在 Node `22.23.4`、Alpine/musl 环境转为源码编译，`node-gyp` 随后报告 `Could not find any Python installation to use`。amd64 任务失败后，arm64 任务被取消。

构建阶段增加 Python 3、make 和 g++；运行阶段只增加 libstdc++。保留冻结锁文件和原生模块安装脚本，不跳过 SQLite 编译。运行镜像构建阶段实际加载最终产物中的 `better-sqlite3`，在内存数据库执行 SQL，防止构建成功但启动缺少原生库。不改变数据库格式、API 或镜像发布目标。

## 验收条件与命令

- 本地 Docker 的 linux/amd64 镜像完成依赖安装和应用构建。
- 镜像启动后，首页和部署健康接口可读；SQLite 实际读写通过，镜像不包含构建工具链。
- linux/arm64 构建单独验证。单架构通过不代表双架构发布通过。
- 记录镜像、端口、启动与清理；不把本地构建写成 GitHub 已修复。

```powershell
docker build --progress plain -t latestnews-docker-fix:local .
docker buildx build --platform linux/arm64 --progress plain --load -t latestnews-docker-fix:arm64 .
```

## 回退边界

撤回 Dockerfile 中的构建工具和运行库安装即可回退。用户数据卷和依赖锁文件不变。远端旧运行不可通过重跑旧提交获得本次修复，必须先让修复进入待构建提交。

## 当前验证记录

- 本地 Docker Desktop `4.89.0`、Engine `29.7.2`，context 为 `desktop-linux`。基础镜像 `node:22-alpine` 的清单摘要为 `sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`，实际 Node 为 `22.23.4`。
- amd64 最终镜像 `latestnews-docker-fix:local` 构建通过，包含运行阶段 SQLite 查询检查。
- 容器 `latestnews-docker-fix-amd64` 监听 `127.0.0.1:18444` 到容器 `4444`。首页、部署健康、节点清单和来源目录均返回 HTTP 200；部署健康的 `cache.status` 为 `ok`。
- 容器内使用最终 `better-sqlite3` 创建磁盘数据库、建表、写入、读取和关闭，结果为 `native-ok`。运行容器不含 Python、make 或 g++。容器已停止并由 `--rm` 删除。
- 首次 arm64 本地构建因模拟器未注册，在 `/bin/sh` 报 `exec format error`。通过 `tonistiigi/binfmt` 注册 `qemu-aarch64` 后，重新执行同一 Dockerfile；最终镜像 `latestnews-docker-fix:arm64` 构建通过，包含 SQLite 运行阶段查询检查。
- arm64 容器 `latestnews-docker-fix-arm64` 使用 `127.0.0.1:18445` 到容器 `4444`。首页、部署健康、节点清单和来源目录均返回 HTTP 200，缓存状态为 `ok`；磁盘 SQLite 写入和读回为 `native-ok`。容器已停止并删除。两个测试镜像随后删除，不删除共享基础镜像或构建缓存。
- `pnpm check`：76 文件、373 测试通过；Electron 类型检查通过。Windows 目录包的 5 个 E2E 用例通过，与 Docker 结果分别记录。
- 修复前的 GitHub 运行已终止，不能据本地结果将其写为成功。
