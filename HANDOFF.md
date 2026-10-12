# 赌场 Demo 项目交接文档

更新时间：2026-10-12

这份文档用于把赌场 Customer 360 Demo 交给同事，包含代码版本、部署入口、数据链路、造数脚本和运行注意事项。

## 1. 当前代码版本

- Git 仓库：`https://github.com/tapdata/casino-customer360-ai-dashboard.git`
- 交付分支：`codex/docker-demo-kit`
- 最新提交：`0860b79 feat: simplify customer one-click deployment`
- 工作区状态：干净，没有未提交代码
- 本地分支与远端分支：一致

当前完整 Demo 在 `codex/docker-demo-kit`，不是默认的 `main` 分支。交接时使用：

```bash
git clone -b codex/docker-demo-kit \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
```

## 2. 同事的一键部署流程

目标服务器需要具备：

- Linux 和 systemd；
- 已部署好的 TapData Enterprise；
- 已部署好的 MongoDB 副本集或分片集群；
- `curl`、`xz` 和外网 HTTPS 访问；
- TapData Enterprise、MongoDB 与运行面板的服务器之间网络互通。

同事只需要执行：

```bash
git clone -b codex/docker-demo-kit \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
bash run-demo.sh
```

`run-demo.sh` 会自动申请 sudo，并完成 Node.js 下载、npm 依赖安装、面板构建、MongoDB 演示数据恢复、TapData 任务/API 导入、API 发布、CDC 启动、造数脚本启动和 AI 面板启动。

TapData Enterprise 和 MongoDB 服务端不放在 Git 中，它们属于同事服务器的外部服务。匿名化的 MongoDB 演示数据、任务/API 模板和 AI 面板代码已经随 Git 提供。

## 3. 配置向导

TapData、MongoDB 和面板在同一台服务器时，以下普通配置可以直接按 Enter：

| 配置项 | 默认值 |
| --- | --- |
| TapData 管理端 | `http://127.0.0.1:3030` |
| TapData API Server | `http://127.0.0.1:3080` |
| 源数据库 | `tapdata_casino_marketing` |
| 面板状态库 | `marketing_demo` |
| AI 提供商 | `deepseek` |
| AI 模型 | `deepseek-chat` |
| 面板端口 | `3000` |
| TapData 目标连接 | Enterprise 自带的 `MDM` |

以下凭据不能提交到 Git，首次运行时必须填写：

- TapData 管理端 access token；
- 已发布 API token，或 OAuth Client ID/Secret；
- MongoDB 认证 URI（如果启用了账号密码）；
- DeepSeek 或 OpenAI API Key。

凭据保存到服务器上的 `.env.external`，权限为 `0600`，不会打印到日志。

## 4. 数据链路

```text
Source MongoDB
  └─ tapdata_casino_marketing
       ↓ TapData CDC
TapData Enterprise MDM
       ↓ 已发布 API
AI 面板
```

在一键部署配置下，面板状态、审计和持久化快照使用 `marketing_demo`。面板的客户总览接口是 `/api/data/patrons`。

面板会保存一份完整快照到 MongoDB 的 `live_patrons_snapshot` 集合，并在浏览器中保存最近一次成功快照。因此，TapData API 暂时停止时，页面可能仍显示上一份数据；接口响应中的 `x-patrons-cache: stale` 表示当前数据是旧快照，不代表 TapData 仍在提供新数据。

客户总览会继续显示旧快照，但 AI Chat 的实时查询仍需要 TapData API；TapData API 停止时，实时查询可能失败。只有在 TapData 或 AI 提供商没有配置时，AI Chat 才会使用内置模拟回答。

## 5. 造数脚本

云上 Enterprise Demo 当前使用：

```text
scripts/mongo-source-feeder.mjs
```

脚本只更新已有的活跃客户，不新增客户、不删除集合，默认每 15 秒更新 1 条 Session。更新内容包括投注额、筹码估值、ADT、积分和时间字段。

手动执行一次：

```bash
export SOURCE_MONGO_URI='mongodb://<用户名>:<密码>@<MongoDB地址>:27017/tapdata_casino_marketing?authSource=admin&replicaSet=rs1'
export FEEDER_WRITE_ENABLED=true
node scripts/mongo-source-feeder.mjs --once
```

持续执行：

```bash
node scripts/mongo-source-feeder.mjs
```

只检查配置、不写库：

```bash
FEEDER_WRITE_ENABLED=false node scripts/mongo-source-feeder.mjs --dry-run
```

一键部署模式下，造数脚本由以下服务管理：

```bash
sudo systemctl status tapdata-casino-demo.service
sudo journalctl -u tapdata-casino-demo.service -f
sudo systemctl stop tapdata-casino-demo.service
sudo systemctl start tapdata-casino-demo.service
```

日志中看到 `updated: 1`，表示一次 MongoDB 源库更新成功。

## 6. TapData 导入规则

导入程序使用：

- 任务模板：`deploy/tapdata/templates/tasks/`；
- API 模板：`deploy/tapdata/templates/apis/`；
- 匿名 MongoDB 数据：`seed/demo/`。

导入前会按精确名称检查任务和 23 个 API 模块：

- 任务和全部 API 都已存在：跳过上传，避免生成 `import_as_copy` 副本；
- 只存在一部分：停止并提示检查，不继续制造重复对象；
- 全部不存在：导入、连接检查、发布 API 并启动 CDC 任务。

目标连接默认复用 TapData Enterprise 自带的 `MDM`，不会重新创建 MDM 数据库。

## 7. 重新测试一键导入

为了测试全新导入，先停止旧的 CDC 任务、造数脚本和 AI 面板。把原来的源库移动成备份名，例如：

```text
tapdata_casino_marketing_before_demo_20261012
```

不要删除备份库。保留默认源库名 `tapdata_casino_marketing`，然后重新执行：

```bash
bash run-demo.sh
```

程序会把 Git 中的演示数据恢复到默认源库，再导入任务/API。不要改名或删除 `MDM`、`marketing_mdm` 和 `marketing_demo`。

如果源库已经有数据，程序会拒绝覆盖；这是为了避免测试时破坏原始数据。

## 8. 交接时不要提交的文件

以下文件当前被 Git 忽略，属于本机或服务器私有资料：

- `.env.local`、`.env.source-feeder`：服务器地址、数据库凭据和 API 凭据；
- `secrets/`：私有密钥、许可证或 MongoDB 连接资料；
- `runtime/`：部署检查点、导入状态和运行日志；
- `deploy/tapdata/exports/`：原始 TapData 导出包；
- `node_modules/`、`.next/`：本地依赖和构建产物。

这些内容不能通过普通 Git 交接。需要时使用公司认可的密码管理器或安全文件传输方式单独提供。

## 9. 已完成的验证

最近一次代码回归结果：

- `npm test`：33 项通过；
- `bash -n run-demo.sh scripts/install-external.sh`：通过；
- `git diff --check`：通过；
- 当前分支与 `origin/codex/docker-demo-kit`：一致。
