"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readLivePatronSnapshot, writeLivePatronSnapshot } from "./live-patron-cache";

type Locale = "zh-Hans" | "zh-Hant" | "en";
type Experience = "moment" | "floor" | "campaign" | "risk";
type CommandView = "overview" | "floor" | "chat" | "customer" | "scenarios" | "simulate";

type ChatSource = { collection: string; count: number };
type ChatReply = {
  answer?: string;
  error?: string;
  mode?: "demo" | "live";
  provider?: string;
  model?: string;
  steps?: string[];
  sources?: ChatSource[];
};

async function readChatReply(response: Response): Promise<ChatReply> {
  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return { error: `AI request failed (HTTP ${response.status})` };
  }

  try {
    const parsed = JSON.parse(trimmed) as ChatReply;
    return parsed && typeof parsed === "object"
      ? parsed
      : { error: String(parsed) };
  } catch {
    // Vercel/Reverse-proxy failures can be plain text or HTML. Preserve the
    // useful upstream message instead of masking it with “Unexpected token”.
    const detail = trimmed.replace(/\s+/g, " ").slice(0, 500);
    return { error: `AI request failed (HTTP ${response.status}): ${detail}` };
  }
}

type Message = {
  role: "assistant" | "user";
  content: string;
  mode?: "demo" | "live";
  sources?: ChatSource[];
  steps?: string[];
};

type LivePatron = {
  patronId: string;
  maskedName: string;
  tier: string;
  region: string;
  adt: number;
  pointsBalance: number;
  preferredGames: string[];
  riskFlags: string[];
  lastActiveAt: string | null;
  lastHotelBenefitAt: string | null;
  activeSession: {
    tableId: string;
    seatedAt: string | null;
    lastActionAt: string | null;
    sessionBetAmount: number;
    currentStackEstimate: number;
    behaviorTags: string[];
    isActive: boolean;
  } | null;
  activeRiskCount: number;
};

type SourceCounts = {
  patron_profiles: number;
  patron_table_sessions: number;
  patron_risk_cases: number;
  offer_recommendations: number;
  chat_messages: number;
};

type PatronRecommendation = {
  title: string;
  detail: string;
  confidence: number;
  estimatedCost: string;
  validity: string;
  governanceStatus: "blocked" | "pending" | "approved";
  governanceLabel: string;
  policyReason: string;
  evidence: string[];
  hostMessage: string;
};

type RecommendationWorkflowStatus = "pending" | "approving" | "approved" | "rejecting" | "rejected" | "sending" | "sent";

type AuditPersistResponse = {
  ok?: boolean;
  persisted?: boolean;
  eventId?: string;
  createdAt?: string;
  error?: string;
};

type TableNode = {
  id: string;
  zone: string;
  game: string;
  patrons: number;
  capacity: number;
  occupancy: number;
  minBet: number;
  turnover: number;
  vip: number;
  risks: number;
  state: "normal" | "opportunity" | "risk" | "ai" | "offline";
  trend: string;
};

type SimulatedSession = {
  id: string;
  patronId: string;
  tableId: string;
  sessionBetAmount: number;
  currentStackEstimate: number;
  behaviorTags: string[];
  isActive: boolean;
  createdAt: string;
  scenario?: string;
};

type ScenarioTemplate = {
  id: string;
  icon: string;
  title: string;
  detail: string;
  tableId: string;
  tags: string[];
  bet: number;
  stack: number;
  aggregateName: string;
  trigger: string;
  aiAction: string;
  governance: string;
};

type DemoRunbook = {
  id: string;
  title: string;
  badge: string;
  patronId: string;
  tableId: string;
  experience: Experience;
  summary: string;
  sourceMutation: string;
  tapdataChecks: string[];
  aiQuestion: string;
};

const tableMeta: Record<string, Pick<TableNode, "zone" | "game" | "capacity" | "minBet">> = {
  "T-0001": { zone: "A", game: "Poker", capacity: 25, minBet: 800 },
  "T-0002": { zone: "B", game: "Blackjack", capacity: 25, minBet: 500 },
  "T-0004": { zone: "B", game: "Baccarat", capacity: 25, minBet: 1000 },
  "T-0007": { zone: "A", game: "Sic Bo", capacity: 25, minBet: 800 },
  "T-0010": { zone: "A", game: "Roulette", capacity: 25, minBet: 500 },
  "T-0012": { zone: "C", game: "Blackjack", capacity: 25, minBet: 1000 },
  "T-0014": { zone: "B", game: "Blackjack", capacity: 25, minBet: 500 },
  "T-0018": { zone: "VIP", game: "Poker", capacity: 25, minBet: 1000 },
  "T-0019": { zone: "C", game: "Blackjack", capacity: 25, minBet: 800 },
  "T-0021": { zone: "B", game: "Poker", capacity: 25, minBet: 800 },
  "T-0022": { zone: "C", game: "Roulette", capacity: 25, minBet: 300 },
  "T-0026": { zone: "VIP", game: "Baccarat", capacity: 25, minBet: 300 },
  "T-0030": { zone: "B", game: "Blackjack", capacity: 25, minBet: 300 },
};

const experiences: Array<{ id: Experience; code: string }> = [
  { id: "moment", code: "01" },
  { id: "floor", code: "02" },
  { id: "campaign", code: "03" },
  { id: "risk", code: "04" },
];

const behaviorOptions = ["Aggressive", "Conservative", "PromoSeeker", "LateNight", "CardCounterWatch"];
const SIMULATION_SESSION_TTL_MS = 30 * 60 * 1000;

function tx(locale: Locale, hans: string, hant: string, en: string) {
  return locale === "en" ? en : locale === "zh-Hant" ? hant : hans;
}

function experienceName(locale: Locale, id: Experience) {
  return {
    moment: tx(locale, "客户关键时刻", "客戶關鍵時刻", "Customer Moment"),
    floor: tx(locale, "场面运营指挥官", "場面營運指揮官", "Floor Commander"),
    campaign: tx(locale, "营销活动 Copilot", "營銷活動 Copilot", "Campaign Copilot"),
    risk: tx(locale, "风险与告警", "風險與告警", "Risk & Alerts"),
  }[id];
}

function defaultPrompt(locale: Locale, id: Experience, patronId: string, tableId: string) {
  return {
    moment: tx(locale, `为什么 ${patronId} 现在值得关注？请列出真实数据证据。`, `為什麼 ${patronId} 現在值得關注？請列出真實數據證據。`, `Why does ${patronId} require attention now? Cite the live evidence.`),
    floor: tx(locale, `分析 ${tableId} 以及周边桌台，未来 30 分钟有哪些运营风险和机会？`, `分析 ${tableId} 以及周邊桌台，未來 30 分鐘有哪些營運風險和機會？`, `Analyze ${tableId} and nearby tables for the next 30 minutes.`),
    campaign: tx(locale, "查找当前活跃、ADT 较高且最近没有收到酒店礼遇的白金或钻石客户。", "查找目前活躍、ADT 較高且最近沒有收到酒店禮遇的白金或鑽石客戶。", "Find active high-ADT Platinum or Diamond patrons without a recent hotel benefit."),
    risk: tx(locale, "汇总当前尚未处理的高风险告警，并说明最需要管理员处理的三项。", "匯總目前尚未處理的高風險告警，並說明最需要管理員處理的三項。", "Summarize unresolved high-risk alerts and identify the top three requiring action."),
  }[id];
}

function freshSimulatedSessions(sessions: SimulatedSession[]) {
  const cutoff = Date.now() - SIMULATION_SESSION_TTL_MS;
  return sessions.filter((session) => {
    const createdAt = new Date(session.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
}

function tableAnalysisPrompt(locale: Locale, table: TableNode) {
  return tx(
    locale,
    `请分析 ${table.id} 当前桌台状态：游戏 ${table.game}，区域 ${table.zone}，占用率 ${table.occupancy}%，在场 ${table.patrons}/${table.capacity}，Session 投注 HKD ${table.turnover}，风险信号 ${table.risks}。请结合 table_state_snapshots、patron_table_sessions 和 patron_realtime_decision_signals 给出运营风险、机会和下一步动作。`,
    `請分析 ${table.id} 目前桌台狀態：遊戲 ${table.game}，區域 ${table.zone}，佔用率 ${table.occupancy}%，在場 ${table.patrons}/${table.capacity}，Session 投注 HKD ${table.turnover}，風險訊號 ${table.risks}。請結合 table_state_snapshots、patron_table_sessions 和 patron_realtime_decision_signals 給出營運風險、機會和下一步動作。`,
    `Analyze table ${table.id}: game ${table.game}, zone ${table.zone}, occupancy ${table.occupancy}%, patrons ${table.patrons}/${table.capacity}, session wager HKD ${table.turnover}, risk signals ${table.risks}. Use table_state_snapshots, patron_table_sessions and patron_realtime_decision_signals to return operational risks, opportunities and next actions.`,
  );
}

function tableAiInsights(locale: Locale, table: TableNode) {
  const first = table.patrons === 0
    ? tx(locale, "当前桌台空闲，可作为溢出容量或低压服务区。", "目前桌台空閒，可作為溢出容量或低壓服務區。", "This table is idle and can serve as overflow capacity or a low-pressure service area.")
    : table.occupancy >= 78
      ? tx(locale, "占用率已进入高位，应关注等待、荷官资源和最低投注策略。", "佔用率已進入高位，應關注等待、荷官資源和最低投注策略。", "Occupancy is high; monitor waiting time, dealer capacity and minimum-bet strategy.")
      : tx(locale, "桌台处于正常运营区间，可继续观察投注趋势。", "桌台處於正常營運區間，可繼續觀察投注趨勢。", "The table is operating normally; continue watching wager trends.");
  const second = table.risks > 0
    ? tx(locale, "存在风险信号，AI 深入分析应优先检查活跃客户与优惠治理。", "存在風險訊號，AI 深入分析應優先檢查活躍客戶與優惠治理。", "Risk signals are present; deeper AI analysis should check active patrons and offer governance first.")
    : tx(locale, "暂无活动风险信号，适合从服务机会和容量优化角度分析。", "暫無活動風險訊號，適合從服務機會和容量優化角度分析。", "No active risk signal; analysis can focus on service opportunity and capacity optimization.");
  const third = table.turnover > 0
    ? tx(locale, `当前 Session 投注约 HKD ${money(table.turnover, locale)}，建议结合最近 30 分钟趋势判断是否升温。`, `目前 Session 投注約 HKD ${money(table.turnover, locale)}，建議結合最近 30 分鐘趨勢判斷是否升溫。`, `Current session wager is about HKD ${money(table.turnover, locale)}; compare the last 30 minutes to confirm whether it is heating up.`)
    : tx(locale, "当前暂无投注量，可作为冷启动或调度备用桌观察。", "目前暫無投注量，可作為冷啟動或調度備用桌觀察。", "No current wager volume; treat it as cold-start or standby capacity.");
  return [first, second, third];
}

function isGovernanceRiskSignal(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized || ["none", "clear", "normal", "healthy", "stable", "状态良好", "狀態良好"].includes(normalized)) return false;
  return ["cardcounterwatch", "aggressive", "highvariance", "responsibleplay", "selfexcluded"].includes(normalized) || normalized.includes("risk") || normalized.startsWith("rg-");
}

function patronRecommendation(locale: Locale, patron: LivePatron): PatronRecommendation {
  const session = patron.activeSession;
  const tags = session?.behaviorTags || [];
  const riskSignalTags = [...patron.riskFlags, ...tags].filter(isGovernanceRiskSignal);
  const hasRisk = patron.activeRiskCount > 0 || riskSignalTags.length > 0;
  const isHighValue = ["Diamond", "Platinum", "Gold"].includes(patron.tier) || patron.adt >= 10000 || (session?.sessionBetAmount || 0) >= 18000;
  const likesPromo = tags.includes("PromoSeeker") || patron.pointsBalance >= 50000;
  const preferredGame = patron.preferredGames[0] || tx(locale, "未标注", "未標註", "untagged");
  const profileMissing = patron.tier === "Unclassified" && patron.adt === 0 && patron.pointsBalance === 0 && patron.preferredGames.length === 0;

  if (hasRisk) {
    return {
      title: tx(locale, "暂停刺激型优惠，改为客户经理关怀", "暫停刺激型優惠，改為客戶經理關懷", "Pause incentives; switch to host care"),
      detail: tx(locale, "AI 识别到风险或敏感行为信号，建议不直接触达优惠，先通知管理员与客户经理复核。", "AI 識別到風險或敏感行為訊號，建議不直接觸達優惠，先通知管理員與客戶經理複核。", "AI detected risk or sensitive behavior. Do not send an incentive; route to admin and host review first."),
      confidence: 92,
      estimatedCost: "HKD 0",
      validity: tx(locale, "立即复核", "立即複核", "Immediate review"),
      governanceStatus: "blocked",
      governanceLabel: tx(locale, "治理拦截", "治理攔截", "Governance blocked"),
      policyReason: tx(locale, "Responsible Play / 风险案例存在，禁止自动发送博彩激励。", "Responsible Play / 風險案例存在，禁止自動發送博彩激勵。", "Responsible Play / risk signal present; automatic gaming incentive is blocked."),
      evidence: [
        tx(locale, `风险案例 ${patron.activeRiskCount} 条`, `風險案例 ${patron.activeRiskCount} 條`, `${patron.activeRiskCount} risk case(s)`),
        tx(locale, `风险信号 ${riskSignalTags.join(" · ") || "—"}`, `風險訊號 ${riskSignalTags.join(" · ") || "—"}`, `Risk signals ${riskSignalTags.join(" · ") || "—"}`),
        tx(locale, `当前桌台 ${session?.tableId || "—"}`, `目前桌台 ${session?.tableId || "—"}`, `Current table ${session?.tableId || "—"}`),
      ],
      hostMessage: tx(locale, "您好，我是客户经理。我们先确认您当前体验是否舒适，如需休息或餐饮安排，我可以马上协助。", "您好，我是客戶經理。我們先確認您目前體驗是否舒適，如需休息或餐飲安排，我可以馬上協助。", "Hello, this is your host. I’d like to check that you are comfortable; I can arrange a short break or dining support if helpful."),
    };
  }

  if (session && profileMissing) {
    return {
      title: tx(locale, "画像未同步：先客户经理确认身份", "畫像未同步：先客戶經理確認身份", "Profile not synced: host identity check first"),
      detail: tx(locale, "系统只拿到实时 Session，尚未在 patron_profiles 匹配到客户画像；不应直接发送积分或高成本优惠，先由客户经理现场确认身份与需求。", "系統只拿到即時 Session，尚未在 patron_profiles 匹配到客戶畫像；不應直接發送積分或高成本優惠，先由客戶經理現場確認身份與需求。", "Only the live session is available and no patron profile matched yet; do not send points or high-cost offers before host verification."),
      confidence: tags.includes("HighValueReturn") || tags.includes("PromoSeeker") ? 76 : 68,
      estimatedCost: "HKD 0",
      validity: tx(locale, "立即确认", "立即確認", "Verify now"),
      governanceStatus: "pending",
      governanceLabel: tx(locale, "需补齐画像", "需補齊畫像", "Profile required"),
      policyReason: tx(locale, "Trusted / Governed 策略要求：画像缺失时，不自动触达优惠；只能生成客户经理人工确认任务。", "Trusted / Governed 策略要求：畫像缺失時，不自動觸達優惠；只能產生客戶經理人工確認任務。", "Trusted / Governed policy: when profile data is missing, do not auto-send offers; create a host verification task only."),
      evidence: [
        tx(locale, `已识别实时 Session：${session.tableId}，投注 HKD ${money(session.sessionBetAmount, locale)}`, `已識別即時 Session：${session.tableId}，投注 HKD ${money(session.sessionBetAmount, locale)}`, `Live session found: ${session.tableId}, wager HKD ${money(session.sessionBetAmount, locale)}`),
        tx(locale, "未匹配 patron_profiles：画像等级、ADT、积分暂不可用", "未匹配 patron_profiles：畫像等級、ADT、積分暫不可用", "No patron_profiles match: tier, ADT and points unavailable"),
        tx(locale, `Session 标签：${tags.join(" · ") || "—"}`, `Session 標籤：${tags.join(" · ") || "—"}`, `Session tags: ${tags.join(" · ") || "—"}`),
      ],
      hostMessage: tx(locale, "您好，我们看到您当前正在场内体验。为了更准确安排服务，我先为您确认会员身份与偏好；如需餐饮、休息或酒店协助，我可以马上处理。", "您好，我們看到您目前正在場內體驗。為了更準確安排服務，我先為您確認會員身份與偏好；如需餐飲、休息或酒店協助，我可以馬上處理。", "Hello, we see you are currently on the floor. I’ll first confirm your membership profile and preferences so we can arrange the right service; I can help with dining, rest or hotel support immediately."),
    };
  }

  if (session && isHighValue) {
    return {
      title: tx(locale, "客户经理问候 + 酒店/餐饮礼遇", "客戶經理問候 + 酒店/餐飲禮遇", "Host greeting + hotel/F&B benefit"),
      detail: tx(locale, "VIP 当前仍在桌上，价值与活跃度较高，适合由客户经理在现场窗口提供非博彩关怀。", "VIP 目前仍在桌上，價值與活躍度較高，適合由客戶經理在現場窗口提供非博彩關懷。", "The VIP is still at the table with strong value and activity; use the live window for non-gaming care."),
      confidence: likesPromo ? 88 : 82,
      estimatedCost: patron.tier === "Diamond" || patron.tier === "Platinum" ? "HKD 2,400" : "HKD 800",
      validity: tx(locale, "2 小时", "2 小時", "2 hours"),
      governanceStatus: "pending",
      governanceLabel: tx(locale, "待主管审批", "待主管審批", "Pending approval"),
      policyReason: tx(locale, "客户状态正常；这里不是风险管控，而是 Trusted / Governed 审批：涉及成本、库存和客户触达，需要主管确认后发送。", "客戶狀態正常；這裡不是風險管控，而是 Trusted / Governed 審批：涉及成本、庫存和客戶觸達，需要主管確認後發送。", "Patron status is healthy. This is not risk control; it is Trusted / Governed approval for cost, inventory and customer outreach before delivery."),
      evidence: [
        tx(locale, `Session 投注 HKD ${money(session.sessionBetAmount, locale)}`, `Session 投注 HKD ${money(session.sessionBetAmount, locale)}`, `Session wager HKD ${money(session.sessionBetAmount, locale)}`),
        tx(locale, `VIP 等级 ${patron.tier}`, `VIP 等級 ${patron.tier}`, `VIP tier ${patron.tier}`),
        tx(locale, `偏好 ${preferredGame}`, `偏好 ${preferredGame}`, `Preference ${preferredGame}`),
      ],
      hostMessage: tx(locale, "您好，我看到您今天在场体验不错。我们可以为您安排一份酒店/餐饮礼遇，如果方便我现在为您确认。", "您好，我看到您今天在場體驗不錯。我們可以為您安排一份酒店/餐飲禮遇，如果方便我現在為您確認。", "Hello, I see you’re enjoying your visit today. We can arrange a hotel or dining benefit for you; I can confirm it now if convenient."),
    };
  }

  return {
    title: tx(locale, "低压服务观察，暂不主动发送优惠", "低壓服務觀察，暫不主動發送優惠", "Low-pressure service watch; no offer yet"),
    detail: tx(locale, "当前价值、在场或偏好信号不足，建议先进入观察队列，避免过度触达。", "目前價值、在場或偏好訊號不足，建議先進入觀察隊列，避免過度觸達。", "Current value, presence or preference signals are not strong enough; keep watching and avoid over-contacting."),
    confidence: session ? 67 : 54,
    estimatedCost: "HKD 0",
    validity: tx(locale, "持续观察", "持續觀察", "Monitor"),
    governanceStatus: "approved",
    governanceLabel: tx(locale, "无需触达", "無需觸達", "No outreach"),
    policyReason: tx(locale, "治理策略建议降低触达频次，不产生客户消息。", "治理策略建議降低觸達頻次，不產生客戶訊息。", "Governance recommends lower contact frequency; no customer message is generated."),
    evidence: [
      tx(locale, `ADT HKD ${money(patron.adt, locale)}`, `ADT HKD ${money(patron.adt, locale)}`, `ADT HKD ${money(patron.adt, locale)}`),
      session ? tx(locale, `当前桌台 ${session.tableId}`, `目前桌台 ${session.tableId}`, `Current table ${session.tableId}`) : tx(locale, "当前不在场", "目前不在場", "Not currently on property"),
      tx(locale, `偏好 ${preferredGame}`, `偏好 ${preferredGame}`, `Preference ${preferredGame}`),
    ],
    hostMessage: tx(locale, "暂不主动触达客户，继续观察实时行为变化。", "暫不主動觸達客戶，繼續觀察即時行為變化。", "Do not proactively contact the patron yet; keep monitoring live behavior."),
  };
}

function inferredMeta(tableId: string) {
  const numeric = Number(tableId.replace(/\D/g, "")) || 1;
  const games = ["Baccarat", "Blackjack", "Poker", "Roulette", "Sic Bo"];
  const zones = ["A", "B", "C", "VIP"];
  return {
    zone: zones[numeric % zones.length],
    game: games[numeric % games.length],
    capacity: 25,
    minBet: [300, 500, 800, 1000][numeric % 4],
  };
}

function money(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN", { notation: value >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value || 0);
}

function scenarioTemplates(locale: Locale): ScenarioTemplate[] {
  return [
    { id: "vip-return", icon: "VIP", title: tx(locale, "高价值客户回流", "高價值客戶回流", "High-value return"), detail: tx(locale, "沉睡 60 天的钻石客户重新入场，触发客户经理接待与非博彩礼遇。", "沉睡 60 天的鑽石客戶重新入場，觸發客戶經理接待與非博彩禮遇。", "A Diamond patron returns after 60 days, triggering host outreach and a non-gaming benefit."), tableId: "T-0018", tags: ["PromoSeeker"], bet: 18800, stack: 52000, aggregateName: "patron_realtime_decision_signals", trigger: "high_value_return", aiAction: tx(locale, "套房升级 + 延迟退房", "套房升級 + 延遲退房", "Suite upgrade + late checkout"), governance: tx(locale, "允许发送 WhatsApp，需记录成本", "允許發送 WhatsApp，需記錄成本", "Send WhatsApp, record cost") },
    { id: "floor-surge", icon: "OPS", title: tx(locale, "桌台拥堵预警", "桌台擁堵預警", "Floor congestion"), detail: tx(locale, "区域 B 客流快速集中，AI 建议开桌、调配荷官并调整最低投注额。", "區域 B 客流快速集中，AI 建議開桌、調配荷官並調整最低投注額。", "Zone B demand spikes; AI proposes opening capacity, reallocating staff and adjusting minimums."), tableId: "T-0014", tags: ["LateNight"], bet: 32000, stack: 76000, aggregateName: "table_realtime_capacity_signals", trigger: "zone_b_capacity_pressure", aiAction: tx(locale, "开同类桌 + 调整最低投注", "開同類桌 + 調整最低投注", "Open capacity + adjust min bet"), governance: tx(locale, "发送给场面经理，不触达客户", "發送給場面經理，不觸達客戶", "Notify floor manager only") },
    { id: "risk-escalation", icon: "RISK", title: tx(locale, "风险升级与人工接管", "風險升級與人工接管", "Risk escalation"), detail: tx(locale, "高强度长时段行为出现，系统拦截刺激型优惠并通知管理员。", "高強度長時段行為出現，系統攔截刺激型優惠並通知管理員。", "High-intensity extended play blocks gaming incentives and alerts an administrator."), tableId: "T-0012", tags: ["Aggressive", "LateNight"], bet: 65000, stack: 18000, aggregateName: "patron_realtime_decision_signals", trigger: "responsible_play_review", aiAction: tx(locale, "拦截现金类优惠", "攔截現金類優惠", "Block cash-equivalent offer"), governance: tx(locale, "必须通知管理员复核", "必須通知管理員複核", "Admin review required") },
    { id: "offer-fatigue", icon: "MKT", title: tx(locale, "优惠疲劳识别", "優惠疲勞識別", "Offer fatigue"), detail: tx(locale, "客户连续忽略同类优惠，AI 转换为体验型关怀并降低触达频率。", "客戶連續忽略同類優惠，AI 轉換為體驗型關懷並降低觸達頻率。", "Repeated offer ignores shift the strategy toward experience-led care and lower frequency."), tableId: "T-0004", tags: ["Conservative"], bet: 9600, stack: 31000, aggregateName: "patron_offer_response_rollup", trigger: "offer_fatigue", aiAction: tx(locale, "改为餐饮/演出票关怀", "改為餐飲/演出票關懷", "Switch to F&B/show care"), governance: tx(locale, "降低触达频次", "降低觸達頻次", "Lower outreach frequency") },
    { id: "host-sla", icon: "SLA", title: tx(locale, "客户经理跟进超时", "客戶經理跟進逾時", "Host SLA breach"), detail: tx(locale, "高价值客户长期未被联系，自动生成个性化话术与跟进任务。", "高價值客戶長期未被聯絡，自動產生個人化話術與跟進任務。", "A high-value patron lacks recent contact; AI creates a personalized script and follow-up task."), tableId: "T-0026", tags: ["PromoSeeker"], bet: 14500, stack: 48000, aggregateName: "host_service_sla_signals", trigger: "host_followup_overdue", aiAction: tx(locale, "生成客户经理跟进任务", "產生客戶經理跟進任務", "Create host follow-up task"), governance: tx(locale, "升级给值班主管", "升級給值班主管", "Escalate to duty supervisor") },
    { id: "data-anomaly", icon: "DQ", title: tx(locale, "数据质量异常", "數據品質異常", "Data quality anomaly"), detail: tx(locale, "桌台人数超过容量或 Session 标签冲突，数据被隔离且不进入推荐。", "桌台人數超過容量或 Session 標籤衝突，數據被隔離且不進入推薦。", "Impossible occupancy or conflicting session tags are quarantined from recommendations."), tableId: "T-0014", tags: ["CardCounterWatch"], bet: 99999, stack: 1000, aggregateName: "table_data_quality_signals", trigger: "impossible_occupancy", aiAction: tx(locale, "隔离数据并暂停推荐", "隔離數據並暫停推薦", "Quarantine data and pause recommendation"), governance: tx(locale, "通知数据管理员", "通知數據管理員", "Notify data steward") },
  ];
}

function scenarioExperience(template: ScenarioTemplate): Experience {
  if (template.id === "floor-surge" || template.id === "data-anomaly") return "floor";
  if (template.id === "risk-escalation") return "risk";
  if (template.id === "offer-fatigue") return "campaign";
  return "moment";
}

function scenarioPrompt(locale: Locale, template: ScenarioTemplate, patronId: string) {
  return tx(
    locale,
    `请基于 TapData 聚合表 ${template.aggregateName} 分析场景“${template.title}”：触发原因 ${template.trigger}，客户 ${patronId}，桌台 ${template.tableId}。请给出数据证据、AI判断、治理约束和下一步动作。`,
    `請基於 TapData 聚合表 ${template.aggregateName} 分析場景「${template.title}」：觸發原因 ${template.trigger}，客戶 ${patronId}，桌台 ${template.tableId}。請給出數據證據、AI判斷、治理約束和下一步動作。`,
    `Analyze scenario "${template.title}" from TapData aggregate ${template.aggregateName}: trigger ${template.trigger}, patron ${patronId}, table ${template.tableId}. Return evidence, AI judgment, governance constraint and next action.`,
  );
}

function scenarioAggregateRow(template: ScenarioTemplate, patronId: string) {
  return {
    signalId: `SIG-${template.id.toUpperCase()}`,
    patronId,
    tableId: template.tableId,
    triggerType: template.trigger,
    sessionBetAmount: template.bet,
    currentStackEstimate: template.stack,
    behaviorTags: template.tags,
    riskScore: template.id === "risk-escalation" ? 92 : template.id === "data-anomaly" ? 88 : template.id === "floor-surge" ? 76 : 61,
    recommendedAction: template.aiAction,
    governanceAction: template.governance,
    sourceCollections: ["patron_table_sessions", "patron_profiles", "patron_risk_cases", "offer_recommendations", "table_state_snapshots"],
  };
}

function scenarioCdcPayload(template: ScenarioTemplate, patronId: string) {
  return JSON.stringify({
    targetCollection: "patron_table_sessions",
    operation: "upsert",
    filter: { patronId, isActive: true },
    document: {
      patronId,
      tableId: template.tableId,
      seatedAt: "2026-08-20T14:00:00.000Z",
      lastActionAt: "2026-08-20T14:03:00.000Z",
      sessionBetAmount: template.bet,
      currentStackEstimate: template.stack,
      behaviorTags: template.tags,
      isActive: true,
    },
  }, null, 2);
}

function demoRunbooks(locale: Locale): DemoRunbook[] {
  return [
    {
      id: "vip-host-followup",
      title: tx(locale, "实操一：VIP 推荐与 Host 跟进", "實操一：VIP 推薦與 Host 跟進", "Run 1: VIP recommendation and host follow-up"),
      badge: "CDC + OFFER",
      patronId: "P0000100861",
      tableId: "T-0014",
      experience: "moment",
      summary: tx(locale, "模拟客户投注升高并出现优惠敏感标签，TapData 聚合后让 AI 推荐客户经理主动跟进。", "模擬客戶投注升高並出現優惠敏感標籤，TapData 聚合後讓 AI 推薦客戶經理主動跟進。", "Simulate higher wager and promo-seeking behavior, then let AI recommend host follow-up from the aggregate."),
      sourceMutation: `-- Oracle Gaming：把玩家 100861 切到现场 VIP 关键时刻
UPDATE C##GAMING.GAMING_TABLE_SESSIONS
SET TABLE_ID = 'T-0014',
    SESSION_BET_HKD = 68000,
    CURRENT_STACK_HKD = 118000,
    BEHAVIOR_TAGS = 'HighValueReturn,PromoSeeker',
    IS_ACTIVE = 1,
    LAST_ACTION_AT = SYSTIMESTAMP
WHERE PLAYER_ID = '100861';

-- PostgreSQL Loyalty：生成推荐候选，TapData 一比一同步到 offer_recommendations
UPDATE casino_loyalty.ai_offer_recommendations_src
SET status = 'Proposed',
    confidence = 0.92,
    next_best_action = 'Suite upgrade + late checkout + fine dining'
WHERE patron_id = 'P0000100861';`,
      tapdataChecks: [
        tx(locale, "JOIN-02 捕获 Oracle Session 变更并刷新 patron_table_sessions。", "JOIN-02 捕獲 Oracle Session 變更並刷新 patron_table_sessions。", "JOIN-02 captures the Oracle session change and refreshes patron_table_sessions."),
        tx(locale, "PG 一比一复制刷新 offer_recommendations。", "PG 一比一複製刷新 offer_recommendations。", "PG one-to-one CDC refreshes offer_recommendations."),
        tx(locale, "发布 API 后 AI 读取 /api/v1/patron_realtime_decision_signals/find 与 /api/v1/patron_table_sessions/find。", "發布 API 後 AI 讀取 /api/v1/patron_realtime_decision_signals/find 與 /api/v1/patron_table_sessions/find。", "AI reads /api/v1/patron_realtime_decision_signals/find and /api/v1/patron_table_sessions/find after API publishing."),
      ],
      aiQuestion: tx(locale, "请基于 patron_realtime_decision_signals 分析 P0000100861 当前推荐什么，是否需要治理动作？", "請基於 patron_realtime_decision_signals 分析 P0000100861 目前推薦什麼，是否需要治理動作？", "Use patron_realtime_decision_signals to analyze the current recommendation for P0000100861 and whether governance is needed."),
    },
    {
      id: "risk-block-offer",
      title: tx(locale, "实操二：风险升高与优惠拦截", "實操二：風險升高與優惠攔截", "Run 2: Risk escalation and offer blocking"),
      badge: "CDC + RISK",
      patronId: "P0000100861",
      tableId: "T-0014",
      experience: "risk",
      summary: tx(locale, "模拟高强度深夜投注、风险案例与告警，TapData 聚合后让 AI 判断是否应拦截刺激型优惠。", "模擬高強度深夜投注、風險案例與告警，TapData 聚合後讓 AI 判斷是否應攔截刺激型優惠。", "Simulate aggressive late-night play, risk case and alert, then let AI decide whether to block incentives."),
      sourceMutation: `-- Oracle Gaming：切换为风险 Session
UPDATE C##GAMING.GAMING_TABLE_SESSIONS
SET TABLE_ID = 'T-0014',
    SESSION_BET_HKD = 92000,
    CURRENT_STACK_HKD = 12000,
    BEHAVIOR_TAGS = 'Aggressive,LateNight',
    IS_ACTIVE = 1,
    LAST_ACTION_AT = SYSTIMESTAMP
WHERE PLAYER_ID = '100861';

-- MSSQL Ops：打开责任博彩案例，TapData 一比一同步到 patron_risk_cases / patron_alerts
UPDATE dbo.responsible_play_cases_ai_ready
SET status = 'Open',
    riskLevel = 'High',
    reasoningAssessment = '{"summary":"Aggressive late-night extended play requires administrator review","source":"MSSQL.responsible_play_cases_ai_ready"}',
    updatedAt = SYSDATETIME()
WHERE patronId = 'P0000100861';`,
      tapdataChecks: [
        tx(locale, "CDC 任务捕获 session、risk case 与 alert 的变更。", "CDC 任務捕獲 session、risk case 與 alert 的變更。", "CDC task captures session, risk case and alert changes."),
        tx(locale, "聚合目标表出现 risks / alerts 内嵌数组。", "聚合目標表出現 risks / alerts 內嵌陣列。", "Aggregate target includes embedded risks / alerts arrays."),
        tx(locale, "AI 回答应引用 patron_realtime_decision_signals 并给出治理结论。", "AI 回答應引用 patron_realtime_decision_signals 並給出治理結論。", "AI should cite patron_realtime_decision_signals and return a governance decision."),
      ],
      aiQuestion: tx(locale, "请基于 patron_realtime_decision_signals 分析 P0000100861 是否还能发送优惠？如果有风险，需要通知谁？", "請基於 patron_realtime_decision_signals 分析 P0000100861 是否還能發送優惠？如果有風險，需要通知誰？", "Use patron_realtime_decision_signals to analyze whether P0000100861 can still receive an offer, and who must be notified if there is risk."),
    },
  ];
}

export default function CommandCenter({
  locale,
  patronId,
  onOpenDecision,
  onLivePatronsLoaded,
}: {
  locale: Locale;
  patronId: string;
  onOpenDecision?: (patronId: string) => void;
  onLivePatronsLoaded?: (patrons: LivePatron[], sourceCounts: SourceCounts | null) => void;
}) {
  const [activeView, setActiveView] = useState<CommandView>("overview");
  const [experience, setExperience] = useState<Experience>("moment");
  const [selectedTableId, setSelectedTableId] = useState("T-0014");
  const [tableAiModalOpen, setTableAiModalOpen] = useState(false);
  const [selectedPatronId, setSelectedPatronId] = useState(patronId);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerFilterOpen, setCustomerFilterOpen] = useState(false);
  const [customerStatus, setCustomerStatus] = useState("all");
  const [customerTier, setCustomerTier] = useState("all");
  const [customerRisk, setCustomerRisk] = useState("all");
  const [customerRegion, setCustomerRegion] = useState("all");
  const [customerTag, setCustomerTag] = useState("all");
  const customerFilterRef = useRef<HTMLDivElement>(null);
  const [patrons, setPatrons] = useState<LivePatron[]>([]);
  const [sourceCounts, setSourceCounts] = useState<SourceCounts | null>(null);
  const [dataError, setDataError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [cacheState, setCacheState] = useState<"miss" | "fresh" | "stale" | "persisted">("miss");
  const refreshInFlightRef = useRef(false);
  const refreshSequenceRef = useRef(0);
  const livePatronsLoadedRef = useRef(onLivePatronsLoaded);
  const [prompt, setPrompt] = useState(() => defaultPrompt(locale, "moment", patronId, "T-0014"));
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: tx(locale, "我可以实时查询客户、Session、桌台、优惠与风险数据。请直接用业务语言提问。", "我可以即時查詢客戶、Session、桌台、優惠與風險數據。請直接用業務語言提問。", "I can query patrons, sessions, tables, offers and risk data in real time. Ask in business language.") }]);
  const [loading, setLoading] = useState(false);
  const [connectionMode, setConnectionMode] = useState<"idle" | "demo" | "live" | "error">("idle");
  const [simulatedSessions, setSimulatedSessions] = useState<SimulatedSession[]>([]);
  const [scenarioNotice, setScenarioNotice] = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState("vip-return");
  const [simTableId, setSimTableId] = useState("T-0019");
  const [simPatronId, setSimPatronId] = useState("SIM-0001");
  const [simBet, setSimBet] = useState(22000);
  const [simStack, setSimStack] = useState(48000);
  const [simTags, setSimTags] = useState<string[]>(["PromoSeeker"]);
  const [simActive, setSimActive] = useState(true);
  const [recommendationWorkflow, setRecommendationWorkflow] = useState<Record<string, RecommendationWorkflowStatus>>({});
  const [recommendationAuditIds, setRecommendationAuditIds] = useState<Record<string, string>>({});

  useEffect(() => {
    livePatronsLoadedRef.current = onLivePatronsLoaded;
  }, [onLivePatronsLoaded]);

  // Show the last known live snapshot immediately, then replace it with the
  // current TapData response once the request completes.
  useEffect(() => {
    const cached = readLivePatronSnapshot<LivePatron, SourceCounts>();
    if (!cached) return;
    setPatrons(cached.data);
    if (cached.sourceCounts) setSourceCounts(cached.sourceCounts);
    if (cached.fetchedAt) setLastUpdatedAt(new Date(cached.fetchedAt));
  }, []);

  const loadLivePatrons = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    const requestSequence = refreshSequenceRef.current + 1;
    refreshSequenceRef.current = requestSequence;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    const controller = new AbortController();
    const requestTimer = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/data/patrons", {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 304) {
        if (refreshSequenceRef.current === requestSequence) setDataError("");
        return;
      }
      const result = await response.json() as { data?: LivePatron[]; sourceCounts?: SourceCounts; error?: string; warnings?: Array<{ collection: string; message: string }>; fetchedAt?: string; cacheState?: "miss" | "fresh" | "stale" | "persisted" };
      if (!response.ok || !result.data) throw new Error(result.error || "Unable to load live data");
      if (refreshSequenceRef.current !== requestSequence) return;
      // An empty response is commonly a transient upstream timeout/partial
      // snapshot. Keep the last good data visible instead of clearing the
      // queue on a polling tick; the next refresh will retry automatically.
      if (!result.data.length) {
        setDataError(result.warnings?.[0]?.message || "TapData returned 0 live patrons in this refresh; keeping the last good snapshot");
        return;
      }
      setPatrons(result.data);
      writeLivePatronSnapshot(result.data, result.sourceCounts, result.fetchedAt);
      livePatronsLoadedRef.current?.(result.data, result.sourceCounts || null);
      setSourceCounts(result.sourceCounts || null);
      setDataError("");
      setCacheState(result.cacheState || "miss");
      setLastUpdatedAt(result.fetchedAt ? new Date(result.fetchedAt) : new Date());
      setSelectedPatronId((current) => result.data!.some((item) => item.patronId === current) ? current : result.data![0]?.patronId || patronId);
    } catch (error) {
      if (refreshSequenceRef.current === requestSequence) {
        const message = error instanceof Error && error.name === "AbortError"
          ? tx(locale, "接口超过 15 秒未返回，已放弃本轮刷新，3 秒后自动重试。", "接口超過 15 秒未返回，已放棄本輪刷新，3 秒後自動重試。", "The API did not return within 15s; this refresh was aborted and will retry in 3s.")
          : error instanceof Error ? error.message : "Unable to load live data";
        setDataError(message);
      }
    } finally {
      window.clearTimeout(requestTimer);
      refreshInFlightRef.current = false;
      setRefreshing(false);
    }
  }, [locale, patronId]);

  useEffect(() => {
    void loadLivePatrons();
  }, [loadLivePatrons]);

  useEffect(() => {
    setSelectedPatronId(patronId);
    setCustomerQuery("");
    setCustomerStatus("all");
    setCustomerTier("all");
    setCustomerRisk("all");
    setCustomerRegion("all");
    setCustomerTag("all");
  }, [patronId]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => void loadLivePatrons(), 3_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadLivePatrons]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("mogo-simulated-sessions");
      if (stored) {
        const freshSessions = freshSimulatedSessions(JSON.parse(stored) as SimulatedSession[]);
        setSimulatedSessions(freshSessions);
        window.localStorage.setItem("mogo-simulated-sessions", JSON.stringify(freshSessions));
      }
    } catch { /* local simulation storage is optional */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("mogo-simulated-sessions", JSON.stringify(simulatedSessions)); } catch { /* optional */ }
  }, [simulatedSessions]);

  useEffect(() => {
    if (!customerFilterOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!customerFilterRef.current?.contains(event.target as Node)) setCustomerFilterOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [customerFilterOpen]);

  useEffect(() => {
    if (!tableAiModalOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setTableAiModalOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [tableAiModalOpen]);

  const tables = useMemo(() => {
    const grouped = new Map<string, { patrons: number; turnover: number; vip: number; risks: number }>();
    for (const patron of patrons) {
      const session = patron.activeSession;
      if (!session?.isActive) continue;
      const current = grouped.get(session.tableId) || { patrons: 0, turnover: 0, vip: 0, risks: 0 };
      current.patrons += 1;
      current.turnover += session.sessionBetAmount || 0;
      current.vip += ["Diamond", "Platinum", "Gold"].includes(patron.tier) ? 1 : 0;
      current.risks += patron.activeRiskCount || 0;
      grouped.set(session.tableId, current);
    }
    for (const session of simulatedSessions) {
      if (!session.isActive) continue;
      const current = grouped.get(session.tableId) || { patrons: 0, turnover: 0, vip: 0, risks: 0 };
      current.patrons += 1;
      current.turnover += session.sessionBetAmount;
      current.risks += session.behaviorTags.includes("Aggressive") ? 1 : 0;
      grouped.set(session.tableId, current);
    }
    const ids = new Set([...Object.keys(tableMeta), ...grouped.keys()]);
    return [...ids].sort().map((id): TableNode => {
      const base = tableMeta[id] || inferredMeta(id);
      const live = grouped.get(id) || { patrons: 0, turnover: 0, vip: 0, risks: 0 };
      const occupancy = Math.round((live.patrons / base.capacity) * 100);
      const state: TableNode["state"] = live.patrons === 0 ? "offline" : occupancy > 100 || live.risks >= 3 ? "risk" : occupancy >= 78 ? "opportunity" : live.risks > 0 ? "ai" : "normal";
      return { id, ...base, ...live, occupancy, state, trend: occupancy > 100 ? "DATA" : occupancy >= 78 ? "+HOT" : occupancy === 0 ? "CLOSED" : "LIVE" };
    });
  }, [patrons, simulatedSessions]);

  const selectedTable = tables.find((table) => table.id === selectedTableId) || tables[0];
  const selectedTablePatrons = patrons
    .filter((item) => item.activeSession?.isActive && item.activeSession.tableId === selectedTable?.id)
    .sort((left, right) => (right.activeRiskCount - left.activeRiskCount) || ((right.activeSession?.sessionBetAmount || 0) - (left.activeSession?.sessionBetAmount || 0)));
  const selectedTableSimulatedSessions = simulatedSessions
    .filter((item) => item.isActive && item.tableId === selectedTable?.id)
    .sort((left, right) => right.sessionBetAmount - left.sessionBetAmount);
  const topTables = [...tables].sort((a, b) => b.patrons - a.patrons).slice(0, 3);
  const zoneTotals = tables.reduce<Record<string, number>>((totals, table) => ({ ...totals, [table.zone]: (totals[table.zone] || 0) + table.patrons }), {});
  const hottestZone = Object.entries(zoneTotals).sort((a, b) => b[1] - a[1])[0] || ["—", 0];
  const activePatrons = patrons.filter((item) => item.activeSession?.isActive).length + simulatedSessions.filter((item) => item.isActive).length;
  const riskPatrons = patrons.filter((item) => item.activeRiskCount > 0).length + simulatedSessions.filter((item) => item.isActive && item.behaviorTags.includes("Aggressive")).length;
  const customerTiers = ["Diamond", "Platinum", "Gold", "Silver", "Bronze", "Unclassified"];
  const customerRegions = [...new Set(patrons.map((item) => item.region).filter((item) => item && item !== "—"))].sort();
  const customerTags = [...new Set(patrons.flatMap((item) => [...item.preferredGames, ...(item.activeSession?.behaviorTags || []), ...item.riskFlags]))].sort();
  const filteredCustomerTotal = patrons.filter((item) => {
    const searchable = [item.patronId, item.maskedName, item.tier, item.region, ...item.preferredGames, ...(item.activeSession?.behaviorTags || []), ...item.riskFlags].join(" ").toLowerCase();
    const matchesQuery = searchable.includes(customerQuery.trim().toLowerCase());
    const matchesStatus = customerStatus === "all" || (customerStatus === "active" ? Boolean(item.activeSession) : !item.activeSession);
    const matchesTier = customerTier === "all" || item.tier === customerTier;
    const matchesRisk = customerRisk === "all" || (customerRisk === "risk" ? item.activeRiskCount > 0 : item.activeRiskCount === 0);
    const matchesRegion = customerRegion === "all" || item.region === customerRegion;
    const allTags = [...item.preferredGames, ...(item.activeSession?.behaviorTags || []), ...item.riskFlags];
    const matchesTag = customerTag === "all" || allTags.includes(customerTag);
    return matchesQuery && matchesStatus && matchesTier && matchesRisk && matchesRegion && matchesTag;
  });
  const selectedPatronFromAll = patrons.find((item) => item.patronId === selectedPatronId);
  const filteredPatronWindow = filteredCustomerTotal.slice(0, 40);
  const filteredPatrons = selectedPatronFromAll && !filteredPatronWindow.some((item) => item.patronId === selectedPatronFromAll.patronId)
    ? [selectedPatronFromAll, ...filteredPatronWindow.slice(0, 39)]
    : filteredPatronWindow;
  const selectedPatron = selectedPatronFromAll || filteredPatrons[0];
  const selectedPatronRecommendation = selectedPatron ? patronRecommendation(locale, selectedPatron) : null;
  const selectedRecommendationStatus: RecommendationWorkflowStatus = selectedPatronRecommendation?.governanceStatus === "blocked"
    ? "rejected"
    : selectedPatron
      ? recommendationWorkflow[selectedPatron.patronId] || (selectedPatronRecommendation?.governanceStatus === "approved" ? "approved" : "pending")
      : "pending";
  const activeCustomerFilterCount = [customerStatus, customerTier, customerRisk, customerRegion, customerTag].filter((value) => value !== "all").length;
  const templates = scenarioTemplates(locale);
  const demoRuns = demoRunbooks(locale);
  const selectedScenario = templates.find((item) => item.id === selectedScenarioId) || templates[0];
  const selectedScenarioPatron = `SCN-${selectedScenario.id.toUpperCase().slice(0, 8)}`;
  const selectedScenarioAggregate = scenarioAggregateRow(selectedScenario, selectedScenarioPatron);

  function resetCustomerFilters() {
    setCustomerStatus("all");
    setCustomerTier("all");
    setCustomerRisk("all");
    setCustomerRegion("all");
    setCustomerTag("all");
  }

  async function persistRecommendationAction(actionType: "recommendation_approved" | "recommendation_rejected" | "recommendation_sent", status: RecommendationWorkflowStatus) {
    if (!selectedPatron || !selectedPatronRecommendation) return null;
    const response = await fetch("/api/audit/events", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        actionType,
        scenarioId: "customer-360",
        patronId: selectedPatron.patronId,
        maskedName: selectedPatron.maskedName,
        tableId: selectedPatron.activeSession?.tableId || "",
        reportId: `NBA-${selectedPatron.patronId}`,
        alertLevel: selectedPatronRecommendation.governanceStatus,
        channel: "WhatsApp",
        recipient: tx(locale, "客户经理 / 主管审批", "客戶經理 / 主管審批", "Host / supervisor approval"),
        message: selectedPatronRecommendation.hostMessage,
        status,
        metadata: {
          recommendationTitle: selectedPatronRecommendation.title,
          confidence: selectedPatronRecommendation.confidence,
          governanceLabel: selectedPatronRecommendation.governanceLabel,
        },
      }),
    });
    const payload = await response.json() as AuditPersistResponse;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Audit persistence failed");
    if (payload.eventId) setRecommendationAuditIds((current) => ({ ...current, [selectedPatron.patronId]: payload.eventId! }));
    return payload;
  }

  async function setRecommendationDecision(next: "approved" | "rejected") {
    if (!selectedPatron || selectedPatronRecommendation?.governanceStatus === "blocked") return;
    setRecommendationWorkflow((current) => ({ ...current, [selectedPatron.patronId]: next === "approved" ? "approving" : "rejecting" }));
    try {
      await persistRecommendationAction(next === "approved" ? "recommendation_approved" : "recommendation_rejected", next);
      setRecommendationWorkflow((current) => ({ ...current, [selectedPatron.patronId]: next }));
    } catch {
      setRecommendationWorkflow((current) => ({ ...current, [selectedPatron.patronId]: "pending" }));
    }
  }

  async function sendGovernedRecommendation() {
    if (!selectedPatron || !selectedPatronRecommendation || selectedRecommendationStatus !== "approved") return;
    setRecommendationWorkflow((current) => ({ ...current, [selectedPatron.patronId]: "sending" }));
    try {
      await persistRecommendationAction("recommendation_sent", "sent");
      setRecommendationWorkflow((current) => ({ ...current, [selectedPatron.patronId]: "sent" }));
    } catch {
      setRecommendationWorkflow((current) => ({ ...current, [selectedPatron.patronId]: "approved" }));
    }
  }

  const viewText: Record<CommandView, { title: string; detail: string }> = {
    overview: { title: tx(locale, "实时运营总览", "即時營運總覽", "Live Operations Overview"), detail: tx(locale, "先看全局，再进入桌台、客户、风险或营销细节。", "先看全局，再進入桌台、客戶、風險或營銷細節。", "Start with the whole operation, then drill into tables, patrons, risk or marketing.") },
    floor: { title: tx(locale, "桌台热力图", "桌台熱力圖", "Table Heatmap"), detail: tx(locale, "根据真实 Session 聚合桌台占用、投注量与风险信号。", "根據真實 Session 聚合桌台佔用、投注量與風險訊號。", "Aggregate occupancy, wagering and risk from live sessions.") },
    chat: { title: tx(locale, "AI 数据助手", "AI 數據助手", "AI Data Assistant"), detail: tx(locale, "使用 DeepSeek 与受控工具查询 MongoDB 数据，答案附带集合证据。", "使用 DeepSeek 與受控工具查詢 MongoDB 數據，答案附帶集合證據。", "Use DeepSeek and governed tools to query MongoDB with collection evidence.") },
    customer: { title: tx(locale, "客户 360", "客戶 360", "Customer 360"), detail: tx(locale, "独立搜索客户，查看画像、偏好、实时行为和风险评估。", "獨立搜尋客戶，查看畫像、偏好、即時行為和風險評估。", "Search patrons and review profile, preference, live behavior and risk assessment.") },
    scenarios: { title: tx(locale, "场景工坊", "場景工坊", "Scenario Studio"), detail: tx(locale, "用可复用故事演示 AI 如何发现、解释、决策与治理。", "用可重複使用故事演示 AI 如何發現、解釋、決策與治理。", "Demonstrate how AI detects, explains, decides and governs through reusable stories.") },
    simulate: { title: tx(locale, "数据模拟器", "數據模擬器", "Data Simulator"), detail: tx(locale, "手动创建本地 Session 数据并立即观察大盘与热力图变化。", "手動建立本地 Session 數據並立即觀察大盤與熱力圖變化。", "Create local session data and immediately observe dashboard and heatmap changes.") },
  };

  function changeExperience(next: Experience) {
    setExperience(next);
    setPrompt(defaultPrompt(locale, next, selectedPatronId || patronId, selectedTableId));
  }

  async function askAi(event?: FormEvent) {
    event?.preventDefault();
    const question = prompt.trim();
    if (!question || loading) return;
    setMessages((current) => [...current, { role: "user", content: question }]);
    setPrompt("");
    setLoading(true);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, locale, context: { experience, patronId: selectedPatronId || patronId, tableId: selectedTableId } }),
      });
      const result = await readChatReply(response);
      if (!response.ok || result.error) throw new Error(result.error || "AI request failed");
      setConnectionMode(result.mode || "live");
      setMessages((current) => [...current, { role: "assistant", content: result.answer || tx(locale, "分析完成。", "分析完成。", "Analysis complete."), mode: result.mode, sources: result.sources, steps: result.steps }]);
    } catch (error) {
      setConnectionMode("error");
      setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : tx(locale, "AI 查询失败。", "AI 查詢失敗。", "AI query failed.") }]);
    } finally { setLoading(false); }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void askAi();
  }

  function addSimulation(session: Omit<SimulatedSession, "id" | "createdAt">) {
    const next = { ...session, id: `${session.patronId}-${Date.now()}`, createdAt: new Date().toISOString() };
    setSimulatedSessions((current) => [next, ...current].slice(0, 30));
    setSelectedTableId(session.tableId);
  }

  function runScenario(template: ScenarioTemplate) {
    const scenarioPatron = `SCN-${template.id.toUpperCase().slice(0, 8)}`;
    setSelectedScenarioId(template.id);
    addSimulation({ patronId: scenarioPatron, tableId: template.tableId, sessionBetAmount: template.bet, currentStackEstimate: template.stack, behaviorTags: template.tags, isActive: true, scenario: template.title });
    setExperience(scenarioExperience(template));
    setPrompt(scenarioPrompt(locale, template, scenarioPatron));
    setScenarioNotice(tx(locale, `已将“${template.title}”注入本地模拟层。`, `已將「${template.title}」注入本地模擬層。`, `“${template.title}” was injected into the local simulation layer.`));
  }

  function prepareDemoRunbook(runbook: DemoRunbook, openChat = false) {
    setSelectedPatronId(runbook.patronId);
    setSelectedTableId(runbook.tableId);
    setExperience(runbook.experience);
    setPrompt(runbook.aiQuestion);
    setScenarioNotice(tx(locale, `已准备“${runbook.title}”的 AI 提问。`, `已準備「${runbook.title}」的 AI 提問。`, `Prepared the AI question for “${runbook.title}”.`));
    if (openChat) setActiveView("chat");
  }

  function prepareTableAnalysis(table: TableNode, openChat = false) {
    setSelectedTableId(table.id);
    setExperience("floor");
    setPrompt(tableAnalysisPrompt(locale, table));
    if (openChat) setActiveView("chat");
  }

  function openTableAiModal(table: TableNode) {
    prepareTableAnalysis(table);
    setTableAiModalOpen(true);
  }

  function submitSimulation(event: FormEvent) {
    event.preventDefault();
    addSimulation({ patronId: simPatronId.trim() || `SIM-${Date.now()}`, tableId: simTableId, sessionBetAmount: simBet, currentStackEstimate: simStack, behaviorTags: simTags, isActive: simActive });
    setScenarioNotice(tx(locale, `${simPatronId} 的本地 Session 已创建。`, `${simPatronId} 的本地 Session 已建立。`, `Local session created for ${simPatronId}.`));
  }

  const menuItems: Array<[CommandView, string, string, string]> = [
    ["overview", "◉", tx(locale, "总览大盘", "總覽大盤", "Overview"), tx(locale, "实时全局状态", "即時全局狀態", "Live operating picture")],
    ["floor", "▦", tx(locale, "桌台热力图", "桌台熱力圖", "Table Heatmap"), tx(locale, "占用与风险分布", "佔用與風險分佈", "Occupancy and risk")],
    ["chat", "✦", tx(locale, "AI Chat", "AI Chat", "AI Chat"), tx(locale, "真实数据问答", "真實數據問答", "Live data Q&A")],
    ["customer", "◎", tx(locale, "客户 360", "客戶 360", "Customer 360"), tx(locale, "画像与评估", "畫像與評估", "Profile and assessment")],
    ["scenarios", "◇", tx(locale, "场景工坊", "場景工坊", "Scenario Studio"), tx(locale, "故事与演示入口", "故事與演示入口", "Stories and demos")],
    ["simulate", "+", tx(locale, "数据模拟器", "數據模擬器", "Data Simulator"), tx(locale, "手动造数入口", "手動造數入口", "Manual data entry")],
  ];

  return (
    <section className="command-center product-console" aria-label={tx(locale, "AI 运营指挥中心", "AI 營運指揮中心", "AI operations command center")}>
      <div className="command-shell">
        <nav className="command-sidebar" aria-label={tx(locale, "系统菜单", "系統選單", "System menu")}>
          <div className="command-sidebar-brand"><i /><div><strong>{tx(locale, "AI 忠诚度引擎", "AI 忠誠度引擎", "LOYALTY AI")}</strong><small>REAL-TIME CUSTOMER INTELLIGENCE</small></div></div>
          <span className="command-menu-label">{tx(locale, "业务模块", "業務模組", "WORKSPACES")}</span>
          <div className="command-menu">
            {menuItems.map(([id, icon, label, detail]) => (
              <button key={id} type="button" className={activeView === id ? "active" : ""} aria-current={activeView === id ? "page" : undefined} onClick={() => setActiveView(id)}>
                <span>{icon}</span><span><strong>{label}</strong><small>{detail}</small></span><b>›</b>
              </button>
            ))}
          </div>
          <div className={`gateway-status ${dataError ? "error" : patrons.length ? "live" : "idle"}`}><span /><div><strong>{dataError ? "DATA GATEWAY ERROR" : patrons.length ? "TAPDATA API LIVE" : "CONNECTING"}</strong><small>{sourceCounts ? `${sourceCounts.patron_table_sessions} SESSION ROWS` : tx(locale, "只读数据层", "唯讀數據層", "Read-only data layer")}</small></div></div>
        </nav>

        <div className="command-main">
          <header className="command-center-head">
            <div><span className="command-overline"><i /> AI // LIVE OPERATIONS GRID</span><h2>{viewText[activeView].title}</h2><p>{viewText[activeView].detail}</p></div>
            <div className="live-head-tools">
              <div className="refresh-control">
                <button type="button" role="switch" className={autoRefresh ? "active" : ""} onClick={() => setAutoRefresh((value) => !value)} aria-checked={autoRefresh} aria-label={autoRefresh ? tx(locale, "关闭自动刷新", "關閉自動刷新", "Turn off auto refresh") : tx(locale, "开启自动刷新", "開啟自動刷新", "Turn on auto refresh")}>
                  <i />{autoRefresh ? tx(locale, "自动刷新开", "自動刷新開", "Auto refresh on") : tx(locale, "自动刷新关", "自動刷新關", "Auto refresh off")}
                </button>
                <button type="button" onClick={() => void loadLivePatrons()} disabled={refreshing} aria-label={tx(locale, "立即刷新数据", "立即刷新數據", "Refresh data now")}>
                  <b className={refreshing ? "spinning" : ""}>↻</b>{refreshing ? tx(locale, "刷新中", "刷新中", "Refreshing") : tx(locale, "立即刷新", "立即刷新", "Refresh")}
                </button>
                <small>{dataError ? dataError : lastUpdatedAt ? `${cacheState === "stale" || cacheState === "persisted" ? tx(locale, "快照于", "快照於", "Snapshot").concat(" ") : tx(locale, "更新于", "更新於", "Updated")} ${lastUpdatedAt.toLocaleTimeString(locale === "en" ? "en-US" : "zh-CN", { hour12: false })}${cacheState === "stale" || cacheState === "persisted" ? ` · ${tx(locale, "后台刷新中", "背景刷新中", "refreshing in background")}` : ""}` : tx(locale, "正在读取实时数据", "正在讀取即時數據", "Loading live data")}</small>
              </div>
              <div className="head-live-stats"><span><i />LIVE</span><b>{activePatrons}</b><small>{tx(locale, "在场客户", "在場客戶", "active patrons")}</small></div>
            </div>
          </header>

          <div className="command-view">
            {activeView === "overview" && <section className="overview-module command-module">
              <div className="overview-kpis">
                <article><small>{tx(locale, "桌台总数", "桌台總數", "Total tables")}</small><strong>{tables.length}</strong><span>{tables.filter((table) => table.patrons > 0).length} {tx(locale, "活跃", "活躍", "active")}</span></article>
                <article className="mint"><small>{tx(locale, "在场客户", "在場客戶", "Active patrons")}</small><strong>{activePatrons}</strong><span>{sourceCounts?.patron_profiles || "—"} {tx(locale, "份画像", "份畫像", "profiles")}</span></article>
                <article className="risk"><small>{tx(locale, "风险客户", "風險客戶", "Risk patrons")}</small><strong>{riskPatrons}</strong><span>{sourceCounts?.patron_risk_cases || "—"} {tx(locale, "个案例", "個案例", "cases")}</span></article>
                <article className="zone"><small>{tx(locale, "最热区域", "最熱區域", "Hottest zone")}</small><strong>{hottestZone[0]}</strong><span>{hottestZone[1]} {tx(locale, "位客户", "位客戶", "patrons")}</span></article>
              </div>
              <div className="overview-grid">
                <article className="overview-card top-tables-card"><div className="overview-card-head"><div><span>LIVE RANKING</span><h3>{tx(locale, "热门桌台", "熱門桌台", "Top tables")}</h3></div><button type="button" onClick={() => setActiveView("floor")}>{tx(locale, "查看热力图", "查看熱力圖", "Open heatmap")} →</button></div>
                  <div className="top-table-list">{topTables.map((table, index) => <button key={table.id} type="button" onClick={() => { setSelectedTableId(table.id); setActiveView("floor"); }}><b>0{index + 1}</b><span><strong>{table.id} · {table.game}</strong><i><em style={{ width: `${Math.min(100, (table.patrons / Math.max(topTables[0]?.patrons || 1, 1)) * 100)}%` }} /></i></span><mark>{table.patrons}</mark></button>)}</div>
                </article>
                <article className="overview-card zone-card"><div className="overview-card-head"><div><span>ZONE SIGNAL</span><h3>{tx(locale, "区域热度", "區域熱度", "Zone activity")}</h3></div></div><div className="zone-bars">{Object.entries(zoneTotals).sort((a, b) => b[1] - a[1]).map(([zone, count]) => <div key={zone}><span>ZONE {zone}</span><i><em style={{ width: `${Math.min(100, count / Math.max(Number(hottestZone[1]), 1) * 100)}%` }} /></i><strong>{count}</strong></div>)}</div></article>
              <article className="overview-card live-floor-card"><div className="overview-card-head"><div><span>FLOOR PULSE</span><h3>{tx(locale, "实时桌台缩略图", "即時桌台縮略圖", "Live floor pulse")}</h3></div><small>{tx(locale, "每 3 秒读取接口", "每 3 秒讀取接口", "API refresh every 3s")}</small></div><div className="mini-floor-grid">{tables.slice(0, 20).map((table) => <button type="button" key={table.id} className={table.state} onClick={() => { setSelectedTableId(table.id); setActiveView("floor"); }}><span>{table.id.replace("T-00", "T")}</span><strong>{table.patrons}</strong><i style={{ height: `${Math.max(6, Math.min(table.occupancy, 100))}%` }} /></button>)}</div></article>
                <article className="overview-card ai-brief-card"><div className="overview-card-head"><div><span>AI BRIEF</span><h3>{tx(locale, "现在最值得处理", "現在最值得處理", "What matters now")}</h3></div><b>3</b></div><div className="brief-list"><button type="button" onClick={() => { setExperience("floor"); setActiveView("chat"); setPrompt(defaultPrompt(locale, "floor", selectedPatronId, topTables[0]?.id || selectedTableId)); }}><i className="risk" />{tx(locale, `${topTables[0]?.id || "—"} 客流最高，需要检查容量与服务资源。`, `${topTables[0]?.id || "—"} 客流最高，需要檢查容量與服務資源。`, `${topTables[0]?.id || "—"} has the highest traffic; review capacity and service resources.`)}<span>↗</span></button><button type="button" onClick={() => { setExperience("risk"); setActiveView("chat"); setPrompt(defaultPrompt(locale, "risk", selectedPatronId, selectedTableId)); }}><i className="warning" />{tx(locale, `${riskPatrons} 位客户存在活动风险信号。`, `${riskPatrons} 位客戶存在活動風險訊號。`, `${riskPatrons} patrons have active risk signals.`)}<span>↗</span></button><button type="button" onClick={() => setActiveView("scenarios")}><i />{tx(locale, "可以注入场景，现场演示数据变化如何驱动 AI 决策。", "可以注入場景，現場演示數據變化如何驅動 AI 決策。", "Inject a scenario to show how data changes drive AI decisions.")}<span>↗</span></button></div></article>
              </div>
            </section>}

            {activeView === "floor" && selectedTable && <section className="floor-radar command-module">
              <div className="module-head"><div><span>DIGITAL CASINO FLOOR</span><h3>{tx(locale, "实时桌台热力图", "即時桌台熱力圖", "Live table heatmap")}</h3></div><div className="floor-legend"><i className="normal" />N<i className="opportunity" />HOT<i className="risk" />RISK<i className="ai" />AI</div></div>
              <div className="floor-metrics"><div><small>{tx(locale, "活跃桌台", "活躍桌台", "Active tables")}</small><strong>{tables.filter((table) => table.patrons > 0).length}<span>/{tables.length}</span></strong></div><div><small>{tx(locale, "在场客户", "在場客戶", "Active patrons")}</small><strong>{activePatrons}</strong></div><div><small>{tx(locale, "Session 投注", "Session 投注", "Session wager")}</small><strong>{money(tables.reduce((sum, table) => sum + table.turnover, 0), locale)}</strong></div><div><small>{tx(locale, "风险信号", "風險訊號", "Risk signals")}</small><strong>{riskPatrons}</strong></div></div>
              <div className="table-heatmap" role="list" aria-label={tx(locale, "桌台热力图", "桌台熱力圖", "Table heatmap")}>{tables.map((table) => <button type="button" key={table.id} className={`table-node ${table.state} ${selectedTableId === table.id ? "selected" : ""}`} onClick={() => openTableAiModal(table)} aria-label={`${table.id} ${table.game} ${table.occupancy}%`}><span className="node-scan" /><span className="node-top"><b>{table.id.replace("T-00", "T")}</b><small>{table.zone}</small></span><strong>{table.occupancy}<em>%</em></strong><span className="node-meta">{table.game} · {table.patrons}/{table.capacity}</span><span className="node-track"><i style={{ width: `${Math.min(table.occupancy, 100)}%` }} /></span><span className="node-bottom"><small>MIN {table.minBet}</small><b>{table.trend}</b></span><span className="node-ai-hint">{tx(locale, "点选 AI 分析", "點選 AI 分析", "Click for AI")}</span></button>)}</div>
              <div className={`table-focus ${selectedTable.state}`}><div><span>{tx(locale, "当前锁定", "目前鎖定", "Current lock")}</span><strong>{selectedTable.id} · {selectedTable.game}</strong></div><dl><div><dt>{tx(locale, "客户", "客戶", "Patrons")}</dt><dd>{selectedTable.patrons}</dd></div><div><dt>{tx(locale, "投注量", "投注量", "Wager")}</dt><dd>{money(selectedTable.turnover, locale)}</dd></div><div><dt>VIP</dt><dd>{selectedTable.vip}</dd></div><div><dt>{tx(locale, "风险", "風險", "Risk")}</dt><dd>{selectedTable.risks}</dd></div></dl><button type="button" onClick={() => openTableAiModal(selectedTable)}>{tx(locale, "弹出 AI 分析", "彈出 AI 分析", "Open AI analysis")} →</button></div>
            </section>}

            {activeView === "chat" && <section className="ai-console command-module standalone-chat">
              <div className="experience-tabs" role="tablist" aria-label={tx(locale, "业务故事", "業務故事", "Business stories")}>{experiences.map((item) => <button key={item.id} type="button" role="tab" aria-selected={experience === item.id} className={experience === item.id ? "active" : ""} onClick={() => changeExperience(item.id)}><span>{item.code}</span><strong>{experienceName(locale, item.id)}</strong></button>)}</div>
              <div className="chat-layout"><div className="chat-transcript" aria-live="polite">{messages.slice(-6).map((message, index) => <article className={`chat-bubble ${message.role}`} key={`${message.role}-${index}-${message.content.slice(0, 12)}`}><div className="chat-role">{message.role === "assistant" ? tx(locale, "AI 引擎", "AI 引擎", "AI ENGINE") : tx(locale, "你", "你", "YOU")}{message.mode && <span>{message.mode === "live" ? "LIVE" : "DEMO"}</span>}</div><p>{message.content}</p>{!!message.steps?.length && <div className="tool-steps">{message.steps.map((step) => <span key={step}>✓ {step}</span>)}</div>}{!!message.sources?.length && <div className="chat-sources">{message.sources.map((source, index) => <code key={`${source.collection}-${source.count}-${index}`}>{source.collection} · {source.count}</code>)}</div>}</article>)}{loading && <article className="chat-bubble assistant loading"><div className="chat-role">{tx(locale, "AI 引擎", "AI 引擎", "AI ENGINE")} <span>QUERYING</span></div><div className="query-beam"><i /><i /><i /></div><p>{tx(locale, "正在选择工具并查询真实数据集合…", "正在選擇工具並查詢真實數據集合…", "Selecting tools and querying live collections…")}</p></article>}</div><aside className="chat-context"><span>ACTIVE CONTEXT</span><strong>{selectedPatronId}</strong><small>{selectedTableId}</small><hr /><b>{connectionMode === "live" ? "DEEPSEEK + TAPDATA LIVE" : connectionMode === "error" ? "GATEWAY ERROR" : "GOVERNED AI AGENT"}</b><p>{tx(locale, "模型只能通过白名单工具读取数据，回答会显示集合来源。", "模型只能透過白名單工具讀取數據，回答會顯示集合來源。", "The model reads data only through allowlisted tools and cites collections in each answer.")}</p></aside></div>
              <div className="prompt-suggestions"><button type="button" onClick={() => setPrompt(defaultPrompt(locale, experience, selectedPatronId, selectedTableId))}>{tx(locale, "使用当前故事问题", "使用目前故事問題", "Use story prompt")}</button><button type="button" onClick={() => setPrompt(tx(locale, `比较 ${selectedTableId} 最近 30 分钟的占用和投注变化。`, `比較 ${selectedTableId} 最近 30 分鐘的佔用和投注變化。`, `Compare occupancy and wagering for ${selectedTableId} over 30 minutes.`))}>{tx(locale, "比较趋势", "比較趨勢", "Compare trend")}</button><button type="button" onClick={() => setPrompt(tx(locale, `为 ${selectedPatronId} 生成有治理约束的下一步建议。`, `為 ${selectedPatronId} 產生有治理約束的下一步建議。`, `Generate a governed next action for ${selectedPatronId}.`))}>{tx(locale, "下一步建议", "下一步建議", "Next action")}</button></div>
              <form className="chat-composer" onSubmit={askAi}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handlePromptKeyDown} rows={4} placeholder={tx(locale, "查询客户、Session、桌台、优惠或风险…", "查詢客戶、Session、桌台、優惠或風險…", "Query patrons, sessions, tables, offers or risk…")} /><div><span>{tx(locale, "ENTER 提交 · SHIFT+ENTER 换行", "ENTER 提交 · SHIFT+ENTER 換行", "ENTER to send · SHIFT+ENTER for newline")}</span><button type="submit" disabled={!prompt.trim() || loading}>{loading ? tx(locale, "查询中", "查詢中", "Querying") : tx(locale, "调用 AI 查询", "調用 AI 查詢", "Run AI query")} <b>↗</b></button></div></form>
            </section>}

            {activeView === "customer" && <section className="customer360-module command-module">
              <aside className="customer360-list">
                <div className="customer360-toolbar">
                  <div className="customer360-search"><span>⌕</span><input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder={tx(locale, "搜索客户编号、等级、地区或标签", "搜尋客戶編號、等級、地區或標籤", "Search patron, tier, region or tag")} /></div>
                  <div className="customer-filter-control" ref={customerFilterRef}>
                    <button type="button" className={`customer-filter-trigger ${customerFilterOpen ? "active" : ""}`} onClick={() => setCustomerFilterOpen((value) => !value)} aria-expanded={customerFilterOpen}>
                      <span>≡</span>{tx(locale, "筛选", "篩選", "Filter")}{activeCustomerFilterCount > 0 && <b>{activeCustomerFilterCount}</b>}
                    </button>
                    {customerFilterOpen && <div className="customer-filter-popover" role="dialog" aria-label={tx(locale, "客户筛选", "客戶篩選", "Patron filters")}>
                      <header><div><span>FILTER MATRIX</span><strong>{tx(locale, "客户筛选", "客戶篩選", "Patron filters")}</strong></div><button type="button" onClick={() => setCustomerFilterOpen(false)} aria-label={tx(locale, "关闭筛选", "關閉篩選", "Close filters")}>×</button></header>
                      <section><h4>{tx(locale, "实时状态", "即時狀態", "Live status")}</h4><div>{[["all", tx(locale, "全部", "全部", "All")], ["active", tx(locale, "当前在场", "目前在場", "On property")], ["offline", tx(locale, "暂不在场", "暫不在場", "Offline")]].map(([value, label]) => <button type="button" key={value} className={customerStatus === value ? "active" : ""} onClick={() => setCustomerStatus(value)}>{label}</button>)}</div></section>
                      <section><h4>{tx(locale, "VIP 等级", "VIP 等級", "VIP tier")}</h4><div><button type="button" className={customerTier === "all" ? "active" : ""} onClick={() => setCustomerTier("all")}>{tx(locale, "全部", "全部", "All")}</button>{customerTiers.map((tier) => <button type="button" key={tier} className={customerTier === tier ? "active" : ""} onClick={() => setCustomerTier(tier)}>{tier}</button>)}</div></section>
                      <section><h4>{tx(locale, "风险状态", "風險狀態", "Risk status")}</h4><div>{[["all", tx(locale, "全部", "全部", "All")], ["risk", tx(locale, "存在风险", "存在風險", "Risk signal")], ["clear", tx(locale, "状态正常", "狀態正常", "Clear")]].map(([value, label]) => <button type="button" key={value} className={customerRisk === value ? "active" : ""} onClick={() => setCustomerRisk(value)}>{label}</button>)}</div></section>
                      {customerRegions.length > 0 && <section><h4>{tx(locale, "地区", "地區", "Region")}</h4><div><button type="button" className={customerRegion === "all" ? "active" : ""} onClick={() => setCustomerRegion("all")}>{tx(locale, "全部", "全部", "All")}</button>{customerRegions.slice(0, 8).map((region) => <button type="button" key={region} className={customerRegion === region ? "active" : ""} onClick={() => setCustomerRegion(region)}>{region}</button>)}</div></section>}
                      {customerTags.length > 0 && <section><h4>{tx(locale, "游戏与行为标签", "遊戲與行為標籤", "Game & behavior tags")}</h4><div><button type="button" className={customerTag === "all" ? "active" : ""} onClick={() => setCustomerTag("all")}>{tx(locale, "全部", "全部", "All")}</button>{customerTags.slice(0, 12).map((tag) => <button type="button" key={tag} className={customerTag === tag ? "active" : ""} onClick={() => setCustomerTag(tag)}>{tag}</button>)}</div></section>}
                      <footer><button type="button" onClick={resetCustomerFilters} disabled={activeCustomerFilterCount === 0}>{tx(locale, "重置筛选", "重設篩選", "Reset")}</button><button type="button" onClick={() => setCustomerFilterOpen(false)}>{tx(locale, `显示 ${filteredCustomerTotal.length} 位客户`, `顯示 ${filteredCustomerTotal.length} 位客戶`, `Show ${filteredCustomerTotal.length} patrons`)}</button></footer>
                    </div>}
                  </div>
                </div>
                <div className="customer-filter-summary"><span>{filteredCustomerTotal.length} / {patrons.length}</span>{activeCustomerFilterCount > 0 && <button type="button" onClick={resetCustomerFilters}>{tx(locale, "清除筛选", "清除篩選", "Clear filters")} ×</button>}</div>
                <div className="customer360-results">{filteredPatrons.length ? filteredPatrons.map((item) => <button type="button" key={item.patronId} className={selectedPatron?.patronId === item.patronId ? "active" : ""} onClick={() => setSelectedPatronId(item.patronId)}><span>{item.patronId.replace(/\D/g, "").slice(-2).padStart(2, "0")}</span><div><strong>{item.patronId}</strong><small>{item.maskedName} · {item.tier}</small></div><b className={item.activeRiskCount ? "risk" : item.activeSession ? "live" : ""}>{item.activeRiskCount ? "!" : item.activeSession ? "●" : "○"}</b></button>) : <div className="customer-filter-empty"><b>⌕</b><strong>{tx(locale, "没有匹配的客户", "沒有符合的客戶", "No matching patrons")}</strong><button type="button" onClick={resetCustomerFilters}>{tx(locale, "重置筛选条件", "重設篩選條件", "Reset filters")}</button></div>}</div>
              </aside>
              {selectedPatron && selectedPatronRecommendation ? <article className="customer360-detail">
                <div className="customer360-hero">
                  <div className="customer-avatar">{selectedPatron.patronId.replace(/\D/g, "").slice(-2).padStart(2, "0")}</div>
                  <div><span>LIVE CUSTOMER PROFILE</span><h3>{selectedPatron.maskedName}</h3><p>{selectedPatron.patronId} · {selectedPatron.tier} · {selectedPatron.region}</p></div>
                  <button type="button" onClick={() => onOpenDecision?.(selectedPatron.patronId)}>{tx(locale, "进入审批工作台", "進入審批工作台", "Open approval workspace")} →</button>
                </div>
                <div className="customer360-score">
                  <div><small>{tx(locale, "实时状态", "即時狀態", "Live status")}</small><strong>{selectedPatron.activeSession ? tx(locale, "当前在场", "目前在場", "On property") : tx(locale, "暂不在场", "暫不在場", "Offline")}</strong></div>
                  <div><small>ADT</small><strong>HKD {money(selectedPatron.adt, locale)}</strong></div>
                  <div><small>{tx(locale, "积分", "積分", "Points")}</small><strong>{money(selectedPatron.pointsBalance, locale)}</strong></div>
                  <div><small>{tx(locale, "风险", "風險", "Risk")}</small><strong className={selectedPatron.activeRiskCount ? "risk" : "safe"}>{selectedPatron.activeRiskCount || 0}</strong></div>
                </div>
                <section className={`customer-nba-card ${selectedPatronRecommendation.governanceStatus}`}>
                  <div className="customer-nba-head">
                    <div><span>TRUSTED NEXT BEST ACTION</span><h4>{selectedPatronRecommendation.title}</h4></div>
                    <b>{selectedPatronRecommendation.confidence}%</b>
                  </div>
                  <p>{selectedPatronRecommendation.detail}</p>
                  <div className="customer-nba-metrics">
                    <div><small>{tx(locale, "预计成本", "預計成本", "Cost")}</small><strong>{selectedPatronRecommendation.estimatedCost}</strong></div>
                    <div><small>{tx(locale, "有效窗口", "有效窗口", "Window")}</small><strong>{selectedPatronRecommendation.validity}</strong></div>
                    <div><small>{tx(locale, "治理状态", "治理狀態", "Governance")}</small><strong>{selectedPatronRecommendation.governanceLabel}</strong></div>
                  </div>
                  <div className="customer-governance-flow">
                    <span className="done">1 AI {tx(locale, "生成建议", "產生建議", "draft")}</span>
                    <span className={selectedPatronRecommendation.governanceStatus === "blocked" ? "blocked" : "done"}>2 {selectedPatronRecommendation.governanceStatus === "blocked" ? tx(locale, "风险管控", "風險管控", "risk control") : tx(locale, "治理校验通过", "治理校驗通過", "governance passed")}</span>
                    <span className={["approved", "sent"].includes(selectedRecommendationStatus) ? "done" : selectedPatronRecommendation.governanceStatus === "blocked" || selectedRecommendationStatus === "rejected" ? "blocked" : "active"}>3 {tx(locale, "主管审批", "主管審批", "approval")}</span>
                    <span className={selectedRecommendationStatus === "sent" ? "done" : selectedRecommendationStatus === "sending" ? "active" : ""}>4 {tx(locale, "触达客户", "觸達客戶", "delivery")}</span>
                  </div>
                  <div className="customer-nba-evidence">
                    {selectedPatronRecommendation.evidence.map((item) => <code key={item}>{item}</code>)}
                  </div>
                  <div className="customer-policy-note"><strong>{tx(locale, "治理说明", "治理說明", "Policy note")}</strong><p>{selectedPatronRecommendation.policyReason}</p></div>
                  <div className="customer-nba-actions">
                    <button type="button" disabled={selectedPatronRecommendation.governanceStatus === "blocked" || ["approving", "approved", "sending", "sent"].includes(selectedRecommendationStatus)} onClick={() => void setRecommendationDecision("approved")}>
                      {selectedRecommendationStatus === "approving" ? tx(locale, "审批中", "審批中", "Approving") : selectedRecommendationStatus === "approved" || selectedRecommendationStatus === "sent" ? `✓ ${tx(locale, "已批准", "已批准", "Approved")}` : tx(locale, "批准建议", "批准建議", "Approve")}
                    </button>
                    <button type="button" disabled={selectedPatronRecommendation.governanceStatus === "blocked" || ["rejecting", "rejected", "sent"].includes(selectedRecommendationStatus)} onClick={() => void setRecommendationDecision("rejected")}>
                      {selectedRecommendationStatus === "rejecting" ? tx(locale, "拒绝中", "拒絕中", "Rejecting") : selectedRecommendationStatus === "rejected" ? `× ${tx(locale, "已拒绝", "已拒絕", "Rejected")}` : tx(locale, "拒绝", "拒絕", "Reject")}
                    </button>
                    <button type="button" disabled={selectedRecommendationStatus !== "approved"} onClick={() => void sendGovernedRecommendation()}>
                      {selectedRecommendationStatus === "sending" ? tx(locale, "发送中", "發送中", "Sending") : selectedRecommendationStatus === "sent" ? `✓ ${tx(locale, "已发送 WhatsApp", "已發送 WhatsApp", "WhatsApp sent")}` : tx(locale, "审批后发送 WhatsApp", "審批後發送 WhatsApp", "Send WhatsApp after approval")}
                    </button>
                  </div>
                  <div className="customer-host-script"><strong>{tx(locale, "客户经理话术", "客戶經理話術", "Host script")}</strong><p>{selectedPatronRecommendation.hostMessage}</p>{recommendationAuditIds[selectedPatron.patronId] && <code>{tx(locale, "审计编号", "審計編號", "Audit ID")} · {recommendationAuditIds[selectedPatron.patronId]}</code>}</div>
                </section>
                <div className="customer360-sections">
                  <section><span>01</span><h4>{tx(locale, "偏好与标签", "偏好與標籤", "Preferences & tags")}</h4><div className="profile-tags">{[...selectedPatron.preferredGames, ...(selectedPatron.activeSession?.behaviorTags || []), ...selectedPatron.riskFlags].length ? [...new Set([...selectedPatron.preferredGames, ...(selectedPatron.activeSession?.behaviorTags || []), ...selectedPatron.riskFlags])].map((tag) => <i key={tag}>{tag}</i>) : <p>{tx(locale, "画像 API 暂无偏好字段；可通过 AI 查询补充。", "畫像 API 暫無偏好欄位；可透過 AI 查詢補充。", "No preference field is available in the lightweight profile response; use AI query to enrich it.")}</p>}</div></section>
                  <section><span>02</span><h4>{tx(locale, "实时 Session", "即時 Session", "Live session")}</h4>{selectedPatron.activeSession ? <dl><div><dt>{tx(locale, "桌台", "桌台", "Table")}</dt><dd>{selectedPatron.activeSession.tableId}</dd></div><div><dt>{tx(locale, "投注", "投注", "Wager")}</dt><dd>HKD {money(selectedPatron.activeSession.sessionBetAmount, locale)}</dd></div><div><dt>{tx(locale, "筹码", "籌碼", "Stack")}</dt><dd>HKD {money(selectedPatron.activeSession.currentStackEstimate, locale)}</dd></div></dl> : <p>{tx(locale, "当前没有活动 Session。", "目前沒有活動 Session。", "No active session.")}</p>}</section>
                  <section><span>03</span><h4>{tx(locale, "规则评估", "規則評估", "Rule assessment")}</h4><p>{selectedPatron.activeRiskCount ? tx(locale, `存在 ${selectedPatron.activeRiskCount} 条活动风险案例，刺激型优惠应保持拦截并由管理员复核。`, `存在 ${selectedPatron.activeRiskCount} 條活動風險案例，刺激型優惠應保持攔截並由管理員複核。`, `${selectedPatron.activeRiskCount} active risk case(s); gaming incentives should remain blocked pending administrator review.`) : tx(locale, "当前没有活动风险案例，可由 AI 结合偏好与历史响应生成下一步建议。", "目前沒有活動風險案例，可由 AI 結合偏好與歷史回應產生下一步建議。", "No active risk case; AI can generate a next action using preference and response history.")}</p><button type="button" onClick={() => { setPrompt(defaultPrompt(locale, "moment", selectedPatron.patronId, selectedPatron.activeSession?.tableId || selectedTableId)); setExperience("moment"); setActiveView("chat"); }}>{tx(locale, "询问 AI", "詢問 AI", "Ask AI")} →</button></section>
                </div>
              </article> : <div className="customer360-empty">{patrons.length ? tx(locale, "请调整客户筛选条件。", "請調整客戶篩選條件。", "Adjust the patron filters.") : tx(locale, "正在加载真实客户…", "正在載入真實客戶…", "Loading live patrons…")}</div>}
            </section>}

            {activeView === "scenarios" && <section className="scenario-studio command-module scenario-runbook">
              <div className="scenario-studio-head"><div><span>DEMO RUNBOOK</span><h3>{tx(locale, "TapData 聚合表 → AI 场景决策演示", "TapData 聚合表 → AI 場景決策演示", "TapData aggregate → AI decision demo")}</h3></div><button type="button" onClick={() => setActiveView("simulate")}>+ {tx(locale, "自定义场景", "自訂場景", "Custom scenario")}</button></div>
              {scenarioNotice && <div className="scenario-notice">✓ {scenarioNotice}<button type="button" onClick={() => setActiveView("overview")}>{tx(locale, "查看大盘", "查看大盤", "View dashboard")} →</button></div>}
              <div className="scenario-workbench">
                <aside className="scenario-list" aria-label={tx(locale, "场景列表", "場景列表", "Scenario list")}>{templates.map((template, index) => <button type="button" key={template.id} className={selectedScenario.id === template.id ? "active" : ""} onClick={() => setSelectedScenarioId(template.id)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{template.title}</strong><small>{template.trigger}</small></div><b>{template.icon}</b></button>)}</aside>
                <div className="scenario-main">
                  <section className="scenario-selected"><div><span>{selectedScenario.icon}</span><div><h4>{selectedScenario.title}</h4><p>{selectedScenario.detail}</p></div></div><dl><div><dt>{tx(locale, "桌台", "桌台", "Table")}</dt><dd>{selectedScenario.tableId}</dd></div><div><dt>{tx(locale, "投注", "投注", "Bet")}</dt><dd>HKD {money(selectedScenario.bet, locale)}</dd></div><div><dt>{tx(locale, "信号", "訊號", "Signal")}</dt><dd>{selectedScenario.tags.join(" · ")}</dd></div></dl></section>
                  <section className="tapdata-aggregate-panel"><div className="scenario-panel-head"><span>TAPDATA AGGREGATE</span><strong>{selectedScenario.aggregateName}</strong></div><p>{tx(locale, "建议在 TapData CDC 中把实时 Session、客户画像、风险案例、优惠响应与桌台状态聚合成这张结果表，AI 只读这张表就能快速解释场景。", "建議在 TapData CDC 中把即時 Session、客戶畫像、風險案例、優惠回應與桌台狀態聚合成這張結果表，AI 只讀這張表就能快速解釋場景。", "Build this aggregate in TapData CDC from sessions, profiles, risk cases, offer response and table state. AI can read this single result table for fast scenario explanation.")}</p><pre>{JSON.stringify(selectedScenarioAggregate, null, 2)}</pre></section>
                  <div className="scenario-demo-grid">
                    <section><div className="scenario-panel-head"><span>01 TAPDATA</span><strong>{tx(locale, "CDC 模拟输入", "CDC 模擬輸入", "CDC input")}</strong></div><pre>{scenarioCdcPayload(selectedScenario, selectedScenarioPatron)}</pre></section>
                    <section><div className="scenario-panel-head"><span>02 AI PANEL</span><strong>{tx(locale, "现场操作脚本", "現場操作腳本", "Panel script")}</strong></div><ol><li>{tx(locale, "先在 TapData 展示源表变更进入 MongoDB。", "先在 TapData 展示源表變更進入 MongoDB。", "Show the source change flowing into MongoDB in TapData.")}</li><li>{tx(locale, `发布聚合结果表 API：${selectedScenario.aggregateName}/find。`, `發布聚合結果表 API：${selectedScenario.aggregateName}/find。`, `Publish aggregate API: ${selectedScenario.aggregateName}/find.`)}</li><li>{tx(locale, "回到 AI 面板，点击“注入场景并准备 AI”。", "回到 AI 面板，點擊「注入場景並準備 AI」。", "Return here and click Inject scenario and prepare AI.")}</li><li>{tx(locale, "进入 AI Chat，直接运行已生成的问题。", "進入 AI Chat，直接執行已產生的問題。", "Open AI Chat and run the generated prompt.")}</li></ol><div className="scenario-prompt-box">{scenarioPrompt(locale, selectedScenario, selectedScenarioPatron)}</div></section>
                  </div>
                  <section className="demo-runbook-panel">
                    <div className="scenario-panel-head"><span>LIVE DEMO OPS</span><strong>{tx(locale, "真实 CDC + 聚合实操流程", "真實 CDC + 聚合實操流程", "Live CDC + aggregate runbooks")}</strong></div>
                    <div className="demo-runbook-grid">{demoRuns.map((runbook) => <article key={runbook.id}><header><span>{runbook.badge}</span><h4>{runbook.title}</h4><p>{runbook.summary}</p></header><div className="runbook-code"><b>{tx(locale, "源端模拟操作", "源端模擬操作", "Source-side operation")}</b><pre>{runbook.sourceMutation}</pre></div><div className="runbook-checks"><b>{tx(locale, "TapData 观察点", "TapData 觀察點", "TapData checkpoints")}</b><ol>{runbook.tapdataChecks.map((step) => <li key={step}>{step}</li>)}</ol></div><div className="runbook-question"><b>AI Chat</b><p>{runbook.aiQuestion}</p></div><footer><button type="button" onClick={() => prepareDemoRunbook(runbook)}>{tx(locale, "带入 AI 问题", "帶入 AI 問題", "Prepare AI question")}</button><button type="button" onClick={() => prepareDemoRunbook(runbook, true)}>{tx(locale, "打开 AI Chat", "打開 AI Chat", "Open AI Chat")}</button></footer></article>)}</div>
                  </section>
                  <div className="scenario-actions"><button type="button" onClick={() => runScenario(selectedScenario)}>{tx(locale, "注入场景并准备 AI", "注入場景並準備 AI", "Inject and prepare AI")}</button><button type="button" onClick={() => { setExperience(scenarioExperience(selectedScenario)); setPrompt(scenarioPrompt(locale, selectedScenario, selectedScenarioPatron)); setSelectedTableId(selectedScenario.tableId); setActiveView("chat"); }}>{tx(locale, "打开 AI Chat", "打開 AI Chat", "Open AI Chat")}</button><button type="button" onClick={() => setActiveView("simulate")}>{tx(locale, "手动造数", "手動造數", "Manual data")}</button></div>
                </div>
              </div>
              <div className="story-architecture"><span>01 Source CDC</span><i>→</i><span>02 TapData {tx(locale, "聚合表", "聚合表", "aggregate")}</span><i>→</i><span>03 AI Chat</span><i>→</i><span>04 {tx(locale, "治理动作", "治理動作", "Governed action")}</span></div>
            </section>}

            {activeView === "simulate" && <section className="simulator-module command-module"><div className="simulation-banner"><div><span>LOCAL SIMULATION LAYER</span><h3>{tx(locale, "手动创建 Session 数据", "手動建立 Session 數據", "Create session data manually")}</h3><p>{tx(locale, "数据仅保存在当前浏览器，不会写入 MongoDB；可以安全用于 Demo 排练。", "數據只儲存在目前瀏覽器，不會寫入 MongoDB；可以安全用於 Demo 排練。", "Data stays in this browser and is not written to MongoDB, making it safe for demo rehearsal.")}</p></div><b>{simulatedSessions.length} LOCAL RECORDS</b></div>{scenarioNotice && <div className="scenario-notice">✓ {scenarioNotice}</div>}<form onSubmit={submitSimulation} className="simulation-form"><section><span>01</span><div><label>{tx(locale, "选择桌台", "選擇桌台", "Select table")}</label><select value={simTableId} onChange={(event) => setSimTableId(event.target.value)}>{tables.map((table) => <option value={table.id} key={table.id}>{table.id} · {table.game} · Zone {table.zone} · {table.patrons} patrons</option>)}</select></div></section><section><span>02</span><div><label>{tx(locale, "客户编号", "客戶編號", "Patron ID")}</label><input value={simPatronId} onChange={(event) => setSimPatronId(event.target.value)} /></div><div><label>{tx(locale, "在线状态", "線上狀態", "Session status")}</label><button className={simActive ? "simulation-switch active" : "simulation-switch"} type="button" onClick={() => setSimActive((value) => !value)}><i />{simActive ? "Active" : "Inactive"}</button></div></section><section><span>03</span><div><label>{tx(locale, "累计投注 HKD", "累計投注 HKD", "Cumulative wager HKD")}</label><input type="number" min="0" value={simBet} onChange={(event) => setSimBet(Number(event.target.value))} /></div><div><label>{tx(locale, "筹码估值 HKD", "籌碼估值 HKD", "Stack estimate HKD")}</label><input type="number" min="0" value={simStack} onChange={(event) => setSimStack(Number(event.target.value))} /></div></section><section className="tag-editor"><span>04</span><div><label>{tx(locale, "行为标签", "行為標籤", "Behavior tags")}</label><div>{behaviorOptions.map((tag) => <button type="button" key={tag} className={simTags.includes(tag) ? "active" : ""} onClick={() => setSimTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}>{tag}</button>)}</div></div></section><footer><button type="button" onClick={() => { setSimBet(22000); setSimStack(48000); setSimTags(["PromoSeeker"]); setSimActive(true); }}>{tx(locale, "重置", "重設", "Reset")}</button><button type="submit">+ {tx(locale, "创建本地 Session", "建立本地 Session", "Create local session")}</button></footer></form><div className="simulation-history"><div><span>RECENT LOCAL DATA</span>{simulatedSessions.length > 0 && <button type="button" onClick={() => setSimulatedSessions([])}>{tx(locale, "清空模拟数据", "清空模擬數據", "Clear simulations")}</button>}</div>{simulatedSessions.length ? simulatedSessions.slice(0, 8).map((session) => <article key={session.id}><i className={session.isActive ? "active" : ""} /><strong>{session.patronId}</strong><span>{session.tableId}</span><span>HKD {money(session.sessionBetAmount, locale)}</span><small>{session.behaviorTags.join(" · ") || "No tags"}</small></article>) : <p>{tx(locale, "还没有本地模拟数据。可以手动创建，或从场景工坊一键注入。", "還沒有本地模擬數據。可以手動建立，或從場景工坊一鍵注入。", "No local simulation data yet. Create one manually or inject one from Scenario Studio.")}</p>}</div></section>}
          </div>
        </div>
      </div>
      {tableAiModalOpen && selectedTable && (
        <div className="table-ai-overlay" role="presentation" onPointerDown={() => setTableAiModalOpen(false)}>
          <div className={`table-ai-modal ${selectedTable.state}`} role="dialog" aria-modal="true" aria-labelledby="table-ai-modal-title" onPointerDown={(event) => event.stopPropagation()}>
            <button className="table-ai-close" type="button" onClick={() => setTableAiModalOpen(false)} aria-label={tx(locale, "关闭桌台 AI 分析", "關閉桌台 AI 分析", "Close table AI analysis")}>×</button>
            <div className="table-ai-modal-head">
              <div>
                <span>TABLE AI ANALYSIS</span>
                <h3 id="table-ai-modal-title">{tx(locale, "桌台 AI 初判", "桌台 AI 初判", "Table AI brief")} · {selectedTable.id}</h3>
                <p>{selectedTable.game} · Zone {selectedTable.zone} · {tx(locale, "占用率", "佔用率", "Occupancy")} {selectedTable.occupancy}%</p>
              </div>
              <div className="table-ai-pulse"><strong>{selectedTable.trend}</strong><small>{selectedTable.patrons}/{selectedTable.capacity}</small></div>
            </div>
            <div className="table-ai-modal-stats">
              <div><span>{tx(locale, "客户", "客戶", "Patrons")}</span><strong>{selectedTable.patrons}</strong></div>
              <div><span>{tx(locale, "投注量", "投注量", "Wager")}</span><strong>{money(selectedTable.turnover, locale)}</strong></div>
              <div><span>VIP</span><strong>{selectedTable.vip}</strong></div>
              <div><span>{tx(locale, "风险信号", "風險訊號", "Risk signals")}</span><strong>{selectedTable.risks}</strong></div>
            </div>
            <section className="table-ai-patrons">
              <div className="table-ai-section-title">
                <b>{tx(locale, "桌上客户信息", "桌上客戶資訊", "Patrons at this table")}</b>
                <span>{selectedTablePatrons.length + selectedTableSimulatedSessions.length}/{selectedTable.patrons}</span>
              </div>
              {selectedTablePatrons.length || selectedTableSimulatedSessions.length ? (
                <div className="table-ai-patron-list">
                  {selectedTablePatrons.slice(0, 25).map((item) => {
                    const session = item.activeSession;
                    const tags = [...new Set([item.tier, item.region, ...item.preferredGames.slice(0, 2), ...(session?.behaviorTags || []), ...item.riskFlags].filter(Boolean))];
                    return (
                      <button
                        type="button"
                        className={item.activeRiskCount ? "risk" : ["Diamond", "Platinum", "Gold"].includes(item.tier) ? "vip" : ""}
                        key={item.patronId}
                        onClick={() => {
                          setSelectedPatronId(item.patronId);
                          setTableAiModalOpen(false);
                          setActiveView("customer");
                        }}
                      >
                        <span className="table-ai-avatar">{item.patronId.replace(/\D/g, "").slice(-2).padStart(2, "0")}</span>
                        <div className="table-ai-patron-main">
                          <strong>{item.maskedName || item.patronId}<small>{item.patronId}</small></strong>
                          <p>{item.tier || "Unclassified"} · {item.region || "—"} · {tx(locale, "筹码", "籌碼", "Stack")} HKD {money(session?.currentStackEstimate || 0, locale)}</p>
                          <div>{tags.slice(0, 5).map((tag) => <i key={tag}>{tag}</i>)}</div>
                        </div>
                        <dl>
                          <div><dt>{tx(locale, "投注", "投注", "Wager")}</dt><dd>HKD {money(session?.sessionBetAmount || 0, locale)}</dd></div>
                          <div><dt>{tx(locale, "风险", "風險", "Risk")}</dt><dd>{item.activeRiskCount ? tx(locale, `${item.activeRiskCount} 条`, `${item.activeRiskCount} 條`, `${item.activeRiskCount}`) : "0"}</dd></div>
                        </dl>
                      </button>
                    );
                  })}
                  {selectedTableSimulatedSessions.slice(0, Math.max(0, 25 - selectedTablePatrons.length)).map((session) => (
                    <article className="local" key={session.id}>
                      <span className="table-ai-avatar">SIM</span>
                      <div className="table-ai-patron-main">
                        <strong>{session.patronId}<small>LOCAL SIMULATION</small></strong>
                        <p>{tx(locale, "本地模拟 Session", "本地模擬 Session", "Local simulated session")} · {tx(locale, "筹码", "籌碼", "Stack")} HKD {money(session.currentStackEstimate, locale)}</p>
                        <div>{session.behaviorTags.map((tag) => <i key={tag}>{tag}</i>)}</div>
                      </div>
                      <dl><div><dt>{tx(locale, "投注", "投注", "Wager")}</dt><dd>HKD {money(session.sessionBetAmount, locale)}</dd></div></dl>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="table-ai-empty">{tx(locale, "当前桌台没有可展示的活动客户。", "目前桌台沒有可展示的活動客戶。", "No active patron details are available for this table.")}</p>
              )}
            </section>
            <div className="table-ai-grid">
              <section><b>{tx(locale, "已观测信号", "已觀測訊號", "Observed signals")}</b><ul>{tableAiInsights(locale, selectedTable).map((insight) => <li key={insight}>{insight}</li>)}</ul></section>
              <section><b>{tx(locale, "自动生成的问题", "自動產生的問題", "Generated prompt")}</b><p>{tableAnalysisPrompt(locale, selectedTable)}</p></section>
            </div>
            <footer className="table-ai-modal-actions">
              <button type="button" onClick={() => setTableAiModalOpen(false)}>{tx(locale, "继续看热力图", "繼續看熱力圖", "Back to heatmap")}</button>
              <button type="button" onClick={() => { setTableAiModalOpen(false); prepareTableAnalysis(selectedTable, true); }}>{tx(locale, "打开 AI Chat 深入分析", "打開 AI Chat 深入分析", "Open AI Chat")} →</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
