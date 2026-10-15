# AI 忠诚度面板交接说明（中文 Review 版）

这份文档先用于内部 review，目标是让接手同事能够回答四个问题：源数据库怎么建表和造数据，数据怎样经过 TapData，TapData 发布哪些 API，以及 AI 面板代码在哪里、如何启动。

本交接只覆盖三关系型数据库路径：Oracle、MSSQL、PostgreSQL → TapData CDC/FDM/MDM → 已发布 API → AI 面板。对应 `scripts/realtime-source-feeder.mjs` 和三份关系型数据库 SQL。

## 1. 整体数据关系

```text
Oracle gaming core ─┐
MSSQL hotel / ops ──┼─> TapData CDC ─> FDM / join ─> MDM collections ─> published APIs ─> AI panel
PostgreSQL CRM ────┘                                                        ├─> AI Chat
                                                                              ├─> Customer 360
                                                                              └─> audit / demo journey MongoDB
```

浏览器不直接连接 Oracle、MSSQL、PostgreSQL 或业务 MongoDB。Next.js 服务端调用 TapData 已发布 API，OAuth 凭据只放在服务端环境变量中，再把数据整理给页面使用。

跨库关联必须保持以下主键关系不变：

| 业务含义 | 示例值 | 出现位置 |
| --- | --- | --- |
| 原始玩家 ID | `105001` | Oracle `PLAYER_ID`、PG `gaming_player_id`、MSSQL `player_id` |
| MDM 主客户 ID | `P0000105001` | PG `master_player_id`、MSSQL AI-ready `patronId`、MDM `patronId` |
| CRM 客户 ID | `C105001` | PG `crm_customer_id`、`crm_patron_profiles.customer_id` |
| 酒店客人 ID | `H105001` | PG `hotel_guest_id`、MSSQL `guest_id` |
| 会员号 | `VIP105001` | PG `pos_member_no`、POS/F&B 数据 |
| 桌台 ID | `T-0004` | Oracle `TABLE_ID`、MSSQL AI-ready `tableId`、MDM 桌台记录 |

最重要的桥接关系是：

```text
Oracle PLAYER_ID
  = PostgreSQL crm_identity_links.gaming_player_id
  = MSSQL player_id
  -> PostgreSQL crm_identity_links.master_player_id
  -> MDM patronId / Customer 360
```

例如：`105001 -> P0000105001 -> C105001 / H105001 / VIP105001`。

## 2. 代码和交付文件在哪里

所有代码、脚本、SQL 和交接文档都在 GitHub 仓库：

```text
https://github.com/tapdata/casino-customer360-ai-dashboard.git
```

当前这套造数脚本和交接材料位于 `codex/docker-demo-kit` 分支。首次获取代码：

```bash
git clone --branch codex/docker-demo-kit --single-branch \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
git status
```

后续更新代码：

```bash
git switch codex/docker-demo-kit
git pull --ff-only origin codex/docker-demo-kit
```

如果仓库管理员已经把内容合并到 `main`，把上面命令中的分支名统一替换为 `main`。GitHub HTTPS 登录使用有仓库权限的账号和 Personal Access Token，不能把登录密码写进命令或文档。

### AI 面板代码

| 路径 | 用途 |
| --- | --- |
| `app/page.tsx` | 面板入口、客户选择、升级演示和页面状态 |
| `app/command-center.tsx` | 总览、桌台热力图、AI Chat、Customer 360、场景工坊 |
| `app/api/data/patrons/route.ts` | 服务端读取客户画像、Session、风险等 TapData API |
| `app/api/ai/chat/route.ts` | AI Chat 的白名单查询、证据整理和回答生成 |
| `app/api/audit/events/route.ts` | 推荐、审批、发送等动作的审计写入 |
| `app/api/demo/upgrade/route.ts` | VIP 升级演示状态的 MongoDB 持久化 |
| `app/api/tapdata-collections.ts` | 面板逻辑集合名到已发布 API 名的映射 |
| `app/lib/tapdata-config.ts` | TapData 地址、OAuth、超时和集合映射读取 |
| `app/globals.css` | 面板样式 |

### 三库和造数文件

| 路径 | 用途 |
| --- | --- |
| `scripts/realtime-source-feeder.mjs` | Oracle/MSSQL/PostgreSQL 长期造数脚本，三库路径的唯一写入来源 |
| `.env.source-feeder.example` | 三库造数配置模板；真实文件为私有的 `.env.source-feeder` |
| `scripts/export-realtime-source-sql.mjs` | 重新生成三份建表和基线数据 SQL |
| `docs/three-source-sql/oracle_c##gaming_realtime_bootstrap.sql` | Oracle 建表和基线数据 |
| `docs/three-source-sql/mssql_casino_ops_realtime_bootstrap.sql` | MSSQL 建表和基线数据 |
| `docs/three-source-sql/postgres_casino_loyalty_realtime_bootstrap.sql` | PostgreSQL 建表和基线数据 |

不要把 `.env.local`、`.env.source-feeder`、数据库密码、OAuth Secret、AI Key 或 License 提交到 Git。

### MongoDB 源库怎么恢复

仓库中的 `seed/demo/` 是已经脱敏的 MongoDB 源库快照，目标数据库名固定为 `tapdata_casino_marketing`，包含 23 个集合。它是 TapData 源端数据；TapData 的 FDM/MDM 目标集合仍然要通过任务同步生成，不能把源快照直接当成 MDM 数据。

先在仓库根目录校验快照：

```bash
node scripts/demo-seed.mjs check
```

准备一个带数据库名的 MongoDB URI，并确认目标 MongoDB 已启用副本集（TapData CDC 需要 oplog）：

```bash
export SOURCE_RESTORE_URI='mongodb://<user>:<password>@<mongo-host>:27017/tapdata_casino_marketing?authSource=admin&replicaSet=<replica-set>'
node scripts/demo-seed.mjs restore
unset SOURCE_RESTORE_URI
```

恢复脚本会逐个创建集合、插入文档、建立索引并按 `manifest.json` 校验数量和校验和。目标库必须为空；如果已有数据或上次恢复中断，脚本会拒绝覆盖，不会自动删除数据。恢复成功后，可用 `mongosh` 检查集合数量和文档数：

```bash
mongosh '<同一个 MongoDB URI>' --quiet --eval \
  'db.getCollectionNames().length; db.patron_profiles.countDocuments({})'
```

MongoDB 账号密码只通过环境变量或本机私有文件传入，不要提交到 Git。AI 面板的审计库（例如 `ai_loyalty_engine`）和升级演示状态库由面板首次写入时自动创建，不使用上述源库快照恢复。

## 3. 三个关系型数据库怎么建表

三份 SQL 是按当前长期造数脚本生成的，使用幂等 DDL 和 MERGE/ON CONFLICT。重复执行不会按相同业务主键重复插入基线记录。它们只负责源端表，不负责 TapData 的 FDM/MDM 目标集合。

### 3.1 Oracle

连接到 schema `C##GAMING`，执行：

```text
docs/three-source-sql/oracle_c##gaming_realtime_bootstrap.sql
```

当前 7 张源表：

| 表名 | 主键 | 用途 |
| --- | --- | --- |
| `GAMING_PLAYER_ACCOUNT` | `PLAYER_ID` | 玩家账户和基础身份 |
| `GAMING_PLAYER_RATINGS` | `RATING_ID` | ADT、Theo、偏好游戏、评级 |
| `GAMING_TABLE_STATE` | `TABLE_ID` | 当前桌台、区域和在场人数 |
| `GAMING_TABLE_STATE_HISTORY` | `HISTORY_ID` | 桌台状态历史快照 |
| `GAMING_TABLE_SESSIONS` | `SESSION_ID` | 当前/最近入座和投注状态 |
| `GAMING_PLAYER_ROUND_BETS` | `ROUND_BET_ID` | 回合投注信号 |
| `GAMING_TABLE_ROUND_COUNTERS` | `COUNTER_ID` | 桌台和营业日回合计数 |

### 3.2 MSSQL

连接到数据库 `casino_ops`、schema `dbo`，执行：

```text
docs/three-source-sql/mssql_casino_ops_realtime_bootstrap.sql
```

当前 9 张业务表：

| 表名 | 主键 | 用途 |
| --- | --- | --- |
| `hotel_stays` | `stay_id` | 酒店入住、房间和礼遇资格 |
| `responsible_play_cases` | `case_id` | 责任博彩风险案件 |
| `host_assignments` | `assignment_id` | 客户经理/PR 分配和 SLA |
| `room_inventory` | `inventory_id` | 房间礼遇库存 |
| `pr_agent_profiles` | `pr_agent_id` | 客户经理能力和技能 |
| `ops_alert_rules` | `rule_id` | 运营告警规则 |
| `host_assignments_ai_ready` | `assignment_id` | 给 FDM/MDM/API 的标准化分配记录 |
| `responsible_play_cases_ai_ready` | `case_id` | 给 FDM/MDM/API 的标准化风险记录 |
| `ops_patron_alerts_ai_ready` | `alert_id` | 给 FDM/MDM/API 的标准化告警记录 |

SQL Server CDC 内部表（例如 `systranschemas`）由 SQL Server/TapData 管理，不在业务 SQL 中创建。当前演示 MSSQL 端口是 `2433`，但同事环境应以 `.env.source-feeder` 为准。

### 3.3 PostgreSQL

连接到数据库 `postgres`，脚本会创建/使用 schema `casino_loyalty`，执行：

```text
docs/three-source-sql/postgres_casino_loyalty_realtime_bootstrap.sql
```

当前 5 张源表：

| 表名 | 主键 | 用途 |
| --- | --- | --- |
| `crm_identity_links` | `master_player_id` | Oracle/MSSQL/CRM 身份桥 |
| `crm_patron_profiles` | `customer_id` | 客户等级、ADT、积分和偏好 |
| `app_activity_events` | `event_id` | App 行为事件 |
| `pos_fnb_checks` | `check_id` | POS/F&B 消费偏好 |
| `crm_offer_responses` | `response_id` | 礼遇响应和渠道结果 |

建议执行顺序：Oracle → MSSQL → PostgreSQL。执行后先检查每个源表的行数和主键，再配置 TapData 源连接。

## 4. 三库数据怎么造

复制并填写私有配置：

```bash
cp .env.source-feeder.example .env.source-feeder
chmod 600 .env.source-feeder
```

主要连接项：

```dotenv
ORACLE_CONNECT_STRING=<oracle-host>:1521/orcl
ORACLE_SCHEMA=C##GAMING

MSSQL_SERVER=<mssql-host>
MSSQL_PORT=2433
MSSQL_DATABASE=casino_ops
MSSQL_SCHEMA=dbo

PGHOST=<postgres-host>
PGPORT=25432
PGDATABASE=postgres
PGSCHEMA=casino_loyalty
```

先做连通性检查：

```bash
node scripts/realtime-source-feeder.mjs --dry-run
```

只写一轮，适合首次验证：

```bash
node scripts/realtime-source-feeder.mjs \
  --scenario=mixed --batch-size=5 --once
```

长期运行 3 天：

```bash
node scripts/realtime-source-feeder.mjs \
  --scenario=mixed \
  --interval=15000 \
  --batch-size=5 \
  --pool-size=350 \
  --active-limit=220 \
  --max-active=350 \
  --max-table-visible=25 \
  --risk-ratio=0.02 \
  --duration-hours=72
```

脚本使用稳定业务 ID 和 upsert，可以停止后继续运行，不需要重新建库。主要限制是：最多 350 个活跃客户池、现场目标约 220 人、每张桌最多显示 25 人、每轮最多处理 5 个逻辑客户。

后台运行和停止：

```bash
mkdir -p .runtime
nohup node scripts/realtime-source-feeder.mjs \
  --scenario=mixed --interval=15000 --batch-size=5 \
  --pool-size=350 --active-limit=220 --max-active=350 \
  --duration-hours=72 > .runtime/source-feeder.log 2>&1 &
echo $! > .runtime/source-feeder.pid

PID=$(cat .runtime/source-feeder.pid)
kill -0 "$PID" 2>/dev/null && echo "造数脚本运行中" || echo "造数脚本已停止"
tail -f .runtime/source-feeder.log
kill -INT "$PID"
```

## 5. TapData 怎么流转

三库路径的标准链路如下：

1. 创建 Oracle、MSSQL、PostgreSQL 源连接，确认能读取上面的源表。
2. 创建/启动三库到 TapData 的 CDC 任务，完成首次全量同步。
3. 在 FDM/merge 节点配置身份关联。最常用的关联键是 `gamingPlayerId` / `playerId`，值必须出现在 update/insert 事件的 **after** 数据中。
4. 将清洗、字段转换和多表合并结果写入 MDM MongoDB 集合。
5. 对 MDM 集合发布 TapData API，AI 面板只访问这些 API。
6. 在 TapData 日志中确认：源端有 CDC 事件，FDM 没有缺少关联键，MDM 有写入，API 能返回记录。

如果 update 事件没有 before，只要 after 中仍带有配置的 join key，通常可以继续处理；如果 after 本身缺少关联键，FDM 无法补出关联关系。不要把 `Oracle PLAYER_ID` 直接和 `master_player_id` 连接，它们格式不同，必须经过 `crm_identity_links`。

## 6. TapData 发布哪些 API

### 6.1 面板使用的核心 API 映射


面板逻辑集合名在 `TAPDATA_COLLECTION_MAP` 中映射到 TapData 发布名。当前常用映射：

| 面板逻辑名 | 发布 API 名 |
| --- | --- |
| `patron_profiles` | `patron_profiles` |
| `patron_table_sessions` | `patron_table_sessions` |
| `patron_activity_events` | `patron_activity_events_ai_ready` |
| `patron_alerts` | `ops_patron_alerts_ai_ready` |
| `patron_risk_cases` | `responsible_play_cases_ai_ready` |
| `pr_assignments` | `host_assignments_ai_ready` |
| `pr_agent_profiles` | `pr_agent_profiles` |
| `patron_realtime_decision_signals` | `gaming_realtime_decision_signals_ai_ready` |
| `table_state_snapshots` | `gaming_table_state` |
| `table_state_history` | `gaming_table_state_history` |
| `table_round_history` | `gaming_player_round_bets` |
| `table_round_counters` | `gaming_table_round_counters` |
| `table_minbet_audit` | `gaming_table_minbet_audit` |
| `table_minbet_recommendations` | `gaming_table_minbet_recommendations` |

AI 面板环境变量至少需要：

```dotenv
TAPDATA_API_BASE_URL=http://<tapdata-api-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
TAPDATA_TOKEN_URL=http://<tapdata-manager-host>:3030/oauth/token
TAPDATA_CLIENT_ID=<oauth-client-id>
TAPDATA_CLIENT_SECRET=<oauth-client-secret>
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_DEMO_FALLBACK=false
```

`TAPDATA_FIND_PATH_TEMPLATE` 不要多写一个 `}`。错误写法会生成 `%7D`，导致 404。修改 `.env.local` 后必须重启面板进程。

## 7. AI 面板怎么启动和停止

### 从 Git 拉取到启动

如果还没有代码，先执行：

```bash
git clone --branch codex/docker-demo-kit --single-branch \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
```

如果已经有本地副本，先更新：

```bash
git switch codex/docker-demo-kit
git pull --ff-only origin codex/docker-demo-kit
```

然后配置服务端环境变量并启动开发面板：

```bash
cp .env.example .env.local
chmod 600 .env.local
# 编辑 .env.local，填写 TapData API、OAuth 和 AI 配置
npm install
npm run dev
```

打开 `http://localhost:3000`。默认端口是 3000；如端口被占用，先停止旧进程再启动。

停止前台面板：在运行 `npm run dev` 的终端按 `Ctrl+C`。

后台运行和停止：

```bash
screen -S ai_panel
npm run dev
# Ctrl+A，然后 D：退出 screen，但保持面板运行
screen -r ai_panel
# 重新进入后按 Ctrl+C 停止面板
screen -S ai_panel -X quit
```

生产式本地启动：

```bash
npm run build
npm start
```

生产式启动同样用 `Ctrl+C` 停止；如果放在 `screen` 中运行，使用 `screen -S ai_panel -X quit` 停止。

## 8. 接手验收顺序

```text
[ ] 拉取代码并安装依赖
[ ] 三库路径：执行 Oracle/MSSQL/PostgreSQL 三份 SQL
[ ] 三库路径：填写 .env.source-feeder 并通过 --dry-run
[ ] 三库路径：执行 --once，确认三个源库都有写入
[ ] TapData：确认 CDC、FDM/merge、MDM 都运行正常
[ ] TapData：确认发布 API 名称和 TAPDATA_COLLECTION_MAP 一致
[ ] 面板：填写 .env.local，启动 npm run dev
[ ] 浏览器：打开 localhost:3000，确认 fallback 按交接要求设置
[ ] 页面：检查总览、桌台热力图、Customer 360、AI Chat
```

## 9. 常见问题

### 面板 3000 端口拒绝连接

```bash
ps -ef | grep -E 'next|npm run dev' | grep -v grep
screen -ls
```

进程不存在就执行 `npm run dev`；如果已有旧进程，先停止旧进程再重启。

### TapData 返回 404 且 URL 有 `%7D`

检查：

```dotenv
TAPDATA_FIND_PATH_TEMPLATE=/api/v1/{collection}/find
```

并确认集合映射使用的是已发布 API 名，而不是源端表名。

### FDM 报缺少关联键

检查事件 after 中是否真的有 `gamingPlayerId` / `playerId`，以及 PG `crm_identity_links` 与 Oracle `GAMING_TABLE_SESSIONS` 的值是否一致。before 缺失不是根因，after 缺少 join key 才是关键问题。

### FDM/MDM 报唯一键冲突

检查源端是否产生重复业务主键，确认目标表的主键和 FDM 配置一致。不要为了绕过错误直接删除源数据或盲目改主键。

### 造数脚本有写入，但面板不动

数据必须依次经过 CDC、FDM/merge、MDM 和已发布 API。先查 feeder 日志，再查 TapData 任务日志和 API 响应；确认面板不是 fallback 或缓存数据，并在修改 `.env.local` 后重启面板。

### 安全要求

SQL、代码和模板可以通过 Git 交接；数据库密码、OAuth Secret、AI Key、License 和真实地址必须通过批准的安全渠道单独交接。
