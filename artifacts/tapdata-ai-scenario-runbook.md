# TapData + AI 场景演示 Runbook

## 1. 演示目标

把这次 Demo 讲成一条线：

Source 变更进入 TapData CDC，TapData 生成聚合结果表，AI 面板读取聚合结果表并解释为什么要行动，最后由客户经理或管理员确认发送。

## 2. 建议模拟的 TapData 聚合结果表

表名建议：

```text
patron_realtime_decision_signals
```

这张表不是业务源表，而是 TapData 把多张表聚合后的 AI 决策输入表。AI 不需要每次自己拼很多表，可以优先读这张结果表，再按需钻取明细。

来源集合：

```text
patron_table_sessions
patron_profiles
patron_risk_cases
offer_recommendations
offer_catalog
table_state_snapshots
patron_activity_events
```

核心字段：

```json
{
  "signalId": "SIG-VIP-RETURN-001",
  "signalType": "high_value_return",
  "patronId": "SCN-VIP-RETURN",
  "tableId": "T-0018",
  "tier": "Diamond",
  "sessionBetAmount": 18800,
  "currentStackEstimate": 52000,
  "behaviorTags": ["PromoSeeker"],
  "activeRiskCount": 0,
  "riskScore": 61,
  "recommendedAction": "套房升级 + 延迟退房",
  "governanceAction": "允许发送 WhatsApp，需记录成本",
  "sourceCollections": [
    "patron_table_sessions",
    "patron_profiles",
    "patron_risk_cases",
    "offer_recommendations",
    "table_state_snapshots"
  ],
  "updatedAt": "2026-08-20T14:03:00.000Z"
}
```

## 3. TapData 演示流程

1. 打开 TapData，展示源端表到 MongoDB 目标端的 CDC 链路。
2. 准备一个模拟变更，写入或更新 `patron_table_sessions`。
3. 展示 TapData 将变更同步到 MongoDB。
4. 展示 TapData 聚合任务，把多表数据写入 `patron_realtime_decision_signals`。
5. 发布 `patron_realtime_decision_signals/find` API。
6. 回到 AI 面板，进入“场景工坊”，选择对应场景。

可使用的 CDC 模拟输入：

```json
{
  "targetCollection": "patron_table_sessions",
  "operation": "upsert",
  "filter": {
    "patronId": "SCN-VIP-RETURN",
    "isActive": true
  },
  "document": {
    "patronId": "SCN-VIP-RETURN",
    "tableId": "T-0018",
    "seatedAt": "2026-08-20T14:00:00.000Z",
    "lastActionAt": "2026-08-20T14:03:00.000Z",
    "sessionBetAmount": 18800,
    "currentStackEstimate": 52000,
    "behaviorTags": ["PromoSeeker"],
    "isActive": true
  }
}
```

## 4. AI 面板演示流程

1. 进入“场景工坊”。
2. 选择一个场景，例如“高价值客户回流”。
3. 指给客户看中间的 TapData 聚合结果表，说明这是 CDC 聚合后的 AI 输入。
4. 点击“注入场景并准备 AI”。
5. 点击“打开 AI Chat”。
6. 运行已经自动填入的问题。
7. 展示 AI 返回的数据证据、判断、治理约束和下一步动作。

建议 AI 输入：

```text
请基于 TapData 聚合表 patron_realtime_decision_signals 分析场景“高价值客户回流”：触发原因 high_value_return，客户 SCN-VIP-RETURN，桌台 T-0018。请给出数据证据、AI判断、治理约束和下一步动作。
```

## 5. 推荐现场故事

第一段讲 TapData：

“我们不是把 AI 直接接到一堆原始表上，而是先通过 TapData CDC 把实时 Session、客户画像、风险案例和优惠响应聚合成一张 AI 决策表。”

第二段讲 AI：

“AI 读取这张聚合结果表后，不只是回答客户是谁，而是解释为什么现在值得关注、能不能发优惠、应该发什么、谁来审批。”

第三段讲治理：

“如果是风险场景，AI 不会直接推荐刺激型优惠，而是拦截并通知管理员。这样 Demo 不只是智能推荐，也是可治理的智能决策。”
