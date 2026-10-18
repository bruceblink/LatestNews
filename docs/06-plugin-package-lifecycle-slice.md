# 插件包安装、版本固定与回退切片

日期：2026-10-18。关联计划：[插件平台调研](03-crawler-plugin-platform-research.md)、[动态来源目录切片](05-dynamic-source-registry-slice.md)。

## 范围

- 用静态 JSON 目录列出可安装的可信插件版本，不建设远程市场或安装页面。
- 将包存放到版本目录，并用 `active.json` 原子选择当前版本。
- 为 CLI 增加安装、更新、启用、停用、列出、固定版本、取消固定和回退命令。
- Node 与 Electron 使用同一种版本目录和 `enabled.json` 格式。Node 保留环境变量覆盖；Electron 保留用户数据目录。
- 宿主在执行前验证清单、入口和 `artifact.json` 的 SHA-256。保留现有平铺包读取方式，并允许通过包管理器迁移到版本目录。

## 验收条件

- 本地目录只引用清单内的插件 ID、版本和相对包路径；绝对路径、路径穿越、重复 ID、缺失文件和摘要不匹配均失败。
- 安装先写入临时目录、验证完整包，再切换 `active.json`。打包或写入失败后，旧版本仍可加载。
- 更新会保留上一版本。固定版本后拒绝切换到其他版本；取消固定后可更新；回退后 Node 与 Electron 都读取旧版本。
- `enabled.json` 只保存唯一且格式有效的插件 ID。停用插件后，Node 与 Electron 的动态来源目录都不再包含该插件来源。
- 非版本化的旧插件目录继续可读。旧版配置不清除，迁移失败时继续加载旧目录。
- 完整包校验通过后才能执行插件代码。摘要用于发现损坏，不表示发布者身份已经认证。

## 验证命令

`pnpm crawler validate <plugin-directory>`、`pnpm crawler test <plugin-directory>`、`pnpm test --run`、`pnpm lint:check`、`pnpm typecheck`、`pnpm typecheck:electron`、`pnpm test:crawler:docker`、`pnpm test:crawler:electron`。

新增固定测试覆盖损坏包、路径穿越、未知目录项、版本重复、固定版本、更新失败、回退、停用和旧目录迁移。Docker 与 Electron smoke 使用临时数据目录，并在完成后清理容器、插件包和用户数据。

## 回退边界

每个版本保存在独立目录。回退只切换 `active.json`，不删除插件版本或用户配置。停用插件只修改 `enabled.json`；应用继续通过远程 API 读取来源。若版本目录损坏，宿主拒绝该包并保留上一个活动版本。
