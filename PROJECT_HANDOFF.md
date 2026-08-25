# AI Loyalty Engine Demo — 项目交接上下文

最后更新：2026-08-20  
项目本地路径：`/Users/yangshikun/Documents/ChatGPT/Mogo Demo`

> 给下一位 AI / 工程师的说明：这是一个用于澳门客户现场 Demo 的本地 AI 面板项目。目标是展示 `Source → TapData CDC / 聚合 → MongoDB → AI 决策面板 → 治理审批 / 通知 / 审计闭环`。请先读本文件，再改代码。

## 1. 一句话业务目标

在 VIP 仍在桌上的当下，实时识别其价值、行为与需求，及时提供个性化关怀与优惠；并在 AI 推荐之上加一层 Trusted / Governed 治理，确保推荐经过风控、审批、留痕后才触达客户。

演示重点不是“一个静态看板”，而是：

1. TapData 把实时变更同步或聚合到 MongoDB。
2. AI 面板每 3 秒读取 TapData 发布的 API。
3. 大盘、桌台热力图、客户 360、AI Chat 看到真实数据变化。
4. AI 生成下一步建议。
5. 健康客户走治理审批；风险客户走风险拦截与管理员告警。
6. 发送 / 审批 / 闭环动作写入 MongoDB 审计库。

## 2. 本地启动方式

进入项目：

```bash
cd "/Users/yangshikun/Documents/ChatGPT/Mogo Demo"
```

启动：

```bash
npm run dev
```

注意：不要直接运行 `vinext dev`。  
`npm run dev` 会额外启动两个本地桥：

- OpenAI 本地代理桥：用于本地网络需要代理时访问 GPT。
- Mongo 审计写入桥：用于把发送、审批、告警闭环动作写入 MongoDB。

启动成功时，应能看到类似：

```text
Local Mongo audit bridge ready on http://127.0.0.1:8790
```

如果页面提示：

```text
Mongo 写入桥未启动，请重启 npm run dev
```

通常表示旧服务没重启，或者不是通过 `npm run dev` 启动。

## 3. 重要文件

| 文件 | 作用 |
|---|---|
| `app/page.tsx` | 旧版/审批工作台主页面，包含客户分析、推荐、发送、风险告警、审计提示 |
| `app/command-center.tsx` | 新版菜单式 AI 面板：总览、桌台热力图、AI Chat、客户 360、场景工坊、数据模拟器 |
| `app/api/data/patrons/route.ts` | 服务端读取 TapData API，聚合客户、Session、风险、推荐等数据给前端 |
| `app/api/ai/chat/route.ts` | GPT / DeepSeek 兼容 AI Chat，使用白名单工具查询 TapData 发布 API |
| `app/api/audit/events/route.ts` | 前端动作审计 API，转发到本地 Mongo 审计写入桥 |
| `scripts/dev.mjs` | 本地 dev 启动器，负责启动 AI relay、Mongo audit bridge、vinext dev |
| `scripts/mongo-audit-bridge.mjs` | Node MongoDB 写入桥，真正使用 MongoDB driver 写审计库 |
| `.env.local` | 本地真实密钥配置，已存在，不要提交，不要把密钥写到文档 |
| `.env.example` | 环境变量模板 |
| `README.md` | 原始项目说明 |

## 4. 环境变量与密钥

真实密钥已经写在 `.env.local`，不要明文复制到其他文档或提交。

关键变量：

```env
OPENAI_API_KEY=...
AI_BASE_URL=...

TAPDATA_API_BASE_URL=http://<tapdata-api-host>:3080
TAPDATA_FIND_PATH_TEMPLATE=/api/v2/{collection}/find
TAPDATA_TOKEN_URL=http://<tapdata-token-host>:3030/oauth/token
TAPDATA_CLIENT_ID=...
TAPDATA_CLIENT_SECRET=...
TAPDATA_TOKEN_AUTH_METHOD=client_secret_post
TAPDATA_SCAN_LIMIT=1000

MONGO_AUDIT_HOST=<mongo-host>:27017
MONGO_AUDIT_USER=<mongo-user>
MONGO_AUDIT_PASSWORD=...
MONGO_AUDIT_AUTH_DB=<auth-db>
MONGO_AUDIT_AUTH_MECHANISM=SCRAM-SHA-256
MONGO_AUDIT_DB=ai_loyalty_engine
MONGO_AUDIT_COLLECTION=ai_action_events
LOCAL_AUDIT_RELAY_PORT=8790
MONGO_AUDIT_HTTP_URL=http://127.0.0.1:8790
```

Mongo 注意点：

- 认证机制必须是 `SCRAM-SHA-256`。
- 已验证真实 Mongo 可写入。
- 审计库默认：`ai_loyalty_engine`
- 审计集合默认：`ai_action_events`
- 本地页面不直接使用 MongoDB driver；通过 `scripts/mongo-audit-bridge.mjs` 写库，避免 Sites / Worker 运行时打包 `mongodb` 时报 `punycode/require` 错误。

## 5. TapData 已发布 API 的表

用户表示 21 张表都已发布 API，路径规则为：

```text
POST /api/v2/{collection}/find
GET  /api/v2/{collection}/
```

当前核心表：

```text
alert_rules
campaign_runs
chat_messages
chat_sessions
offer_approval_audit
offer_catalog
offer_recommendations
patron_activity_events
patron_alerts
patron_analysis_reports
patron_interaction_history
patron_profiles
patron_risk_cases
patron_table_sessions
pr_agent_profiles
pr_assignments
table_minbet_audit
table_minbet_recommendations
table_round_counters
table_round_history
table_state_history
table_state_snapshots
patron_realtime_decision_signals
```

说明：`patron_realtime_decision_signals` 是后来新增的 TapData 聚合结果表，用于 Demo 展示“多表聚合后给 AI 读一张决策信号表”。

## 6. 当前页面能力

### 6.1 菜单式 AI 面板

位置：`app/command-center.tsx`

左侧菜单包括：

- 总览大盘
- 桌台热力图
- AI Chat
- 客户 360
- 场景工坊
- 数据模拟器

用户明确要求不要把三个模块堆在同一页，所以新版采用左侧菜单分模块。

### 6.2 总览大盘

读取真实 TapData API 数据，展示：

- 桌台总数
- 在场客户
- 风险客户
- 最热区域
- 热门桌台
- 实时桌台缩略图

前端自动刷新：每 3 秒一次。

### 6.3 桌台热力图

根据 `patron_table_sessions` 等数据聚合桌台状态：

- occupancy
- active patrons
- session wager
- risk signals
- VIP 数
- 热门 / 风险 / 关闭状态

已实现交互：

- 点击桌台卡片后，不再在页面底部展开大面板。
- 现在会在页面中央弹出“桌台 AI 分析”小弹窗。
- 点击空白区域关闭。
- 按 `Esc` 关闭。
- 弹窗中可点击“打开 AI Chat 深入分析”。

### 6.4 AI Chat

位置：`app/api/ai/chat/route.ts`

AI Chat 已实现真实 GPT / OpenAI 兼容接口调用逻辑。

支持：

- 查询客户
- 查询 Session
- 查询桌台
- 查询优惠
- 查询风险
- 查询 `patron_realtime_decision_signals`

重点规则：

- 对于 next-best-action、offer、governance、scenario-demo 问题，优先使用 `get_decision_signal`。
- `get_decision_signal` 读取 `patron_realtime_decision_signals`。
- 如果 live API 不可用，会退回模拟数据。

### 6.5 客户 360

支持：

- 搜索客户
- 筛选客户
- 查看客户画像、等级、地区、偏好、实时 Session、风险状态
- 展示 Trusted Next Best Action
- 展示治理流程：
  1. AI 生成建议
  2. 治理校验 / 风险管控
  3. 主管审批
  4. WhatsApp 触达

重要逻辑已修正：

- 状态良好的客户不再显示“风险提示管控”。
- 健康客户显示“治理校验通过 / 待主管审批”。
- 风险客户才显示“风险管控 / 治理拦截”。
- `LateNight` 不再被当作风险，只作为“服务提醒：深夜在场”。
- 客户一选中就会基于画像/实时 Session/积分/偏好/风险规则生成当前推荐，不再显示空的“运行 AI 生成下一步建议”。
- 无风险客户的顶部弹窗不再提供“发送风险告警”，而是显示“治理中心 / 当前没有待处理风险告警”。
- 推荐动作有生命周期控制：同一个客户、同一条推荐、同一组关键数据已经发送后，只显示“已推荐”回执，不再重复显示批准/发送按钮；当客户状态、桌台、投注、风险或推荐内容变化导致 recommendation fingerprint 变化时，才重新出现可推荐动作。
- 真实风险触发条件包括：
  - `activeRiskCount > 0`
  - `CardCounterWatch`
  - `Aggressive`
  - `HighVariance`
  - `ResponsiblePlay`
  - `SelfExcluded`
  - `RG-*`

### 6.6 场景工坊

当前状态：已实现“场景模板 + 演示脚本 + 本地注入”，但还没有完全实现“TapData 一更新数据，场景工坊自动识别并点亮场景”。

当前 6 个场景：

| 场景 | trigger | 说明 |
|---|---|---|
| 高价值客户回流 | `high_value_return` | 沉睡 VIP 回来，推荐非博彩礼遇 |
| 桌台拥堵预警 | `zone_b_capacity_pressure` | 区域拥挤，建议调度 |
| 风险升级与人工接管 | `responsible_play_review` | 拦截刺激型优惠，通知管理员 |
| 优惠疲劳识别 | `offer_fatigue` | 降低触达频率 |
| 客户经理跟进超时 | `host_followup_overdue` | 生成客户经理任务 |
| 数据质量异常 | `impossible_occupancy` | 展示数据质量 / 治理能力 |

目前用户问过：“只要我在 TapData 更新数据，就可以看到效果吗？”  
准确回答：

- 总览、热力图、客户 360、AI Chat：可以通过真实 API 看到效果。
- 场景工坊：目前不会自动根据 `patron_realtime_decision_signals` 点亮对应场景；需要下一步实现“实时场景识别”。

建议下一步开发：

1. 新增 `/api/data/scenario-signals`，读取 `patron_realtime_decision_signals`。
2. 前端每 3 秒读取该接口。
3. 根据 `triggerType` / `scenarioType` / `recommendedAction` 匹配 6 个场景。
4. 场景卡显示：
   - 已识别
   - 来自 TapData 聚合表
   - 涉及 patronId / tableId
   - riskScore / opportunityScore
   - recommendedAction
   - governanceDecision
5. 点击场景时展示真实聚合记录，而不是模板 JSON。

这样现场故事会变成：

```text
TapData CDC 更新源表
→ TapData 聚合目标表 patron_realtime_decision_signals
→ AI 面板 3 秒内识别场景
→ 场景工坊点亮
→ AI Chat 解释证据和下一步动作
→ 审批 / WhatsApp / Mongo 审计闭环
```

### 6.7 数据模拟器

用于本地排练，不写入 MongoDB 业务表。

作用：

- 手动造一个 Session
- 立即影响前端大盘和热力图
- 安全排练 Demo，不污染真实业务数据

注意：这不是 TapData CDC 写入，只是浏览器 localStorage 层的模拟数据。

## 7. 审计闭环

页面动作会调用：

```text
POST /api/audit/events
```

再由本地桥写入：

```text
MongoDB: ai_loyalty_engine.ai_action_events
```

已支持动作：

```text
risk_alert_sent
risk_alert_closed
recommendation_approved
recommendation_rejected
recommendation_sent
```

用户曾经反馈点击“发送 WhatsApp”后没闭环。现在逻辑是：

- 发送成功后显示已发送。
- 审计写入成功则提示 `Mongo 已落库`。
- 如果桥没启动，则提示 `Mongo 写入桥未启动，请重启 npm run dev`。
- 如果未配置，才提示 `Mongo 未配置，前端仅展示状态`。

## 8. 已知设计偏好

用户明确偏好：

- 页面要清晰，不要暗到看不清。
- 字体要大一些。
- 模块必须拆菜单，不要堆在一个页面。
- 中文可用简体 / 繁体 / 英文国际化。
- AI 部分要有故事，不只是数据列表。
- Demo 要能讲出 TapData CDC、聚合、MongoDB、AI 决策、治理审批、通知闭环。
- 桌台热力图要能点击进入 AI 分析。
- AI Chat 要真实可以调用 AI 查询 Mongo/TapData 数据。
- 健康客户不要说“风险管控”，要说“治理审批 / 合规留痕”。

## 9. 当前回归状态

最近一次验证：

```bash
npm test
npm run lint
```

结果：通过。

`npm test` 包含：

- 构建
- 服务端渲染测试
- AI Chat 模拟集合测试
- 密钥不下发到客户端测试

## 10. 如果下一位 AI 要继续开发，建议优先做什么

第一优先级：实现“场景工坊实时识别 TapData 聚合表”。

建议任务拆法：

1. 新增 `app/api/data/scenario-signals/route.ts`
   - 读取 `patron_realtime_decision_signals`
   - 支持 filter by `triggerType`、`patronId`、`tableId`
   - 返回最近 N 条真实聚合信号

2. 修改 `app/command-center.tsx`
   - 增加 `scenarioSignals` state
   - 复用 3 秒自动刷新
   - 场景工坊左侧列表显示 live badge
   - 右侧展示真实 signal record
   - 如果没有真实 signal，继续展示模板

3. AI Chat 入口
   - 点击真实 signal 后，把 prompt 预填成：

```text
请基于 patron_realtime_decision_signals 分析 triggerType=xxx 的场景：
客户 xxx，桌台 xxx。请说明触发原因、证据来源、AI 判断、治理策略和下一步动作。
```

4. 回归测试

```bash
npm test
npm run lint
```

## 11. 不要做的事

- 不要把 `.env.local` 的真实密钥写入 README、交接文档或提交。
- 不要把 MongoDB driver 直接 import 到前端 API route 中，避免 Worker / Sites 运行时报 `punycode/require`。
- 不要把健康客户标成风险。
- 不要把场景工坊说成“已经完全自动识别”，目前还没做完这一层。
- 不要直接运行 `vinext dev` 替代 `npm run dev`，否则 Mongo 审计桥不会启动。
