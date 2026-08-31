# AI 决策工作台运维手册

本文档用于现场 Demo 和日常运维，说明本地自动供数脚本在哪里、如何启动/停止，以及云上 AI 面板如何部署、启动、停止和排查。

> 安全提醒：真实 `.env.local`、`.env.source-feeder`、API Key、数据库密码、SSH 私钥不要提交到 GitHub，也不要贴进文档。仓库里只保留 `.env.*.example` 示例文件。

## 1. 项目位置

本地项目目录：

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
```

云上部署目录：

```bash
ssh -i ~/Downloads/skeet-20260818.pem root@47.119.130.230
cd /demo/tap_bin/ai-loyalty-engine
```

云上当前运行入口：

```bash
/demo/tap_bin/ai-loyalty-engine/current
```

`current` 是软链接，会指向某个 release，例如：

```bash
/demo/tap_bin/ai-loyalty-engine/releases/20260826-161959
```

## 2. 本地自动供数脚本

脚本位置：

```bash
scripts/realtime-source-feeder.mjs
```

配置文件：

```bash
.env.source-feeder
```

配置模板：

```bash
.env.source-feeder.example
```

这个脚本会向三个源端持续写入或更新赌场 Demo 数据，让 TapData CDC 捕获真实变化：

| 源端 | 建议 TapData 连接名 | 代表业务系统 |
|---|---|---|
| Oracle | `Oracle_Gaming_Core` | Gaming System，赌桌、玩家账户、评级、Session、局数、投注 |
| MSSQL | `MSSQL_Hotel_Ops` | Hotel / PMS + 运营风控，酒店入住、客户经理、风险案例、告警 |
| PostgreSQL | `PostgreSQL_Loyalty_CRM` | CRM / Loyalty / App / POS，客户画像、身份映射、App 行为、餐饮消费、优惠响应 |

## 3. 启动本地供数脚本

先进入项目目录：

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
```

只测试，不写数据库：

```bash
npm run source:feed:dry-run
```

只写入一批数据：

```bash
npm run source:feed:once
```

持续写入，默认读取 `.env.source-feeder`：

```bash
npm run source:feed
```

现场推荐用法：每 15 秒写一批，持续 10 小时；客户池 350 人，在场客户控制在约 220 人，保留一部分“不在场客户”用于 Customer 360 对比。单桌热度上限控制为 25 人以内，包含入座客户与站立围观客户：

```bash
node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --interval=15000 \
  --start-player-id=109000 \
  --pool-size=350 \
  --active-limit=220 \
  --duration-hours=10 \
  --max-events=2400
```

脚本会用受控分布安排桌台：有几张桌会自然变热，也有冷桌和空桌；VIP 客户更容易出现在 VIP 区，风险客户更容易出现在需要重点观察的桌台。这样大盘看起来更像真实赌场，而不是平均铺满或异常堆积。

如果想放到后台运行，推荐用 `screen`：

```bash
screen -S source_feeder
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
node scripts/realtime-source-feeder.mjs --scenario=mixed --interval=15000 --start-player-id=109000 --pool-size=350 --active-limit=220 --duration-hours=10 --max-events=2400 >> runtime/source-feeder.log 2>&1
```

按 `Ctrl + A`，再按 `D`，可以让 screen 后台运行。

## 4. 停止本地供数脚本

查看是否还在运行：

```bash
ps -ef | grep -E 'realtime-source-feeder|source-feeder|source_feeder|feed_sources' | grep -v grep
```

如果看到类似：

```text
node scripts/realtime-source-feeder.mjs --scenario=mixed ...
```

用 PID 停止：

```bash
kill <PID>
```

如果是通过 screen 启动：

```bash
screen -ls
screen -r source_feeder
```

进入后按 `Ctrl + C` 停止脚本。
如果只想强制关闭这个 screen：

```bash
screen -S source_feeder -X quit
```

再次确认没有供数进程：

```bash
ps -ef | grep -E 'realtime-source-feeder|source-feeder|source_feeder|feed_sources' | grep -v grep
```

## 5. 本地 AI 面板启动/停止

本地开发启动：

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
npm run dev
```

本地构建检查：

```bash
npm run build
```

如果用 screen 启动本地 AI 面板：

```bash
screen -S ai_panel_dev
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
npm run dev
```

停止本地 AI 面板：

```bash
screen -r ai_panel_dev
```

进入后按 `Ctrl + C`。

也可以强制关闭：

```bash
screen -S ai_panel_dev -X quit
```

## 6. 云上 AI 面板使用

访问地址：

```text
http://47.119.130.230:3000/
```

云上服务由 PM2 管理，当前有两个核心进程：

| PM2 服务名 | 作用 | 端口 |
|---|---|---|
| `ai-loyalty-web` | AI 面板 Web 服务 | `3000` |
| `ai-audit-bridge` | MongoDB 留痕写入桥 | `8790` |

查看运行状态：

```bash
ssh -i ~/Downloads/skeet-20260818.pem root@47.119.130.230
pm2 list
```

查看日志：

```bash
pm2 logs ai-loyalty-web
pm2 logs ai-audit-bridge
```

只看最近日志：

```bash
pm2 logs ai-loyalty-web --lines 100
pm2 logs ai-audit-bridge --lines 100
```

## 7. 云上 AI 面板启动、停止、重启

进入云上项目：

```bash
ssh -i ~/Downloads/skeet-20260818.pem root@47.119.130.230
cd /demo/tap_bin/ai-loyalty-engine/current
```

重启 Web：

```bash
pm2 restart ai-loyalty-web
```

重启 Mongo 留痕桥：

```bash
pm2 restart ai-audit-bridge
```

全部重启：

```bash
pm2 restart ai-loyalty-web ai-audit-bridge
```

停止：

```bash
pm2 stop ai-loyalty-web
pm2 stop ai-audit-bridge
```

重新启动已停止服务：

```bash
pm2 start ai-loyalty-web
pm2 start ai-audit-bridge
```

保存 PM2 当前配置，确保服务器重启后恢复：

```bash
pm2 save
```

## 8. 云上健康检查

检查首页：

```bash
curl -I http://127.0.0.1:3000/
```

正常应看到：

```text
HTTP/1.1 200 OK
```

检查 TapData 数据读取：

```bash
curl -sS --max-time 25 http://127.0.0.1:3000/api/data/patrons
```

正常会返回类似：

```json
{
  "count": 339,
  "mode": "live",
  "error": null,
  "warnings": [],
  "sourceCounts": {
    "patron_profiles": 339,
    "patron_table_sessions": 339,
    "patron_risk_cases": 71
  }
}
```

检查 Mongo 留痕桥：

```bash
curl -sS http://127.0.0.1:8790/health
```

正常应返回：

```json
{
  "ok": true,
  "persisted": true,
  "mode": "mongo"
}
```

## 9. 云上更新最新版代码

当前部署方式是 release 目录 + `current` 软链接。

推荐流程：

1. 本地构建确认：

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
npm run build
```

2. 打包，注意不要包含 `.env.local`、`.env.source-feeder`、`.git`、`node_modules`、`.next`：

```bash
tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='dist' \
  --exclude='.env.local' \
  --exclude='.env.source-feeder' \
  -czf /private/tmp/ai-loyalty-engine-release.tar.gz .
```

3. 上传：

```bash
scp -i ~/Downloads/skeet-20260818.pem /private/tmp/ai-loyalty-engine-release.tar.gz root@47.119.130.230:/demo/tap_bin/ai-loyalty-engine/releases/
```

4. 云上解压并安装：

```bash
ssh -i ~/Downloads/skeet-20260818.pem root@47.119.130.230
cd /demo/tap_bin/ai-loyalty-engine/releases
mkdir <new-release-name>
tar -xzf ai-loyalty-engine-release.tar.gz -C <new-release-name>
cd <new-release-name>
ln -sfn /demo/tap_bin/ai-loyalty-engine/shared/.env.local .env.local
npm ci
npm run build
```

5. 切换 current 并重启 PM2：

```bash
ln -sfn /demo/tap_bin/ai-loyalty-engine/releases/<new-release-name> /demo/tap_bin/ai-loyalty-engine/current
cd /demo/tap_bin/ai-loyalty-engine/current
pm2 restart ai-loyalty-web ai-audit-bridge
pm2 save
```

6. 验证：

```bash
curl -I http://127.0.0.1:3000/
curl -sS http://127.0.0.1:8790/health
```

## 10. 常见问题

### 页面一直显示“正在加载真实客户”

先检查数据 API：

```bash
curl -sS --max-time 25 http://127.0.0.1:3000/api/data/patrons
```

如果返回超时或 `warnings`，通常是 TapData 发布 API、Token 服务、网络或某张集合查询慢。

### 页面偶尔跳出旧数据

检查是否 PM2 还在守护旧 release：

```bash
pm2 list
ss -ltnp | grep -E ':3000|:8790'
```

确认 3000 端口进程的工作目录：

```bash
PID=<3000端口对应PID>
readlink -f /proc/$PID/cwd
```

应该指向：

```bash
/demo/tap_bin/ai-loyalty-engine/releases/<最新release>
```

### 自动供数脚本明明说停了，但 MSSQL/PG 还在写

查本地进程：

```bash
ps -ef | grep -E 'realtime-source-feeder|source-feeder|source_feeder|feed_sources' | grep -v grep
```

如果有 PID，执行：

```bash
kill <PID>
```

如果是 screen：

```bash
screen -ls
screen -S source_feeder -X quit
```

### Mongo 留痕显示未配置

检查云上 `.env.local` 是否配置了：

```bash
MONGO_AUDIT_HOST
MONGO_AUDIT_USER
MONGO_AUDIT_PASSWORD
MONGO_AUDIT_AUTH_DB
MONGO_AUDIT_DB
MONGO_AUDIT_COLLECTION
LOCAL_AUDIT_RELAY_PORT
MONGO_AUDIT_HTTP_URL
```

不要在终端或文档里打印真实密码。

### 修改了 `.env.local` 后不生效

重启两个 PM2 服务：

```bash
pm2 restart ai-loyalty-web ai-audit-bridge
pm2 save
```

## 11. 当前版本关键口径

- AI 面板默认语言：繁体中文。
- 前端数据刷新频率：8 秒。
- 数据来源：TapData 发布 API。
- AI Provider：DeepSeek。
- AI 决策留痕：MongoDB `ai_action_events`。
- Demo 目标：展示 Oracle / MSSQL / PostgreSQL 源端通过 TapData CDC 进入 MongoDB FDM，再合并到 MDM，并由 TapData API 驱动 AI Customer 360 和 Next-Best-Action。
