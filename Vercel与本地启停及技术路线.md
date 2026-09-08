# AI 面板：本地与 Vercel 启停及技术路线

本文档适用于本项目：`mogo-ai-loyalty-demo`。

项目本地目录：

```text
/Users/yangshikun/Documents/ChatGPT/Mogo Demo
```

## 一、整体技术路线

```text
Oracle / MSSQL / PostgreSQL
        │
        │  TapData CDC
        ▼
TapData FDM：字段清洗、改名、类型统一
        │
        │  Join / 主从合并
        ▼
MongoDB MDM
        │
        │  TapData 发布 API（当前使用 v2）
        ▼
Vercel Serverless API
  ├─ /api/data/patrons
  │    └─ 读取客户、Session、风险、优惠等 MDM 数据
  ├─ /api/ai/chat
  │    └─ 读取受控数据并调用 DeepSeek
  └─ /api/audit/events
       └─ 转发审批、发送、风险处理审计事件
        │
        ▼
浏览器 AI 面板
```

重要原则：浏览器不直接访问 TapData，DeepSeek Key、TapData Client Secret 和 Mongo 凭证只在服务端环境变量中使用。

## 二、本地配置文件

### 1. AI 面板配置

文件：

```text
/Users/yangshikun/Documents/ChatGPT/Mogo Demo/.env.local
```

核心变量：

```env
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
AI_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=你的DeepSeek密钥

TAPDATA_API_BASE_URL=http://<tapdata-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_TOKEN_URL=http://<tapdata-host>:3030/oauth/token
TAPDATA_CLIENT_ID=你的客户端ID
TAPDATA_CLIENT_SECRET=你的客户端密钥
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_SCAN_LIMIT=5000
```

`TAPDATA_API_BASE_URL` 只填写基础地址，不要把 `/api/v1/...` 重复写进去。具体表名由 `{collection}` 自动替换。

### 2. 本地造数脚本配置

文件：

```text
/Users/yangshikun/Documents/ChatGPT/Mogo Demo/.env.source-feeder
```

该文件只负责向 Oracle、MSSQL、PostgreSQL 写入模拟业务数据，不是 Vercel AI 面板的配置文件。

例如每 30 秒写入一次：

```env
FEEDER_INTERVAL_MS=30000
```

不要将 `.env.local` 或 `.env.source-feeder` 上传到 Git 或 Vercel Source。模板文件为：

```text
.env.example
.env.cloud.example
.env.source-feeder.example
```

## 三、本地 AI 面板启动与停止

### 1. 前台启动

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

如果需要指定端口：

```bash
npm run dev -- --port 3000
```

### 2. 后台启动

使用 `screen`，关闭终端后进程仍可继续运行：

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
screen -dmS ai-panel-local zsh -lc 'npm run dev'
```

查看运行状态：

```bash
screen -list
```

查看运行日志：

```bash
screen -r ai-panel-local
```

退出查看但不停止进程：按 `Ctrl+A`，再按 `D`。

停止本地 AI 面板：

```bash
screen -S ai-panel-local -X quit
```

### 3. 本地生产构建测试

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
npm run build
npm run start -- --port 3000
```

同一端口不能同时运行开发服务和生产服务。

## 四、本地造数脚本启动与停止

### 1. 启动持续造数

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
screen -dmS source-feeder zsh -lc 'npm run source:feed'
```

查看日志：

```bash
tail -f "/Users/yangshikun/Documents/ChatGPT/Mogo Demo/runtime/source-feeder-current.log"
```

查看进程：

```bash
screen -list
```

停止造数：

```bash
screen -S source-feeder -X quit
```

### 2. 只写入一批

```bash
npm run source:feed:once
```

### 3. 只做演练、不写入数据库

```bash
npm run source:feed:dry-run
```

造数脚本写入源库后，还必须等待 TapData CDC、FDM、MDM 和 API 发布链路完成，AI 面板才会看到变化。

## 五、Vercel 项目运行方式

Vercel 不是一台需要手动执行 `npm start` 的常驻服务器。它会把项目构建为：

- 静态页面资源；
- `/api/*` Serverless Functions；
- 按请求自动启动和回收函数实例。

因此 Vercel 没有传统意义上的“登录服务器后启动/停止进程”。

### 1. Vercel 启动/发布

在 Vercel 项目中：

```text
Project
→ Deployments
→ Add New / Upload
→ 上传本地项目目录
→ Deploy
```

项目构建命令来自 `package.json`：

```json
"build": "vinext build"
```

如果 Vercel 没有自动识别，设置：

```text
Build Command: npm run build
Node.js: 22.x
```

部署成功后，Vercel 会生成新的部署版本和访问域名。

### 2. Vercel 重新部署

修改环境变量或代码后：

```text
Deployments
→ 选择最新部署
→ Redeploy
```

环境变量修改后必须重新部署，新变量才会进入新的 Serverless Function。

### 3. Vercel 停止或回退

Vercel 没有 `npm stop`。常用操作是：

- 暂停使用：移除项目域名或关闭对外访问；
- 回退版本：在 Deployments 中选择上一版并重新部署；
- 停止自动发布：断开 Git 集成或关闭对应自动部署；
- 完全停止：删除项目。删除属于破坏性操作，执行前应确认已备份配置。

删除或停用 Vercel 项目不会停止本地造数脚本，也不会停止 TapData CDC 任务；这些属于独立系统。

## 六、Vercel 环境变量配置

进入：

```text
Vercel 项目
→ Settings
→ Environment Variables
```

逐项添加变量，并至少勾选 `Production`。

### AI 变量

```env
AI_PROVIDER=deepseek
AI_MODEL=deepseek-chat
AI_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=********
```

### TapData 变量

```env
TAPDATA_API_BASE_URL=http://<tapdata-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_TOKEN_URL=http://<tapdata-host>:3030/oauth/token
TAPDATA_CLIENT_ID=********
TAPDATA_CLIENT_SECRET=********
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_SCAN_LIMIT=5000
```

### 审计变量

```env
MONGO_AUDIT_HTTP_URL=https://<public-audit-service>/
```

Vercel 中不能使用 `127.0.0.1` 访问本地审计桥、TapData 或 MongoDB。云端地址必须能从公网访问，并建议使用 HTTPS、IP 白名单和访问认证。

## 七、代码如何读取配置

### TapData 数据接口

文件：

```text
app/api/data/patrons/route.ts
```

运行时读取 `process.env.TAPDATA_*`，然后：

```text
获取 OAuth Token
→ 使用 Bearer Token 调用 /api/v1/{collection}/find
→ 读取多个 MDM 集合
→ 合并为 Customer 360
→ 返回 JSON 给前端
```

### DeepSeek 对话接口

文件：

```text
app/api/ai/chat/route.ts
```

运行时读取 `AI_PROVIDER`、`AI_MODEL`、`AI_BASE_URL` 和 `DEEPSEEK_API_KEY`，再调用 DeepSeek Chat Completions。TapData 查询工具使用白名单集合，模型不能任意访问数据库。

### 审计接口

文件：

```text
app/api/audit/events/route.ts
```

读取 `MONGO_AUDIT_HTTP_URL`，转发审批、发送、告警处理等事件。若没有配置可访问的审计服务，接口会返回未持久化状态。

## 八、刷新和延迟

当前设计为：

```text
前端刷新：约 8 秒
服务端快照：7 秒 fresh + 最长 120 秒 stale-while-refresh
单次请求超时：15 秒
```

首次打开页面仍需要等待 TapData 返回完整快照；首次快照建立后，轮询优先返回最近一次完整快照，不再让用户等待 TapData 的大响应，同时后台只允许一个刷新请求。接口会返回 `cacheState`，并通过 `x-patrons-cache`、`x-patrons-cache-age-ms` 标识本次数据是否为 fresh/stale 以及快照年龄。可按环境调整：

```text
PATRONS_CACHE_FRESH_MS=7000
```

这只代表 AI 面板重新读取 API 的频率，不代表 TapData CDC 必然在 8 秒内完成。实际看到数据变化的时间还取决于：

```text
源端写入
→ CDC 捕获
→ FDM 同步
→ MDM Join/更新
→ API 可读
→ Vercel Function 返回
→ 前端刷新
```

## 九、故障排查顺序

### 页面数据不变化

1. 查看本地造数日志，确认三端是否写入成功；
2. 查看 TapData CDC 任务是否运行、是否有增量延迟；
3. 直接调用 MDM 发布 API，确认目标表是否已有新记录；
4. 查看 Vercel `Deployments → Logs`，检查 Serverless Function 错误；
5. 访问：

   ```text
   /api/data/patrons?ts=当前时间戳
   ```

   检查返回的 `fetchedAt`、`sourceCounts` 和 `warnings`；

6. 最后再检查浏览器是否仍停留在旧部署或旧页面缓存。

### AI 无法回答

依次检查：

```text
DEEPSEEK_API_KEY
AI_BASE_URL
AI_MODEL
TAPDATA_API_BASE_URL
TAPDATA_TOKEN_URL
TAPDATA_CLIENT_ID / SECRET
```

### 云端审计没有落库

确认 `MONGO_AUDIT_HTTP_URL` 不是 `127.0.0.1`，并且该地址能从公网访问。Vercel Serverless Function 不能访问你个人电脑上的本地端口。

## 十、安全要求

- 不要提交 `.env.local`、`.env.source-feeder`；
- 不要把 DeepSeek Key、TapData Client Secret 写入 React、Markdown 或截图；
- 不要使用 `NEXT_PUBLIC_` 前缀暴露服务端密钥；
- TapData 和审计服务建议使用 HTTPS、IP 白名单和最小权限账号；
- 如果密钥曾经出现在 Git、Vercel Source 或公开日志中，应立即撤销并重新生成。
