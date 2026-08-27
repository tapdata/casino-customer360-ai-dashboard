import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps the menu-first AI operations console source intact", async () => {
  const [page, commandCenter] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/command-center.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AI 决策工作台/);
  assert.match(commandCenter, /即時營運總覽/);
  assert.match(commandCenter, /總覽大盤/);
  assert.match(commandCenter, /桌台熱力圖/);
  assert.match(commandCenter, /AI Chat/);
  assert.match(commandCenter, /客戶 360/);
  assert.match(commandCenter, /場景工坊/);
  assert.match(commandCenter, /數據模擬器/);
  assert.match(commandCenter, /熱門桌台/);
  assert.match(commandCenter, /區域熱度/);
  assert.match(commandCenter, /告警|警示|Alerts/);
  assert.match(commandCenter, /product-console/);
  assert.doesNotMatch(commandCenter, /workspace-grid/);
});

test("is prepared for Vercel / Next.js deployment", async () => {
  const [pkg, envCloud, vercelDoc, auditRoute] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../.env.cloud.example", import.meta.url), "utf8"),
    readFile(new URL("../VERCEL_DEPLOYMENT.md", import.meta.url), "utf8"),
    readFile(new URL("../app/api/audit/events/route.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(pkg.scripts.dev, "next dev -p 3000");
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts.start, "next start -p 3000");
  assert.match(String(pkg.dependencies.next), /^\^16\./);
  assert.match(envCloud, /AI_PROVIDER=deepseek/);
  assert.match(envCloud, /MONGO_AUDIT_HTTP_URL=/);
  assert.doesNotMatch(envCloud, /MONGO_AUDIT_HTTP_URL=http:\/\/127\.0\.0\.1/);
  assert.match(vercelDoc, /Framework Preset \| Next\.js/);
  assert.match(vercelDoc, /Leave `MONGO_AUDIT_HTTP_URL` empty on Vercel/);
  assert.match(auditRoute, /runtime = "nodejs"/);
  assert.match(auditRoute, /MongoClient/);
  assert.match(auditRoute, /insertOne/);
});

test("keeps delivery governed and connection secrets out of the client", async () => {
  const [page, commandCenter, route, auditRoute, css, runbook] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/command-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/audit/events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../artifacts/tapdata-ai-scenario-runbook.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const mongoSnapshots/);
  assert.match(page, /dispatchNotification/);
  assert.match(page, /kind === "risk" \? t\.riskAdministrator/);
  assert.match(page, /风险值班管理员 · ADM-01/);
  assert.match(page, /openPulseDetail/);
  assert.match(page, /className="pulse-modal"/);
  assert.match(page, /<textarea value=\{currentHostMessage\}/);
  assert.match(page, /restoreHostMessage/);
  assert.match(page, /copyHostMessage/);
  assert.match(page, /toggleAlternativeStatus/);
  assert.match(page, /resetAlternativeStatuses/);
  assert.match(page, /aria-label=\{`\$\{t\.changeActionStatus\}/);
  assert.match(page, /useState\(true\)/);
  assert.match(page, /disabled=\{!recommendationApproved\}/);
  assert.match(page, /recommendationAlreadySent/);
  assert.match(page, /recommendationFingerprint/);
  assert.match(page, /DeliveryChannel/);
  assert.doesNotMatch(page, /mongodb\+srv:\/\//);
  assert.doesNotMatch(page, new RegExp(["Abcd", "1234"].join("")));
  assert.match(commandCenter, /\/api\/ai\/chat/);
  assert.match(commandCenter, /mogo-simulated-sessions/);
  assert.match(commandCenter, /scenarioTemplates/);
  assert.match(commandCenter, /LOCAL SIMULATION LAYER/);
  assert.match(commandCenter, /ENTER 提交/);
  assert.match(commandCenter, /customer-filter-popover/);
  assert.match(commandCenter, /客户筛选/);
  assert.match(commandCenter, /setInterval\(\(\) => void loadLivePatrons\(\), 8_000\)/);
  assert.match(commandCenter, /refreshInFlightRef/);
  assert.match(commandCenter, /patron_realtime_decision_signals/);
  assert.match(commandCenter, /scenarioCdcPayload/);
  assert.match(commandCenter, /TapData 聚合表/);
  assert.match(commandCenter, /真实 CDC \+ 聚合实操流程/);
  assert.match(commandCenter, /P0000100861/);
  assert.match(commandCenter, /\/api\/v1\/patron_realtime_decision_signals\/find/);
  assert.match(commandCenter, /responsible_play_cases_ai_ready/);
  assert.match(commandCenter, /prepareDemoRunbook/);
  assert.match(commandCenter, /handlePromptKeyDown/);
  assert.match(commandCenter, /SHIFT\+ENTER/);
  assert.match(commandCenter, /tableAiInsights/);
  assert.match(commandCenter, /TABLE AI ANALYSIS/);
  assert.match(route, /allowedCollections/);
  assert.match(route, /patron_realtime_decision_signals/);
  assert.match(route, /get_decision_signal/);
  assert.match(route, /simulated-agent/);
  assert.match(route, /\/responses/);
  assert.match(route, /function_call_output/);
  assert.doesNotMatch(route, /mongodb\+srv:\/\//);
  assert.doesNotMatch(route, new RegExp(["Abcd", "1234"].join("")));
  assert.doesNotMatch(auditRoute, /mongodb\+srv:\/\//);
  assert.doesNotMatch(auditRoute, new RegExp(["Abcd", "1234"].join("")));
  assert.match(css, /\.mongo-evidence-card/);
  assert.match(css, /\.notification-popover/);
  assert.match(css, /\.delivery-panel\.ready/);
  assert.match(css, /\.delivery-toast/);
  assert.match(css, /\.pulse-modal-backdrop/);
  assert.match(css, /\.host-message textarea/);
  assert.match(css, /\.alternative-status\.eligible/);
  assert.match(css, /\.alternative-status\.blocked/);
  assert.match(css, /V5 .*bright demo console/);
  assert.match(css, /\.scenario-workbench/);
  assert.match(css, /\.demo-runbook-panel/);
  assert.match(css, /\.table-ai-panel/);
  assert.match(css, /\.node-ai-hint/);
  assert.match(css, /#ffffff/);
  assert.match(runbook, /TapData \+ AI 场景演示 Runbook/);
  assert.match(runbook, /patron_realtime_decision_signals/);
  assert.match(runbook, /patron_table_sessions/);
  assert.match(runbook, /AI 面板演示流程/);
});
