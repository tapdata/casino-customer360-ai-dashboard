# 云上同事 Demo 手动全流程验收

这份手册用于在一台 Linux 云服务器上，手动复现同事拿到 Git 项目后的完整流程：连接已经部署好的 TapData Enterprise，使用 TapData 自带的 `MDM` 连接，准备源 MongoDB，导入任务和 API，启动 CDC、AI 面板和模拟写入，并验证数据是否真的从源库经过 CDC 到达 MDM，再由已发布 API 提供给面板。

整套流程不启动 Docker，也不安装 TapData。TapData Enterprise、MongoDB 和面板可以在同一台服务器，也可以分开部署。

## 先选择测试方式

有两种测试方式，先确认自己使用哪一种：

| 测试方式 | 适用环境 | 是否恢复源库 | 是否上传任务/API |
| --- | --- | ---: | ---: |
| 完整新环境验收 | 新的 TapData Enterprise、空的 `tapdata_casino_marketing` 源库 | 是 | 是 |
| 当前云服务器安全回归 | 已经有任务、API、MongoDB 数据的服务器 | 否 | 否，先查重名后跳过 |

完整验收只能在隔离的测试环境执行。源库必须为空；目标必须有 TapData Enterprise 自带的 `MDM` 连接。源库已经有数据时，安装器会拒绝覆盖，但不要把“让程序拒绝覆盖”当成恢复备份的测试方法。

当前云服务器已经有 `tapdata_casino_marketing` 数据、任务和 API，应该执行“安全回归”分支。不要直接在当前云服务器上执行没有导入检查点的 `sudo bash scripts/install-external.sh`，因为 TapData 的导入接口可能按 `import_as_copy` 生成同名副本。

## 验收目标和写入边界

成功的完整验收应得到以下结果：

1. Docker 运行容器数为 `0`，只使用外部 TapData Enterprise。
2. TapData 管理端和 API Server 可认证访问，通常分别为 `3030` 和 `3080`。
3. 使用已存在的 TapData 连接 `MDM`，不创建或填写新的 MDM MongoDB URI。
4. 源库固定为 `tapdata_casino_marketing`，包含 Git 中匿名化的 23 个集合。
5. 任务 `TapData_CDC_Patron_Table_Sessions_To_MongoDB` 存在并按需要启动。
6. API 包的 23 个模块已发布，路径通常为 `/api/v1/{collection}/find`。
7. 源库发生一条受控更新后，更新能从已发布 API 读到，面板返回 `mode=live`。
8. 面板端口默认为 `3000`，可以通过配置改为其他未占用端口。

会写入数据的地方只有三类：

- 首次完整验收会把匿名种子恢复到空的 `tapdata_casino_marketing`。
- CDC 会把源数据同步到 TapData 的 MDM 目标库。
- feeder 会每隔约 15 秒更新源库中已有的活跃客户；面板操作会把审计和演示状态写到 `marketing_demo`。

不会执行的操作：删除集合、覆盖非空源库、删除不同名任务、删除不同名 API、把凭据写入 Git。

## 一、通用准备

目标服务器需要：

- Linux、`systemd`、`git`、`curl`、`xz`；
- Node.js 22.13+。没有时，安装脚本会下载并校验 Node.js；
- 能访问 GitHub、TapData 管理端/API Server 和 MongoDB；
- MongoDB 源端支持副本集或分片集群，因为 CDC 需要变更流；
- 一个 TapData Enterprise 已有连接，名称必须是 `MDM`；
- TapData 管理端 access token；
- 已发布 API 的 bearer token，或 OAuth Client ID/Secret；
- AI 模型 Key；
- 面板服务器对外开放配置的端口。

不要把真实 Token、MongoDB 密码、AI Key、SSH 私钥写到文档、日志或 Git。配置文件只放在服务器上，并保持权限 `0600`。

如果 TapData、MongoDB 和面板都在本机，先把向导默认值设好；最后一个值替换成云服务器的可访问 IP 或域名：

```bash
export DEMO_TAPDATA_HOST=127.0.0.1
export DEMO_MONGO_HOST=127.0.0.1
export DEMO_PUBLIC_HOST=<云服务器公网IP或域名>
```

如果服务在其他机器，把上面三个主机名改成实际地址。`DEMO_PUBLIC_HOST` 只填主机名或 IP，不带协议和端口。

## 二、完整新环境验收

### 1. 从 Git 拉取

```bash
mkdir -p "$HOME/demo-test"
cd "$HOME/demo-test"
git clone https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
git rev-parse --short HEAD
```

如果要验收指定交付分支，改为：

```bash
git clone --branch codex/docker-demo-kit --depth 1 \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
```

记录 `git rev-parse --short HEAD`，这样出现问题时可以确认代码版本。

### 2. 创建私有配置

```bash
node scripts/configure-external.mjs .env.external
chmod 600 .env.external
```

首次向导会依次询问：

- TapData 管理端 URL，默认 `http://127.0.0.1:3030`；
- TapData API Server URL，默认 `http://127.0.0.1:3080`；
- 管理端 access token；
- 已发布 API 的 token，或者 OAuth Client ID/Secret；
- Source MongoDB 完整 URI；
- 面板状态库 URI；
- 面板服务器 IP/域名；
- 面板端口，默认 `3000`；
- AI Provider、模型名、AI API Base URL 和 AI Key。

MongoDB URI 必须包含数据库名。向导会把源库强制固定成 `tapdata_casino_marketing`，把面板状态库固定成 `marketing_demo`。密码中的 `@`、`#`、`?` 等字符要按 MongoDB URI 规则编码。

不要填写 `marketing_mdm` 的 URI。目标连接由 TapData Enterprise 提供，配置中应保持：

```dotenv
TAPDATA_IMPORT_TARGET_CONNECTION_NAME='MDM'
TAPDATA_IMPORT_USE_EXISTING_TARGET='true'
```

### 3. 安装依赖、构建并做只读预检

```bash
npm ci --include=dev
npm run build
bash scripts/external-tapdata-onboard.sh .env.external check
```

预检会检查 MongoDB 连通性、副本集、TapData 管理端认证和本地任务/API 模板，不会上传任务/API，也不会恢复源库。

预期结果包括：模板校验通过、任务包包含 1 个 CDC 任务、API 包包含 23 个模块、TapData 管理端返回 JSON。

### 4. 执行一次完整安装

确认源库为空、目标连接名为 `MDM` 后执行：

```bash
sudo bash scripts/install-external.sh .env.external
```

这条命令依次完成：

1. 必要时安装/下载 Node.js；
2. 安装锁定的 npm 依赖并构建面板；
3. 验证匿名种子；
4. 将 23 个集合恢复到 `tapdata_casino_marketing`；
5. 找到 Enterprise 已有的 `MDM` 连接，并把任务/API 导入包中的旧目标连接 ID 改成该连接 ID；
6. 上传 CDC 任务和 API 模块；
7. 修正 Source 连接为本次填写的 MongoDB URI；
8. 按配置启动 CDC 任务；
9. 等待 MDM 数据和 API 模块进入可用状态；
10. 创建并启动 `tapdata-casino-demo.service`，由它托管 AI 面板和 feeder。

安装器不会把 MongoDB URI、Token 或 AI Key 打到日志中。中途失败时不要删除 `runtime/external-demo/deployment.json` 后盲目重跑，先检查远端任务/API 是否已经创建。

### 5. 检查服务和数据

```bash
sudo systemctl status tapdata-casino-demo.service --no-pager
sudo journalctl -u tapdata-casino-demo.service --since '5 minutes ago' --no-pager -o cat
ss -ltnp | grep -E ':(3000|3030|3080)\b'
```

检查面板数据接口：

```bash
curl -fsS "http://${DEMO_PUBLIC_HOST:-127.0.0.1}:${AI_PANEL_PORT:-3000}/api/data/patrons" \
  | node --input-type=module -e '
    let text = "";
    process.stdin.on("data", chunk => text += chunk);
    process.stdin.on("end", () => {
      const body = JSON.parse(text);
      console.log(JSON.stringify({
        mode: body.mode,
        count: body.count,
        partial: body.partial,
        warnings: body.warnings,
      }));
      if (body.mode !== "live" || !body.count || body.partial || body.warnings?.length) process.exitCode = 1;
    });
  '
```

成功条件：HTTP 200、`mode=live`、`count > 0`、`partial=false`、`warnings=[]`。

### 6. 检查任务、连接和 API 数量

下面脚本只读取 TapData 管理端，不输出 Token：

```bash
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = parseEnv(readFileSync('.env.external', 'utf8'));
const base = env.TAPDATA_IMPORT_API_BASE_URL;
const headers = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };
if (env.TAPDATA_IMPORT_AUTHORIZATION) headers.authorization = env.TAPDATA_IMPORT_AUTHORIZATION;

async function get(path) {
  const url = new URL(path, base);
  if (env.TAPDATA_IMPORT_TOKEN) url.searchParams.set('access_token', env.TAPDATA_IMPORT_TOKEN);
  const response = await fetch(url, { headers, redirect: 'error' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const [connections, tasks, modules] = await Promise.all([
  get('/api/Connections?limit=1000'),
  get('/api/Task?limit=1000'),
  get('/api/Modules?limit=1000'),
]);
const connectionItems = connections?.data?.items ?? [];
const taskItems = tasks?.data?.items ?? [];
const moduleItems = modules?.data?.items ?? [];
const task = taskItems.find(item => item.name === 'TapData_CDC_Patron_Table_Sessions_To_MongoDB');
console.log(JSON.stringify({
  connections: connectionItems.length,
  mdm: connectionItems.find(item => item.name === 'MDM')?.status ?? 'missing',
  tasks: taskItems.length,
  cdcTask: task ? { id: task.id, status: task.status } : 'missing',
  apiModules: moduleItems.length,
  activeApiModules: moduleItems.filter(item => item.status === 'active').length,
}, null, 2));
JS
```

完整新环境的验收重点是 `MDM` 存在、目标 CDC 任务存在、API 模块数量为 23 且 active 数量一致。任务状态如果是 `wait_start`，说明任务存在但还没有运行；按下一节启动它。

### 7. 任务启动和 CDC 验证

如果安装器没有自动启动任务，可以在 TapData 管理端对同名任务点击一次“启动”。也可以使用已确认的 4.21 接口：

```bash
set -a
. ./.env.external
set +a

node --input-type=module <<'JS'
const base = process.env.TAPDATA_IMPORT_API_BASE_URL;
const url = new URL('/api/Task?limit=1000', base);
if (process.env.TAPDATA_IMPORT_TOKEN) url.searchParams.set('access_token', process.env.TAPDATA_IMPORT_TOKEN);
const headers = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };
if (process.env.TAPDATA_IMPORT_AUTHORIZATION) headers.authorization = process.env.TAPDATA_IMPORT_AUTHORIZATION;
const list = await (await fetch(url, { headers })).json();
const task = (list?.data?.items ?? []).find(item => item.name === 'TapData_CDC_Patron_Table_Sessions_To_MongoDB');
if (!task?.id) throw new Error('同名 CDC 任务不存在');
const start = new URL(`/api/Task/batchStart?taskIds=${encodeURIComponent(task.id)}`, base);
if (process.env.TAPDATA_IMPORT_TOKEN) start.searchParams.set('access_token', process.env.TAPDATA_IMPORT_TOKEN);
const response = await fetch(start, { method: 'PUT', headers });
if (!response.ok) throw new Error(`启动失败: HTTP ${response.status}`);
console.log(JSON.stringify({ taskId: task.id, status: 'start accepted' }));
JS
```

查看 feeder 是否持续更新源库：

```bash
sudo journalctl -u tapdata-casino-demo.service --since '2 minutes ago' --no-pager -o cat \
  | grep -E 'updated|Source update reached MDM|Panel data check passed'
```

预期每隔约 15 秒出现 `updated: 1`。随后刷新面板，或从已发布的 `patron_table_sessions` API 查询同一客户，确认 `sessionBetAmount`、`lastActionAt` 等值变化。数据链路是：

```text
Source MongoDB
  → TapData CDC
  → Enterprise MDM
  → TapData API Server 3080
  → AI 面板 3000
```

### 8. 手动使用 AI 面板

浏览器打开：

```text
http://<AI_PANEL_PUBLIC_HOST>:<AI_PANEL_PORT>/
```

按下面顺序演示：

1. 在总览大盘确认在场客户、桌台和风险指标有数据，页面没有 `partial` 或 `warnings`。
2. 打开 Customer 360，选择一个客户，确认画像、当前 Session、偏好和风险字段都来自实时 API。
3. 打开 AI Chat，输入类似：

   ```text
   请查询 P0000100861 当前的 Customer 360、风险状态和下一步建议，并说明依据。
   ```

   AI Chat 应从服务端调用已发布 TapData API，不应要求浏览器输入 MongoDB 密码。

4. 进入场景工坊，选择 VIP 回流、桌台压力或负责任博彩场景，查看推荐依据。
5. 对推荐执行审批、拒绝或发送，确认页面动作成功，审计记录写入 `marketing_demo`。
6. 停止 feeder 后再次刷新，确认页面仍能读到最后一份完整快照；恢复 feeder 后，实时字段继续变化。

## 三、当前云服务器安全回归

当前云服务器已有源数据、任务、API 和 AI 面板时，不执行恢复和上传。建议从 Git 拉取一个新的工作目录，用 `3001` 做第二个面板端口，仅验证同事使用的配置和面板流程。

### 1. 拉取代码并配置安全模式

```bash
mkdir -p "$HOME/demo-safe-rehearsal"
cd "$HOME/demo-safe-rehearsal"
git clone https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
npm ci --include=dev
npm run build

export DEMO_TAPDATA_HOST=127.0.0.1
export DEMO_MONGO_HOST=127.0.0.1
export DEMO_PUBLIC_HOST=<云服务器公网IP或域名>
node scripts/configure-external.mjs .env.external

# 当前环境已有数据，关闭恢复、上传和自动启动；面板使用独立端口。
sed -i \
  -e 's/^AI_PANEL_PORT=.*/AI_PANEL_PORT=3001/' \
  -e 's/^TAPDATA_IMPORT_RESTORE_SOURCE=.*/TAPDATA_IMPORT_RESTORE_SOURCE=false/' \
  -e 's/^TAPDATA_IMPORT_AUTOSTART=.*/TAPDATA_IMPORT_AUTOSTART=false/' \
  -e 's/^TAPDATA_IMPORT_POSTPROCESS=.*/TAPDATA_IMPORT_POSTPROCESS=false/' \
  -e 's/^FEEDER_ENABLED=.*/FEEDER_ENABLED=false/' \
  .env.external
chmod 600 .env.external
```

如果不希望面板审计写入当前 `marketing_demo`，配置完成后把 `.env.external` 中的 `marketing_demo` 替换成单独的测试库名，例如 `marketing_demo_manual`，并确保 MongoDB 用户有权限创建该库。

### 2. 只读预检和本地模板检查

```bash
bash scripts/external-tapdata-onboard.sh .env.external check
TAPDATA_IMPORT_MODE=prepare node scripts/tapdata-import.mjs prepare
```

这一步只验证连接、认证和模板。它不会恢复 23 个集合，不会上传任务/API，不会启动 CDC，不会启动 feeder。

### 3. 检查重名并决定是否跳过导入

在 TapData 管理端确认以下对象：

- 任务：`TapData_CDC_Patron_Table_Sessions_To_MongoDB`；
- 目标连接：`MDM`；
- API 模块：Git API 包中对应的 23 个模块；
- Source 连接：名称可以是 `MongoDB_Source` 或现场已有的同名 Source 连接。

如果任务和 API 都已存在，跳过上传，只检查它们的状态，然后按上一节的任务启动命令启动已有 CDC。不要为了“重新走一遍”在同一个 Enterprise 实例上传 `import_as_copy` 副本。

如果只存在部分对象，也不要直接重跑安装器。先记录已有对象和 ID，再根据 TapData 版本决定只导入缺失对象，或者使用一个全新的测试 Enterprise 实例。

### 4. 启动第二个面板实例

```bash
node scripts/external-demo.mjs .env.external serve
```

命令会以前台方式启动 `3001` 面板。由于 `FEEDER_ENABLED=false`，不会写入源 MongoDB。另开一个终端验证：

```bash
curl -fsS http://127.0.0.1:3001/api/data/patrons
```

浏览器访问：

```text
http://<云服务器公网IP或域名>:3001/
```

手动测试完成后，在运行 `serve` 的终端按 `Ctrl+C`。这只停止第二个面板，不停止原来的 3000 面板、MongoDB 或 TapData Enterprise。

## 四、停止、恢复和重复运行测试

### 停止 AI 面板和造数

```bash
sudo systemctl stop tapdata-casino-demo.service
sudo systemctl status tapdata-casino-demo.service --no-pager
```

这会停止面板和 feeder，不会删除 MongoDB 数据，也不会自动停止 TapData CDC 任务。要停止 CDC，使用 TapData 管理端的任务停止操作。

### 恢复 AI 面板和造数

```bash
sudo systemctl start tapdata-casino-demo.service
sudo journalctl -u tapdata-casino-demo.service -f
```

如果只想恢复面板、不想恢复造数，把 `.env.external` 的 `FEEDER_ENABLED` 设为 `false` 后重启服务：

```bash
sed -i 's/^FEEDER_ENABLED=.*/FEEDER_ENABLED=false/' .env.external
sudo systemctl restart tapdata-casino-demo.service
```

### 测试同一工作目录的幂等重跑

在完整新环境首次安装成功后，可以在同一目录再次运行：

```bash
sudo bash scripts/install-external.sh .env.external
```

预期日志出现 `Completed import checkpoint found; reusing imported objects`，不会再次恢复源库。这个检查点保存在当前仓库的 `runtime/external-demo/deployment.json`，换了仓库目录、MongoDB URI、导出包或目标实例后，不要复制旧检查点。

## 五、排查顺序

### 面板返回 `mode=simulated`

先检查 `.env.external` 中的：

- `TAPDATA_API_BASE_URL` 是否指向 API Server `3080`；
- 已发布 API token 或 OAuth 配置是否正确；
- `TAPDATA_FIND_PATH_TEMPLATE` 是否为 `/api/v1/{collection}/find`；
- 23 个 API 是否为 active；
- API Server 是否能访问 Enterprise 管理端和 MDM。

### 面板返回 `partial=true` 或 warnings

```bash
sudo journalctl -u tapdata-casino-demo.service --since '10 minutes ago' --no-pager -o cat
```

确认具体缺少的集合/API 名称。不要先把 API 映射改成猜测的名字；先在 TapData API 模块列表核对实际 `tableName` 和 `/api/v1` 路径。

### CDC 没有变化

按顺序检查：

1. 源 MongoDB 是副本集或分片集群；
2. Source 连接状态为 ready/normal/active；
3. 任务状态为 running；
4. feeder 日志出现 `updated: 1`；
5. MDM 中目标集合已有数据；
6. API 模块状态为 active；
7. API Server `3080` 的路由表已加载。

如果 feeder 没有启动，不要手动修改 MDM。先查看 `FEEDER_ENABLED` 和 systemd 日志。

### 导入失败或出现重复对象

停止继续重跑，保留以下信息：

```bash
git rev-parse --short HEAD
cat runtime/external-demo/deployment.json
sudo journalctl -u tapdata-casino-demo.service --since '30 minutes ago' --no-pager -o cat
```

然后在 TapData 管理端按精确名称核对任务、API、连接和状态。不要删除检查点来“强制重试”，也不要删除不属于本 Demo 的任务/API。

## 六、最终验收记录模板

把以下结果填入交付记录，不要填写 Token、密码或完整 URI：

```text
代码提交：
TapData Enterprise 版本：
管理端端口：3030
API Server 端口：3080
AI 面板地址：
AI 面板端口：
源数据库名：tapdata_casino_marketing
MDM 连接名：MDM
面板状态库名：marketing_demo（或单独的测试库）
Docker 运行容器数：0
任务 TapData_CDC_Patron_Table_Sessions_To_MongoDB：存在 / running / wait_start
API 模块：23 个 / active 数量：
面板接口：HTTP 200 / live / count / partial / warnings
feeder：开启 / 关闭
CDC 受控更新：通过 / 未通过
AI Chat：通过 / 未通过
审批与审计：通过 / 未通过
```

完成这份记录后，才算完成了一次可复现的同事 Demo 全流程验收。
