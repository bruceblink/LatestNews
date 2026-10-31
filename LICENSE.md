# LatestNews 开源协议说明

本文件说明 `LatestNews` 自有代码的模块化开源协议范围。完整条款见
[`LICENSES/GPL-3.0-only.txt`](./LICENSES/GPL-3.0-only.txt) 和
[`LICENSES/AGPL-3.0-only.txt`](./LICENSES/AGPL-3.0-only.txt)。

## 许可范围

本项目采用按模块组合的许可方式。同一份代码不同时标记为 GPLv3 和 AGPLv3。

| 路径或组件 | SPDX 标识 | 适用范围 |
| --- | --- | --- |
| `src/`、`shared/` | `GPL-3.0-only` | Web/PWA 客户端、Electron 渲染端和客户端共享层 |
| `electron/` | `GPL-3.0-only` | Electron 主进程、预加载脚本和桌面端适配代码 |
| `crawler-platform/` | `GPL-3.0-only` | 桌面端和 Node 端使用的插件 SDK、运行时及内置插件工具 |
| `public/`、`build/` | `GPL-3.0-only` | 项目自有的 Web、PWA 和桌面资源 |
| `server/`、`vite-nitro.ts` | `AGPL-3.0-only` | Node/Nitro API、数据源采集、数据库、服务端中间件和服务端构建入口 |
| `Dockerfile`、`docker-compose*.yml`、`example.env.server` | `AGPL-3.0-only` | 服务端部署和运行配置 |
| 未列出的测试、脚本、构建配置和项目文档 | `GPL-3.0-only` | 项目自有的开发辅助代码和说明；文件另有声明时以文件声明为准 |

表中更具体的路径优先于最后一行的默认范围。

服务端会使用 `shared/` 中的共享代码。独立使用共享层或客户端代码时，适用
GPLv3-only；将其与服务端组合部署时，必须同时保留 GPLv3 和 AGPLv3 的版权、许可
与免责声明，并按照 AGPLv3 的要求提供对应源代码。Electron 桌面包不包含 `server/`
运行时，因此按 GPLv3-only 交付。

## 许可证文件和发布产物

- `LICENSE.md` 是范围索引，不是对 GPLv3 或 AGPLv3 条款的改写。
- `LICENSES/` 保存完整的官方许可证文本。
- Web 部署包、Docker 运行镜像和 Electron 安装包应携带许可索引与完整文本。
- `package.json` 使用 `SEE LICENSE IN LICENSE.md`，避免把整个多模块仓库误标为单一许可证。

## 第三方代码、内容和商标

第三方依赖继续适用各自的许可证。数据源网站的文章、图标、名称、商标和接口内容
不因本项目使用它们而获得 GPLv3 或 AGPLv3 授权。文件中的第三方版权声明和许可证
优先于本说明。

项目 README 对 `ourongxing/newsnow` 的引用是项目思路来源说明，不表示本仓库可以
删除或替换该项目及其他第三方代码的原始许可和版权声明。

## 贡献

贡献者提交到 `src/`、`shared/`、`electron/` 和 `crawler-platform/` 的代码按
GPLv3-only 提交；提交到 `server/` 或服务端部署配置的代码按 AGPLv3-only 提交。
一次贡献同时修改多个范围时，各文件保留对应许可。

本说明用于记录项目的许可范围，不构成针对具体使用场景的法律意见。使用、修改或
再发布前，请阅读对应的完整许可证文本并保留必要的版权和许可声明。
