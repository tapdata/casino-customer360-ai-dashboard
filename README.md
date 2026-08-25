# AI Loyalty Engine Command Center

面向赌场忠诚度与场面运营演示的 AI 决策工作台。页面包含客户关键时刻、桌台热力图、营销活动 Copilot、风险告警，以及可追溯数据来源的 AI Chat。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。未配置外部接口时，Chat 会自动使用字段结构与未来 TapData 集合一致的模拟数据，真实执行“识别意图 → 查询模拟集合 → 聚合规则 → 返回证据”，并在回答中标注 `SIMULATED DATA`。

## 接入 DeepSeek AI 与 TapData

复制 `.env.example` 为 `.env.local`，然后配置：

- `AI_PROVIDER`: 云上 Demo 推荐 `deepseek`
- `AI_MODEL`: 默认 `deepseek-chat`；如果你的 DeepSeek 控制台提供更新模型，可按实际可用模型名切换
- `DEEPSEEK_API_KEY`: 只存放在服务端，绝不能写入浏览器代码
- `AI_BASE_URL`: DeepSeek 默认 `https://api.deepseek.com`
- `LOCAL_AI_PROXY`: 可选，本地网络需要代理时填写，例如 `http://127.0.0.1:1082`；`npm run dev` 会启动仅监听回环地址的转发层
- `LOCAL_AI_RELAY_PORT`: 可选，本地转发端口，默认 `8789`
- `TAPDATA_API_BASE_URL`: TapData 发布服务的根地址
- `TAPDATA_FIND_PATH_TEMPLATE`: 集合查询路径模板，例如当前 MDM 发布路径 `/api/v1/{collection}/find`
- `TAPDATA_COLLECTION_MAP`: 可选，逻辑集合名到 MDM 发布服务名的映射；例如 `{"patron_risk_cases":"responsible_play_cases_ai_ready","offer_recommendations":"ai_offer_recommendations_src","patron_realtime_decision_signals":"gaming_realtime_decision_signals_ai_ready"}`
- `TAPDATA_TOKEN_URL`、`TAPDATA_CLIENT_ID`、`TAPDATA_CLIENT_SECRET`: OAuth2 Client Credentials，服务端自动获取并缓存短期 Token
- `TAPDATA_TOKEN_AUTH_METHOD`: `client_secret_post`（默认）或 `client_secret_basic`
- `TAPDATA_ACCESS_TOKEN`: 可选，仅用于本地临时调试的固定 Bearer Token
- `TAPDATA_SCAN_LIMIT`: 当已发布接口忽略 `filter` 时，本地安全过滤所扫描的最大记录数；演示默认 `1000`，生产大数据量应在 API 端完成过滤

配置完整后，`POST /api/ai/chat` 会自动切换到 Live 模式。DeepSeek 分支使用 Chat Completions 与工具调用；模型不能直接访问 MongoDB，只能调用服务端白名单工具，工具再向 TapData 发布 API 发起只读查询。

`LOCAL_AI_PROXY` 只用于本地开发，解决本机网络出口问题。云服务器部署时不要设置该变量，服务端会直接请求 `AI_BASE_URL`。

```text
Browser → /api/ai/chat → DeepSeek
                         ↓ controlled tool call
                     TapData API → MongoDB
```

当前白名单覆盖客户画像、活跃 Session、桌台状态/历史/轮次、互动历史、推荐、风险与告警集合。正式部署时建议使用短期 Token 或 OAuth2 自动刷新，不要把密钥放进浏览器代码。

## AI 面板动作持久化

AI 面板的“发送风险告警”“标记已处理”“发送推荐”会调用 `POST /api/audit/events`，把动作闭环写入 MongoDB。本地开发时 `npm run dev` 会自动启动一个 Node 审计桥，由审计桥使用 MongoDB driver 写库，避免 Sites/Worker 运行时直接打包 MongoDB driver。数据库会在第一次写入时自动创建，默认库名和集合名为：

- Database: `ai_loyalty_engine`
- Collection: `ai_action_events`

`.env.local` 需要增加：

```bash
MONGO_AUDIT_HOST=<mongo-host>:27017
MONGO_AUDIT_USER=<mongo-user>
MONGO_AUDIT_PASSWORD=你的密码
MONGO_AUDIT_AUTH_DB=<auth-db>
MONGO_AUDIT_AUTH_MECHANISM=SCRAM-SHA-256
MONGO_AUDIT_DB=ai_loyalty_engine
MONGO_AUDIT_COLLECTION=ai_action_events
LOCAL_AUDIT_RELAY_PORT=8790
```

如果你更喜欢 URI，也可以只配置 `MONGO_AUDIT_URI`。前端不会拿到 Mongo 密码；所有写入都经过服务端 API 和本地审计桥完成。

## 验证

```bash
npm run build
npm test
npm run lint
```
