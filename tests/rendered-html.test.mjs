import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function fetchWorker(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the menu-first AI operations console", async () => {
  const response = await fetchWorker("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /AI 决策工作台/);
  assert.match(html, /实时运营总览/);
  assert.match(html, /总览大盘/);
  assert.match(html, /桌台热力图/);
  assert.match(html, /AI Chat/);
  assert.match(html, /客户 360/);
  assert.match(html, /场景工坊/);
  assert.match(html, /数据模拟器/);
  assert.match(html, /热门桌台/);
  assert.match(html, /区域热度/);
  assert.match(html, /告警中心/);
  assert.match(html, /product-console/);
  assert.doesNotMatch(html, /workspace-grid/);
});

test("AI chat queries simulated collections when live credentials are absent", async () => {
  const response = await fetchWorker("/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "为什么 TEST-S2-P1 现在值得关注？",
      locale: "zh-Hans",
      context: { experience: "moment", patronId: "TEST-S2-P1", tableId: "T-0001" },
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.mode, "demo");
  assert.equal(payload.provider, "simulated-agent");
  assert.match(payload.answer, /模拟数据事实/);
  assert.match(payload.answer, /23,520/);
  assert.ok(payload.sources.some((source) => source.collection === "patron_table_sessions" && source.count === 1));
});

test("keeps delivery governed and connection secrets out of the client", async () => {
  const [page, commandCenter, route, css, runbook] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/command-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/chat/route.ts", import.meta.url), "utf8"),
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
  assert.match(commandCenter, /setInterval\(\(\) => void loadLivePatrons\(\), 3_000\)/);
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
