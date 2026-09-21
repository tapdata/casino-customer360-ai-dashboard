# TapData 企业版 + AI 面板：无 AI 智能体命令行部署手册

这份手册对应“同事已经部署好 TapData 企业版，但没有 AI 面板”的场景。流程从 Git 拉取代码开始，复用 TapData 已有的 `MDM`、任务和 API；确认重名后跳过导入，再启动已有 CDC 任务、AI 面板和模拟写入脚本。

正常情况下，同事需要执行 **8 个可复制的命令块**。第 3 块是交互式配置向导，按默认值直接按 Enter 即可。如果 Node.js 和依赖已经准备好，可以少执行第 2 块。

## 前提

目标 Linux 服务器需要满足：

- 能访问 GitHub、TapData 管理端/API Server 和 MongoDB。
- 已有 TapData Enterprise，管理端通常是 `3030`，发布 API Server 通常是 `3080`。
- 已有名为 `MDM` 的 TapData 内置目标连接。
- 源 MongoDB 使用副本集或分片集群，数据库名为 `tapdata_casino_marketing`。
- 面板状态库使用 `marketing_demo`。这个库可以是已有库，程序不会恢复或清空它。
- 已准备 TapData 管理端 Token、发布 API Token 或 OAuth Client、MongoDB 账号密码和 AI API Key。
- 服务器已安装 `git`、`curl`、`gzip`、`jq` 和 Node.js 22.13+。没有 Node.js 时，项目安装脚本可以自动下载受校验的 Node.js，但下面的纯命令行流程建议先准备好 Node.js。

默认值如下：

| 配置 | 默认值 |
| --- | --- |
| TapData 管理端 | `http://127.0.0.1:3030` |
| TapData API Server | `http://127.0.0.1:3080` |
| 源 MongoDB | `mongodb://127.0.0.1:27017/tapdata_casino_marketing?replicaSet=rs1` |
| 面板状态库 | `mongodb://127.0.0.1:27017/marketing_demo?replicaSet=rs1` |
| TapData 目标连接 | 已有 `MDM`，不填写新的 MDM URI |
| AI 提供商/模型 | DeepSeek / `deepseek-chat` |
| 面板端口 | `3000` |

如果 TapData 或 MongoDB 在别的服务器，先设置默认主机，向导中仍然可以按 Enter：

```bash
export DEMO_TAPDATA_HOST=tapdata.example.internal
export DEMO_MONGO_HOST=mongo.example.internal
export DEMO_PUBLIC_HOST=demo.example.internal
```

## 1. 从 Git 拉取代码

这是第 1 个命令块。分支名按交付版本调整；当前交付分支是 `codex/docker-demo-kit`。

```bash
git clone --branch codex/docker-demo-kit --depth 1 \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
```

如果公司网络无法直连 GitHub，先解决 Git 代理/网络问题，或者让交付方提供同一提交的 Git bundle。不要从旧 AI 面板目录复制 `node_modules` 或 `.env.local`。

## 2. 安装依赖并构建面板

这是第 2 个命令块。

```bash
npm ci --include=dev
npm run build
```

构建失败时不要启动服务，先处理 Node.js 版本或依赖问题。

## 3. 使用配置向导

这是第 3 个命令块。向导会在当前目录创建权限为 `0600` 的 `.env.external`。密码、Token 和 AI Key 不会回显。

```bash
node scripts/configure-external.mjs .env.external
```

需要填写的值：

- TapData 管理端 Token：用于读取任务、检查重名和启动已有任务。
- 已发布 API 的 Token，或 OAuth Client ID/Secret：面板读取 MDM API 使用。
- 源 MongoDB URI：必须指向 `tapdata_casino_marketing`。
- 面板状态 MongoDB URI：指向 `marketing_demo`。
- AI API Key。
- 面板服务器 IP/域名和端口；端口默认 `3000`。

MongoDB URI 中的特殊字符要按 URI 规则编码，例如密码中的 `@` 要编码为 `%40`。

## 4. 打开“只复用，不恢复”的安全模式并校验模板

这是第 4 个命令块。已有源库时必须关闭恢复；`MDM` 使用 TapData Enterprise 已有连接；模板校验只读本地文件，不访问 TapData，也不会写 MongoDB。

```bash
sed -i \
  -e 's/^TAPDATA_IMPORT_RESTORE_SOURCE=.*/TAPDATA_IMPORT_RESTORE_SOURCE=false/' \
  -e 's/^TAPDATA_IMPORT_MODE=.*/TAPDATA_IMPORT_MODE=manual/' \
  -e 's/^TAPDATA_IMPORT_AUTOSTART=.*/TAPDATA_IMPORT_AUTOSTART=false/' \
  .env.external

TAPDATA_IMPORT_ROOT=deploy/tapdata/templates \
  node scripts/tapdata-import.mjs prepare
```

预期看到任务包包含 1 个任务，API 包包含 23 个模块。此模式下不要执行下面这条安装命令：

```bash
scripts/external-tapdata-onboard.sh .env.external install
```

这个安装模式会上传任务/API 副本；目标环境已有同名对象时，直接执行可能生成重复任务和 API。

## 5. 通过 TapData API 检查重名

这是第 5 个命令块，只读查询 TapData。它会列出模板中的 API 名称在目标环境是否已经存在，并检查任务是否存在。下面命令使用配置文件中的管理端 Token，不打印 Token 或 MongoDB URI。

```bash
set -a
. ./.env.external
set +a

node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const base = process.env.TAPDATA_IMPORT_API_BASE_URL;
const headers = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };
if (process.env.TAPDATA_IMPORT_AUTHORIZATION) {
  headers.authorization = process.env.TAPDATA_IMPORT_AUTHORIZATION;
}

async function get(path) {
  const url = new URL(path, base);
  if (process.env.TAPDATA_IMPORT_TOKEN) {
    url.searchParams.set('access_token', process.env.TAPDATA_IMPORT_TOKEN);
  }
  const response = await fetch(url, { headers, redirect: 'error' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const rows = JSON.parse(gunzipSync(readFileSync(
  'deploy/tapdata/templates/apis/module_batch-20260915.json.gz',
)).toString('utf8'));
const templateApiNames = rows
  .filter(row => row?.collectionName === 'Modules')
  .map(row => parse(row.json)?.name)
  .filter(Boolean);

const taskBody = await get('/api/Task');
const apiBody = await get('/api/Modules');
const tasks = taskBody?.data?.items ?? [];
const modules = apiBody?.data?.items ?? [];
const taskName = 'TapData_CDC_Patron_Table_Sessions_To_MongoDB';
const task = tasks.find(item => item.name === taskName);
const duplicateApiNames = templateApiNames.filter(name => modules.some(item => item.name === name));
const missingApiNames = templateApiNames.filter(name => !modules.some(item => item.name === name));

console.log(JSON.stringify({
  task: task ? { name: task.name, id: task.id, status: task.status } : null,
  templateApiCount: templateApiNames.length,
  duplicateApiCount: duplicateApiNames.length,
  duplicateApiNames,
  missingApiNames,
}, null, 2));
JS
```

如果任务已经存在，或者 `duplicateApiCount` 等于模板模块数，就跳过导入。部分 TapData 版本会保留同名的旧 `pending` 记录；只要对应的 `MDM` 活跃记录已存在，也不要再次导入。

## 6. 启动已有 CDC 任务

这是第 6 个命令块。它只启动已经确认重名的任务，不上传任务包，也不恢复 MongoDB。命令默认使用 TapData 4.21 的启动接口；如果目标版本提供了不同路径，按该版本的 API 文档修改 `TAPDATA_TASK_START_PATH_TEMPLATE`。

```bash
set -a
. ./.env.external
set +a

node --input-type=module <<'JS'
const base = process.env.TAPDATA_IMPORT_API_BASE_URL;
const headers = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };
if (process.env.TAPDATA_IMPORT_AUTHORIZATION) {
  headers.authorization = process.env.TAPDATA_IMPORT_AUTHORIZATION;
}

async function get(path) {
  const url = new URL(path, base);
  if (process.env.TAPDATA_IMPORT_TOKEN) url.searchParams.set('access_token', process.env.TAPDATA_IMPORT_TOKEN);
  const response = await fetch(url, { headers, redirect: 'error' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const body = await get('/api/Task');
const task = (body?.data?.items ?? []).find(item => item.name === 'TapData_CDC_Patron_Table_Sessions_To_MongoDB');
if (!task?.id) throw new Error('同名 CDC 任务不存在，先检查 TapData 导入状态');
const running = new Set(['running', 'starting', 'processing', 'queued', '运行中', '启动中']);
if (running.has(String(task.status).toLowerCase())) {
  console.log(JSON.stringify({ action: 'skip-start', taskId: task.id, status: task.status }));
  process.exit(0);
}

const template = process.env.TAPDATA_TASK_START_PATH_TEMPLATE || '/api/Task/batchStart?taskIds={taskId}';
const path = template.replaceAll('{taskId}', encodeURIComponent(task.id));
const url = new URL(path, base);
if (process.env.TAPDATA_IMPORT_TOKEN) url.searchParams.set('access_token', process.env.TAPDATA_IMPORT_TOKEN);
const response = await fetch(url, {
  method: process.env.TAPDATA_TASK_START_METHOD || 'PUT',
  headers,
  redirect: 'error',
});
if (!response.ok) throw new Error(`启动任务失败: HTTP ${response.status}`);
console.log(JSON.stringify({ action: 'start', taskId: task.id, httpStatus: response.status }));
JS
```

几秒后在 TapData 管理端确认任务状态为“运行中”。如果管理端 Token 只能读取、不能启动任务，仍然可以在 TapData 的“数据复制”页面对这个同名任务点击一次“启动”；之后继续执行下面的命令行部署。

## 7. 启动 AI 面板和模拟写入服务

这是第 7 个命令块。它创建一个 systemd 服务，面板和 feeder 由同一个服务托管，开机自动启动，任一进程退出会自动重启。

```bash
APP_DIR="$PWD"
sudo tee /etc/systemd/system/tapdata-casino-demo.service >/dev/null <<EOF
[Unit]
Description=TapData casino demo panel and source feeder
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/scripts/external-demo.mjs $APP_DIR/.env.external serve
Restart=always
RestartSec=5
KillMode=control-group
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now tapdata-casino-demo.service
```

这一步不会导入任务/API，也不会恢复源库。`serve` 模式只启动 Next.js 面板和 `scripts/mongo-source-feeder.mjs`。

## 8. 验证面板、模拟写入和 CDC

这是第 8 个命令块。

```bash
set -a
. ./.env.external
set +a

curl -fsS "http://${AI_PANEL_PUBLIC_HOST:-127.0.0.1}:${AI_PANEL_PORT:-3000}/api/data/patrons" \
  | node --input-type=module -e '
    let text = "";
    process.stdin.on("data", chunk => text += chunk);
    process.stdin.on("end", () => {
      const body = JSON.parse(text);
      console.log(JSON.stringify({ mode: body.mode, count: body.count, partial: body.partial, warnings: body.warnings }));
      if (body.mode !== "live" || !body.count || body.partial || body.warnings?.length) process.exitCode = 1;
    });
  '

sudo journalctl -u tapdata-casino-demo.service --since '2 minutes ago' --no-pager -o cat | tail -n 20
```

成功条件：

- 面板接口返回 HTTP 200。
- 返回 `mode=live`、`count` 大于 0、`partial=false`、`warnings=[]`。
- 日志每隔约 15 秒出现 `{"updated":1,"database":"tapdata_casino_marketing"}`。
- TapData 任务状态为“运行中”。
- 新的源库变更经过 TapData CDC 后，可以从已发布的 `patron_table_sessions` API 读到。

面板地址为：

```text
http://${AI_PANEL_PUBLIC_HOST}:${AI_PANEL_PORT}
```

## 常用运维命令

```bash
sudo systemctl status tapdata-casino-demo.service
sudo systemctl restart tapdata-casino-demo.service
sudo systemctl stop tapdata-casino-demo.service
sudo journalctl -u tapdata-casino-demo.service -f
```

查看模拟写入是否仍在工作，重点看日志中的 `updated: 1`。停止面板服务会同时停止 feeder；不会删除 MongoDB 数据。

## 数据安全边界

- 已有源库时始终使用 `TAPDATA_IMPORT_RESTORE_SOURCE=false`。
- 不执行 `demo-seed.mjs restore`、`mongorestore` 或任何删除集合的命令。
- 不填写或创建 `marketing_mdm`；TapData Enterprise 的目标连接名是 `MDM`。
- 任务/API 已存在时只做重名检查和任务启动，不重新上传导出包。
- `.env.external` 只保存在服务器，权限保持 `0600`，不要提交到 Git。
- `MDM` 的 CDC 写入是本流程的预期写入；它来自源库 feeder 产生的变更，不是数据库恢复覆盖。
