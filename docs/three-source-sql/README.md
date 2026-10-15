# 三个关系型源库的实时造数交接包

这三份 SQL 以 scripts/realtime-source-feeder.mjs 当前实现为准，创建它直接写入的源表并插入一组可重复执行的基线数据。长期造数脚本仍然是仓库中的 scripts/realtime-source-feeder.mjs，SQL 文件不包含数据库密码。

## 文件

- oracle_c##gaming_realtime_bootstrap.sql：Oracle schema C##GAMING，7 张 feeder 直接写入的表。
- mssql_casino_ops_realtime_bootstrap.sql：SQL Server 数据库 casino_ops、schema dbo，当前环境使用的 9 张业务表（含 3 张 *_ai_ready 表）。
- postgres_casino_loyalty_realtime_bootstrap.sql：PostgreSQL schema casino_loyalty，5 张 feeder 直接写入的表。

Oracle 表：GAMING_PLAYER_ACCOUNT、GAMING_PLAYER_RATINGS、GAMING_TABLE_STATE、GAMING_TABLE_STATE_HISTORY、GAMING_TABLE_SESSIONS、GAMING_PLAYER_ROUND_BETS、GAMING_TABLE_ROUND_COUNTERS。
MSSQL 表：hotel_stays、responsible_play_cases、host_assignments、room_inventory、pr_agent_profiles、ops_alert_rules、host_assignments_ai_ready、responsible_play_cases_ai_ready、ops_patron_alerts_ai_ready。
PostgreSQL 表：crm_identity_links、crm_patron_profiles、app_activity_events、pos_fnb_checks、crm_offer_responses。

## 执行顺序

1. 先在目标数据库分别执行对应 SQL 文件。SQL 使用幂等 DDL 和 MERGE/ON CONFLICT，可重复执行。
2. 再把仓库中的 scripts/realtime-source-feeder.mjs 和 .env.source-feeder 按同事环境填写。MSSQL 端口由环境变量 MSSQL_PORT 控制；当前演示环境是 2433。
3. 在仓库根目录启动长期造数，例如：

   node scripts/realtime-source-feeder.mjs --scenario=mixed --interval=3000 --batch-size=5 --duration-hours=72

## 说明

这些文件只覆盖当前长期 feeder 直接维护的源表，不包含 FDM/MDM 目标表，也不包含仓库旧的 15+ 全量种子脚本中未被当前 feeder 写入的营销、聊天和分析辅助表。这样可以避免把旧字段或旧主键混入同事环境。若同事还要复刻完整 AI 面板的 FDM/MDM 任务，应另外导入对应目标端建表或由 TapData 自动建表。
