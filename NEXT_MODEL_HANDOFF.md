# Next Model Handoff

更新时间：2026-09-18  
项目目录：`/Users/yangshikun/Documents/ChatGPT/Mogo Demo`  
当前分支：`codex/docker-demo-kit`  
文档创建前的代码基线：`6a157b2`

本文档是继续执行本项目时应优先阅读的单一上下文入口。它不包含密码、Token、SSH 私钥或 MongoDB URI。

## 当前运行状态

云服务器：`47.119.130.230`

当前使用云服务器原有服务，不使用刚才构建的 Docker TapData：

| 服务 | 端口 | 状态 | 已验证 |
| --- | ---: | --- | --- |
| 原有 MongoDB | `27017` | 运行中 | `tapdata_casino_marketing` 有 23 个集合 |
| 原有 TapData 管理端 | `3030` | 运行中 | 端口监听；未登录请求返回 401 |
| 原有 TapData API Server | `3080` | 运行中 | `/actuator/health` 返回 200，状态 `UP` |
| 原有 AI 面板 | `3000` | 运行中 | `/` 与 `/api/data/patrons` 返回 200 |

Docker 容器已停止，Docker 卷、旧服务数据和代码没有删除。旧 MongoDB 是直接启动的，因此旧版 `tapdata status` 可能不显示 MongoDB PID。旧 API Server 的重复启动进程已经清理，目前只保留一个监听 `3080` 的进程。

SSH 入口：

```bash
ssh -i ~/Downloads/skeet-20260818.pem root@47.119.130.230
```

不要在命令输出、Markdown、Git 或聊天消息中写入密码、Token、完整 MongoDB URI 或私钥内容。

## 已完成的代码工作

分支 `codex/docker-demo-kit` 已推送到远端，最近提交包括：

- `6a157b2`：独立运行 TapData API Server 容器，不依赖 TapData 容器内的 API 进程。
- `00ad8cc`：自动完成 TapData 导入后的连接、任务和 API 后处理。
- `38f444e`：自动导入 TapData 任务和 API 模块。
- `f600474`：恢复私有源库并完成云端回归准备。

历史 Docker 回归曾验证：任务导入、连接健康、初始同步、CDC、API 发布和 `/api/v1/...` 调用均可工作。详细历史结果见 [云服务器备份与回归报告.md](云服务器备份与回归报告.md)。

## 当前方案已经改变

后续不再把 TapData 作为一键 Docker 部署内容。目标架构是：

1. 外部人员提供 TapData 管理端 URL、API Server URL 和认证信息。
2. 自动化程序先做只读预检查：版本、连通性、认证、导入接口和 MongoDB 可达性。
3. 使用对方 MongoDB 的完整连接信息创建或更新 Source 连接。
4. 导入或更新 CDC 任务，替换 Source/Target 连接。
5. 导入 API 模块并发布。
6. 验证任务健康、CDC 状态、API definition 和 `/api/v1/...` 数据接口。
7. 只有在配置允许时才自动启动 CDC。

新的自动化程序必须把 TapData 作为外部依赖，不能依赖本机旧版 API Server，也不能把凭据写入导出文件或日志。

## 已确认的业务约束

1. 对方提供的是空 MongoDB；恢复到固定源库 `tapdata_casino_marketing`，使用之前定义的数据库名和 23 个集合。
2. 只导入现有的那个 CDC 单任务：`TapData_CDC_Patron_Table_Sessions_To_MongoDB`。已检查导出文件，这个单任务的 DAG 本身包含 23 个 Source→MDM 集合映射，不需要拆成 23 个任务。
3. Target 连接必须指向 MDM 数据库，当前约定名称为 `marketing_mdm`。CDC 数据落到 MDM 后，API 才能从该库发布。
4. 自动化程序必须先确认 MDM 中 23 个 API 目标集合已经存在且有数据，再发布 API。
5. 重复执行按同名对象自动更新任务和 API，不生成重复对象；默认不删除不同名对象。

## 仍需提供或确认

1. **TapData 端点和认证**：需要完整管理端 URL、API Server URL、TapData 版本/版本类型，以及 API Token 或明确的登录认证方式。仅提供 `3030` 前端地址和一个 API 端口不足以执行自动导入。
2. **MongoDB 连接参数**：需要 Source 和 MDM Target 的完整 URI，或 host、port、username、password、authSource、replicaSet、directConnection 等字段。密码不单独写入聊天或文档。
3. **启动策略**：是否在 MDM 23 个集合验证和 API 发布后自动启动 CDC；未确认前保持 `AUTO_START_CDC=false`。
4. **网络位置**：如果对方 MongoDB 只监听 `127.0.0.1`，导入程序需要在同机执行或使用 SSH 隧道。

当前 API 样例包原始包含 23 个模块；历史管理端有 20 个进入 `active` 列表，另外 3 个必须在新企业版中核对后才能报告为发布成功。

## 推荐的安全执行顺序

```text
read-only preflight
→ 确认版本、认证、MongoDB 和 23 个集合
→ 生成导入计划（不写数据）
→ 创建或更新连接
→ 导入/更新 CDC 任务
→ 导入并发布 API 模块
→ 检查任务与 API 健康
→ 可选：启动 CDC
→ 可选：执行一条受控源数据变更验证 CDC
```

默认禁止：删除集合、覆盖源库、删除旧任务、把密码写入 Git、把外部 MongoDB 暴露到公网、未经确认自动启动不属于当前任务的 CDC。

## 重要文件

- `scripts/tapdata-import.mjs`：TapData 导入及后处理逻辑。
- `scripts/demo-docker.sh`：历史 Docker 部署入口；当前新方案不应默认启动 TapData。
- `docker-compose.demo.yml`：历史 Docker 编排，除非用户重新启用 Docker 方案，不要启动它。
- `deploy/tapdata/README.md`：导入文件说明。
- `项目交接与部署状态.md`：较完整的本地交接记录，顶部“当前上下文（权威）”有效，下面章节部分是历史记录。
- `云服务器备份与回归报告.md`：历史 Docker 云端回归记录，不代表当前云服务器正在运行 Docker 栈。

## 给下一模型的第一步

先阅读本文件和 `项目交接与部署状态.md` 顶部，不要先启动 Docker 或停止云服务器旧服务。然后向用户收集上面 7 项中缺失的配置；收到配置后先实现只读 preflight，再执行导入和回归测试。任何密钥只能通过服务器私有环境变量或密钥文件提供。
