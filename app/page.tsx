"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CommandCenter from "./command-center";
import { readLivePatronSnapshot, writeLivePatronSnapshot } from "./live-patron-cache";

type Locale = "zh-Hans" | "zh-Hant" | "en";

type ConfidenceInsight = {
  title: string;
  detail: string;
  confidence: number;
  tone: "mint" | "amber" | "blue";
};

type Scenario = {
  id: string;
  initials: string;
  label: string;
  tier: string;
  status: string;
  statusTone: "safe" | "watch" | "warm";
  table: string;
  game: string;
  duration: string;
  turnover: string;
  net: string;
  avgBet: string;
  latestBet: string;
  host: string;
  visits: string;
  value: string;
  preferences: string[];
  facts: { time: string; text: string; source: string }[];
  insights: ConfidenceInsight[];
  summary: string;
  change: string;
  signals: { label: string; value: string; tone: "neutral" | "warning" | "danger" }[];
  recommendation: {
    title: string;
    subtitle: string;
    acceptance: number;
    cost: string;
    validity: string;
    reasons: string[];
    hostMessage: string;
  };
  alternatives: { title: string; meta: string; status: "eligible" | "blocked" }[];
  answer: string;
};

type ScenarioTranslation = {
  label: string;
  tier: string;
  status: string;
  game: string;
  duration: string;
  visits: string;
  value: string;
  preferences: string[];
  facts: string[];
  insights: { title: string; detail: string }[];
  summary: string;
  change: string;
  signals: { label: string; value: string }[];
  recommendation: {
    title: string;
    subtitle: string;
    validity: string;
    reasons: string[];
    hostMessage: string;
  };
  alternatives: { title: string; meta: string }[];
  answer: string;
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

type LiveSourceCounts = {
  patron_profiles: number;
  patron_table_sessions: number;
  patron_risk_cases: number;
  offer_recommendations: number;
  chat_messages: number;
};

type UpgradeJourney = {
  journeyId: string;
  patronId: string;
  status: "running" | "completed";
  stage: number;
  elapsedSeconds: number;
  secondsRemaining: number;
  startedAt: string;
  endsAt: string;
  updatedAt: string;
  currentTier: string;
  currentWager: number;
  recommendation: string;
  thresholds: { gold?: number; platinum?: number; diamond: number };
  collection: string;
  database: string;
  tableId?: string;
  seatedAt?: string | null;
  behaviorTags?: string[];
  currentStackEstimate?: number;
};

type FilterState = {
  status: "all" | "watch" | "safe" | "warm";
  tier: "all" | "diamond" | "platinum" | "gold" | "silver" | "bronze";
  game: "all" | "baccarat" | "blackjack" | "poker";
  tag: "all" | "aggressive" | "conservative" | "highVariance" | "noHistory";
};

const defaultFilters: FilterState = { status: "all", tier: "all", game: "all", tag: "all" };

// Keep the one-minute upgrade story bounded to a casino-realistic maximum.
// Source snapshots remain untouched; only the persisted demo journey overlay
// is capped so a stale upstream value cannot jump past the final stage.
const DEMO_MAX_SESSION_WAGER = 1_200_000;

type DeliveryChannel = "whatsapp" | "sms" | "push";
type AlertWorkflowStatus = "open" | "sending" | "sent" | "closing" | "closed";
type RecommendationDeliveryLog = {
  channel: DeliveryChannel;
  fingerprint: string;
  sentAt: string;
};
type AlertWorkflowLog = {
  status: AlertWorkflowStatus;
  eventId?: string;
  sentAt?: string;
  closedAt?: string;
  persisted?: boolean;
  mode?: string;
};

type AuditPersistResponse = {
  ok?: boolean;
  persisted?: boolean;
  mode?: string;
  eventId?: string;
  createdAt?: string;
  error?: string;
};

type MongoSnapshot = {
  patronId: string;
  maskedName: string;
  tier: string;
  region: string;
  adt: string;
  points: string;
  tableId: string;
  sessionBet: string;
  stack: string;
  behavior: string;
  riskFlag: string;
  reportId: string;
  reportStatus: string;
  model: string;
  suggestedPr: string;
  alertLevel: "critical" | "warning" | "review";
  alertZh: string;
  alertEn: string;
  riskCategoryZh?: string;
  riskCategoryEn?: string;
  riskTriggerZh?: string;
  riskTriggerEn?: string;
  riskActionZh?: string;
  riskActionEn?: string;
};

const mongoSnapshots: Record<string, MongoSnapshot> = {
  "VIP-7821": {
    patronId: "TEST-S1-P1", maskedName: "T***AP", tier: "Gold", region: "International",
    adt: "HKD 8,500", points: "45,000", tableId: "T-0001", sessionBet: "HKD 5,000",
    stack: "HKD 9,513", behavior: "Aggressive", riskFlag: "HighVariance",
    reportId: "RPT-1785400436165-TEST-S1-P1", reportStatus: "Draft", model: "deepseek-chat",
    suggestedPr: "Malachi W. · PR-0002", alertLevel: "critical",
    alertZh: "高波动客户出现激进行为，AI 草稿包含刺激型回赠建议，需治理复核。",
    alertEn: "High-variance patron shows aggressive behavior; the AI draft includes an incentive that requires governance review.",
  },
  "VIP-1846": {
    patronId: "TEST-S2-P1", maskedName: "T***GM", tier: "Silver", region: "Guangdong",
    adt: "HKD 5,200", points: "12,000", tableId: "T-0001", sessionBet: "HKD 14,000",
    stack: "HKD 23,546", behavior: "Conservative", riskFlag: "None",
    reportId: "RPT-1785406442546-TEST-S2-P1", reportStatus: "Draft", model: "deepseek-chat",
    suggestedPr: "Toby M. · PR-0020", alertLevel: "review",
    alertZh: "Session 标签与 AI 报告结论存在差异，发送高成本礼遇前需要人工确认。",
    alertEn: "The session tag conflicts with the AI report; human verification is required before a high-cost benefit is sent.",
  },
  "VIP-3149": {
    patronId: "TEST-S3-P1", maskedName: "T***DT", tier: "Bronze", region: "Taiwan",
    adt: "HKD 3,000", points: "5,000", tableId: "T-0001", sessionBet: "HKD 18,000",
    stack: "HKD 40,710", behavior: "Aggressive", riskFlag: "HighVariance",
    reportId: "RPT-1785393735796-TEST-S3-P1", reportStatus: "Draft", model: "deepseek-chat",
    suggestedPr: "Toby M. · PR-0020", alertLevel: "warning",
    alertZh: "Session 投注金额达到 ADT 的 6 倍，并同时出现 Aggressive 与 HighVariance 信号。",
    alertEn: "Session wagering is 6× ADT with both Aggressive and HighVariance signals present.",
  },
};

type PulseMetric = "profiles" | "sessions" | "recommendations" | "risks" | "messages";

type PulseDetail = {
  title: string;
  summary: string;
  collection: string;
  stats: { label: string; value: string; note: string }[];
};

const pulseDetailsZh: Record<PulseMetric, PulseDetail> = {
  profiles: {
    title: "310 个客户画像",
    summary: "覆盖会员等级、地区、游戏偏好、ADT、积分与风险标记，是 AI 客户上下文的基础。",
    collection: "patron_profiles",
    stats: [
      { label: "会员等级", value: "Gold 69 · Bronze 64 · Silver 63", note: "另有 Diamond 58、Platinum 56" },
      { label: "主要地区", value: "香港 85 · 广东 84 · 澳门 60", note: "另含台湾、大湾区及国际客户" },
      { label: "热门游戏", value: "Poker 140 · Roulette 129 · Blackjack 124", note: "按 preferredGames 多值统计" },
    ],
  },
  sessions: {
    title: "292 个活跃 Session",
    summary: "记录客户所在桌台、入座与最近动作时间、累计投注、筹码估算以及实时行为标签。",
    collection: "patron_table_sessions + table_state_snapshots",
    stats: [
      { label: "活跃状态", value: "292 Active", note: "当前样本中的 Session 均为活跃状态" },
      { label: "主要行为", value: "Aggressive 110 · Conservative 88", note: "CardCounterWatch 88 · LateNight 76" },
      { label: "桌台状态", value: "Open 11 · Busy 10 · Closed 9", note: "30 个实时桌台快照" },
    ],
  },
  recommendations: {
    title: "600 条 AI 推荐",
    summary: "保存推荐权益、相关性、置信度、下一步动作、有效期与审批状态。",
    collection: "offer_recommendations + offer_catalog",
    stats: [
      { label: "推荐状态", value: "Proposed 225 · Sent 197 · Approved 178", note: "可用于计算审批与发送转化" },
      { label: "立即发送", value: "227", note: "Send offer now" },
      { label: "人工跟进", value: "189", note: "Let host call patron；另有酒店组合 184" },
    ],
  },
  risks: {
    title: "126 个风险案例",
    summary: "风险案例可触发治理拦截、管理员告警和 WhatsApp 通知，并保留完整处理时间线。",
    collection: "patron_risk_cases + alert_rules",
    stats: [
      { label: "风险等级", value: "Medium 54 · Low 36 · High 34 · Critical 2", note: "High 与 Critical 应直接通知管理员" },
      { label: "等待管理员", value: "47", note: "AwaitingAdmin" },
      { label: "已处理状态", value: "Rejected 26 · Assigned 22 · Approved 14", note: "另有 InReview 13、Draft 4" },
    ],
  },
  messages: {
    title: "120 条 AI 消息",
    summary: "记录用户问题、AI 回复、模型、Agent、引用证据和生成时间，用于解释与审计。",
    collection: "chat_sessions + chat_messages",
    stats: [
      { label: "消息角色", value: "User 60 · Assistant 60", note: "每个会话保留双向记录" },
      { label: "AI Agent", value: "offer_strategist_agent 60", note: "营销用户消息 60" },
      { label: "引用证据", value: "references[]", note: "关联客户、Offer 与分析报告" },
    ],
  },
};

const pulseDetailsEn: Record<PulseMetric, PulseDetail> = {
  profiles: {
    title: "310 patron profiles",
    summary: "Tier, region, game preference, ADT, points and risk flags form the base customer context for AI.",
    collection: "patron_profiles",
    stats: [
      { label: "Tiers", value: "Gold 69 · Bronze 64 · Silver 63", note: "Plus Diamond 58 and Platinum 56" },
      { label: "Top regions", value: "Hong Kong 85 · Guangdong 84 · Macau 60", note: "Also Taiwan, GBA and international patrons" },
      { label: "Top games", value: "Poker 140 · Roulette 129 · Blackjack 124", note: "Multi-value preferredGames count" },
    ],
  },
  sessions: {
    title: "292 active sessions",
    summary: "Tracks table, seating and action times, session wager, stack estimate and live behavior tags.",
    collection: "patron_table_sessions + table_state_snapshots",
    stats: [
      { label: "Active state", value: "292 Active", note: "All sessions in the current sample are active" },
      { label: "Top behaviors", value: "Aggressive 110 · Conservative 88", note: "CardCounterWatch 88 · LateNight 76" },
      { label: "Table status", value: "Open 11 · Busy 10 · Closed 9", note: "30 live table snapshots" },
    ],
  },
  recommendations: {
    title: "600 AI recommendations",
    summary: "Stores benefits, relevance, confidence, next action, expiry and approval state.",
    collection: "offer_recommendations + offer_catalog",
    stats: [
      { label: "Status", value: "Proposed 225 · Sent 197 · Approved 178", note: "Supports approval and delivery conversion" },
      { label: "Send now", value: "227", note: "Send offer now" },
      { label: "Human follow-up", value: "189", note: "Host call; another 184 use a hotel bundle" },
    ],
  },
  risks: {
    title: "126 risk cases",
    summary: "Risk cases can trigger governance blocks, administrator alerts and WhatsApp notifications with a full timeline.",
    collection: "patron_risk_cases + alert_rules",
    stats: [
      { label: "Risk levels", value: "Medium 54 · Low 36 · High 34 · Critical 2", note: "High and Critical route directly to an administrator" },
      { label: "Awaiting admin", value: "47", note: "AwaitingAdmin" },
      { label: "Handled states", value: "Rejected 26 · Assigned 22 · Approved 14", note: "Plus InReview 13 and Draft 4" },
    ],
  },
  messages: {
    title: "120 AI messages",
    summary: "Captures prompts, AI replies, model, agent, references and timestamps for explanation and audit.",
    collection: "chat_sessions + chat_messages",
    stats: [
      { label: "Roles", value: "User 60 · Assistant 60", note: "Both sides of each conversation are retained" },
      { label: "AI agent", value: "offer_strategist_agent 60", note: "60 marketing-user messages" },
      { label: "Evidence links", value: "references[]", note: "Links patrons, offers and analysis reports" },
    ],
  },
};

function matchesScenario(item: Scenario, filters: FilterState, snapshots: Record<string, MongoSnapshot>, searchQuery = "") {
  const snapshot = snapshots[item.id];
  const normalizedTier = snapshot?.tier.toLocaleLowerCase();
  const normalizedGame = item.game.toLocaleLowerCase().replace(/\s+/g, "");
  const tags = [snapshot?.behavior, snapshot?.riskFlag].filter(Boolean).join(" ").toLocaleLowerCase();
  if (filters.status !== "all" && item.statusTone !== filters.status) return false;
  if (filters.tier !== "all" && normalizedTier !== filters.tier) return false;
  if (filters.game !== "all" && !normalizedGame.includes(filters.game)) return false;
  if (filters.tag !== "all" && !tags.includes(filters.tag.toLocaleLowerCase())) return false;
  const query = searchQuery.trim().toLocaleLowerCase();
  if (!query) return true;
  return [item.id, item.label, item.tier, item.status, item.host, item.game, snapshot?.patronId, snapshot?.maskedName, snapshot?.tier, snapshot?.region, snapshot?.behavior, snapshot?.riskFlag, ...item.preferences]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}

const scenarios: Scenario[] = [
  {
    id: "VIP-7821",
    initials: "78",
    label: "客户 7821",
    tier: "白金",
    status: "需关注",
    statusTone: "watch",
    table: "B12",
    game: "百家乐",
    duration: "1 小时 36 分钟",
    turnover: "MOP 482K",
    net: "− MOP 86.4K",
    avgBet: "MOP 8.6K",
    latestBet: "MOP 18.4K",
    host: "Sofia M.",
    visits: "18 次 / 90 天",
    value: "前 7%",
    preferences: ["粤式餐饮", "私人休息室", "延迟退房"],
    facts: [
      { time: "22:46", text: "最近 15 分钟平均下注升至基线的 2.3 倍", source: "table_session" },
      { time: "22:39", text: "本次游戏时段累计时长超过 90 分钟", source: "session_clock" },
      { time: "21:58", text: "历史上 4 次餐饮邀请接受 3 次", source: "interaction_history" },
    ],
    insights: [
      { title: "短期行为波动", detail: "下注节奏明显加快，需要优先关注体验与节奏，而非继续刺激游戏。", confidence: 92, tone: "amber" },
      { title: "非博彩礼遇偏好", detail: "餐饮和休息室权益的历史响应显著高于筹码型优惠。", confidence: 86, tone: "mint" },
      { title: "客户经理介入时机", detail: "当前是由熟悉的客户经理主动问候并邀请短暂休息的合适窗口。", confidence: 81, tone: "blue" },
    ],
    summary: "高价值客户正处于行为波动期。建议暂停博彩类激励，以熟悉客户经理的非博彩关怀降低压力并提升体验。",
    change: "发现 3 个新信号：下注强度上升、游戏时段过长、短期净值波动。原筹码优惠已被策略替换。",
    signals: [
      { label: "游戏强度", value: "高", tone: "warning" },
      { label: "责任博彩", value: "需审核", tone: "danger" },
      { label: "优惠资格", value: "受限", tone: "warning" },
    ],
    recommendation: {
      title: "邀请至贵宾休息室",
      subtitle: "由 Sofia 进行个人问候，并提供双人餐饮体验",
      acceptance: 78,
      cost: "MOP 1,200",
      validity: "30 分钟",
      reasons: ["3/4 次餐饮邀请被接受", "与当前风险限制兼容", "熟悉的客户经理在线且可立即执行"],
      hostMessage: "晚上好，我是 Sofia。餐厅刚为您保留了一个安静的位置，如果您愿意，我可以陪您过去稍作休息。",
    },
    alternatives: [
      { title: "安排专车与夜宵", meta: "预计接受率 62%", status: "eligible" },
      { title: "赠送额外筹码", meta: "命中 RG-14 · 暂停博彩激励", status: "blocked" },
    ],
    answer: "不建议赠送筹码。最近 15 分钟下注强度达到客户基线的 2.3 倍，同时 Session 已超过 90 分钟。策略 RG-14 要求暂停博彩类激励，因此系统选择了历史响应更高的餐饮与休息室权益。",
  },
  {
    id: "VIP-1846",
    initials: "18",
    label: "客户 1846",
    tier: "钻石",
    status: "状态良好",
    statusTone: "safe",
    table: "A07",
    game: "百家乐",
    duration: "48 分钟",
    turnover: "MOP 316K",
    net: "+ MOP 24.8K",
    avgBet: "MOP 6.2K",
    latestBet: "MOP 6.8K",
    host: "Marcus L.",
    visits: "24 次 / 90 天",
    value: "前 3%",
    preferences: ["套房升级", "日式餐饮", "机场接送"],
    facts: [
      { time: "20:18", text: "投注节奏稳定，未发现异常行为波动", source: "table_session" },
      { time: "19:52", text: "本次入住尚未使用任何专属礼遇", source: "offer_history" },
      { time: "18:34", text: "过去 3 次套房升级全部接受", source: "interaction_history" },
    ],
    insights: [
      { title: "稳定高价值", detail: "当前表现与长期基线一致，适合提供高感知价值的个性化服务。", confidence: 95, tone: "mint" },
      { title: "住宿权益偏好", detail: "套房与延迟退房是最稳定的权益响应信号。", confidence: 91, tone: "blue" },
      { title: "即时服务窗口", detail: "客户尚未使用礼遇，且 Host 当前可立即完成确认。", confidence: 84, tone: "mint" },
    ],
    summary: "稳定的高价值客户，当前风险状态正常。套房升级与次日延迟退房是匹配度最高的即时礼遇。",
    change: "客户刚完成酒店入住，检测到未使用礼遇；套房升级库存仍可用。",
    signals: [
      { label: "游戏强度", value: "正常", tone: "neutral" },
      { label: "责任博彩", value: "通过", tone: "neutral" },
      { label: "优惠资格", value: "可执行", tone: "neutral" },
    ],
    recommendation: {
      title: "套房升级 + 延迟退房",
      subtitle: "由 Marcus 确认房型，并安排次日 15:00 退房",
      acceptance: 91,
      cost: "MOP 2,400",
      validity: "2 小时",
      reasons: ["最近 3 次同类权益全部接受", "当前存在可用库存", "风险与预算规则均已通过"],
      hostMessage: "晚上好，我是 Marcus。我们今晚有一间您偏好的套房可供升级，也为您安排了明天下午三点退房。需要我现在帮您确认吗？",
    },
    alternatives: [
      { title: "日料餐厅优先席位", meta: "预计接受率 74%", status: "eligible" },
      { title: "机场专车升级", meta: "预计接受率 58%", status: "eligible" },
    ],
    answer: "推荐套房升级主要基于三项事实：客户最近三次均接受同类权益、本次入住还没有使用专属礼遇，并且库存与预算当前都可用。该建议的预计接受率为 91%。",
  },
  {
    id: "VIP-3149",
    initials: "31",
    label: "客户 3149",
    tier: "黄金",
    status: "回访机会",
    statusTone: "warm",
    table: "C03",
    game: "二十一点",
    duration: "27 分钟",
    turnover: "MOP 72K",
    net: "+ MOP 3.1K",
    avgBet: "MOP 1.8K",
    latestBet: "MOP 2.0K",
    host: "Amelia C.",
    visits: "3 次 / 90 天",
    value: "前 18%",
    preferences: ["现场音乐", "鸡尾酒吧", "周末活动"],
    facts: [
      { time: "21:31", text: "距离上次到访已有 43 天", source: "visit_history" },
      { time: "21:20", text: "连续 5 次忽略通用优惠信息", source: "campaign_events" },
      { time: "20:56", text: "曾两次主动咨询周末音乐活动", source: "interaction_history" },
    ],
    insights: [
      { title: "通用优惠疲劳", detail: "客户对价格型信息响应较低，不宜继续增加同类触达。", confidence: 88, tone: "amber" },
      { title: "体验型兴趣", detail: "音乐和社交体验比直接优惠更能驱动互动。", confidence: 83, tone: "mint" },
      { title: "关系修复机会", detail: "低压力、个性化的 Host 问候更适合重新建立联系。", confidence: 79, tone: "blue" },
    ],
    summary: "客户在较长间隔后回访，通用优惠已出现疲劳。建议通过兴趣型活动与个人问候重新建立关系。",
    change: "识别到客户 43 天未到访，并重新进入现场；当前适合启动轻量回访旅程。",
    signals: [
      { label: "游戏强度", value: "正常", tone: "neutral" },
      { label: "流失概率", value: "中", tone: "warning" },
      { label: "优惠资格", value: "可执行", tone: "neutral" },
    ],
    recommendation: {
      title: "周末音乐活动邀请",
      subtitle: "由 Amelia 亲自邀请，并预留鸡尾酒吧座位",
      acceptance: 69,
      cost: "MOP 680",
      validity: "24 小时",
      reasons: ["历史主动咨询相关活动", "避免重复通用优惠", "适合低压力关系恢复"],
      hostMessage: "欢迎回来，我是 Amelia。这周末有一场您可能会喜欢的现场音乐活动，我可以为您预留一个安静的鸡尾酒吧座位。",
    },
    alternatives: [
      { title: "周末餐饮体验", meta: "预计接受率 55%", status: "eligible" },
      { title: "通用筹码优惠", meta: "近期连续 5 次未响应", status: "blocked" },
    ],
    answer: "客户过去连续五次忽略通用优惠，但曾两次主动咨询现场音乐活动。因此本次推荐以兴趣和关系恢复为核心，而不是继续提高优惠金额。",
  },
];

const englishScenarioText: Record<string, ScenarioTranslation> = {
  "VIP-7821": {
    label: "Patron 7821",
    tier: "Platinum",
    status: "Needs attention",
    game: "Baccarat",
    duration: "1h 36m",
    visits: "18 / 90 days",
    value: "Top 7%",
    preferences: ["Cantonese dining", "Private lounge", "Late checkout"],
    facts: [
      "Average bet in the last 15 minutes reached 2.3× the customer baseline",
      "The current session has exceeded 90 minutes",
      "Three of the last four dining invitations were accepted",
    ],
    insights: [
      { title: "Short-term behavior shift", detail: "Betting pace has accelerated. Prioritize comfort and pacing instead of further gaming stimulation." },
      { title: "Non-gaming benefit preference", detail: "Dining and lounge benefits have historically outperformed gaming-credit offers." },
      { title: "Host intervention window", detail: "This is a suitable moment for a familiar host to check in and offer a short break." },
    ],
    summary: "A high-value customer is showing short-term behavioral volatility. Pause gaming incentives and use a familiar host to offer non-gaming care.",
    change: "Three new signals: higher bet intensity, extended session duration, and short-term net volatility. The original gaming offer was replaced by policy.",
    signals: [
      { label: "Session intensity", value: "High" },
      { label: "Responsible gaming", value: "Review" },
      { label: "Offer eligibility", value: "Restricted" },
    ],
    recommendation: {
      title: "Invite to the private lounge",
      subtitle: "Personal check-in from Sofia with a dining experience for two",
      validity: "30 min",
      reasons: ["Three of four dining invitations were accepted", "Compatible with current risk restrictions", "A familiar host is available now"],
      hostMessage: "Good evening, this is Sofia. We have reserved a quiet table for you. If you would like, I can accompany you there for a short break.",
    },
    alternatives: [
      { title: "Private car and late supper", meta: "Estimated acceptance 62%" },
      { title: "Additional gaming credit", meta: "RG-14 · Gaming incentives paused" },
    ],
    answer: "Gaming credit is not recommended. Bet intensity reached 2.3× the customer baseline and the session is longer than 90 minutes. Policy RG-14 pauses gaming incentives, so the system selected higher-response dining and lounge benefits.",
  },
  "VIP-1846": {
    label: "Patron 1846",
    tier: "Diamond",
    status: "Healthy",
    game: "Baccarat",
    duration: "48m",
    visits: "24 / 90 days",
    value: "Top 3%",
    preferences: ["Suite upgrade", "Japanese dining", "Airport transfer"],
    facts: [
      "Betting pace is stable with no unusual behavioral change",
      "No exclusive benefit has been used during this stay",
      "All three recent suite upgrades were accepted",
    ],
    insights: [
      { title: "Stable high value", detail: "Current behavior matches the long-term baseline and supports a high-perceived-value service gesture." },
      { title: "Accommodation preference", detail: "Suite upgrades and late checkout are the strongest consistent response signals." },
      { title: "Immediate service window", detail: "No benefit has been used and the assigned host can confirm the offer immediately." },
    ],
    summary: "A stable high-value customer with a clear risk status. A suite upgrade and late checkout are the best-matched immediate benefits.",
    change: "The customer has just checked in, no benefit has been used, and upgrade inventory is available.",
    signals: [
      { label: "Session intensity", value: "Normal" },
      { label: "Responsible gaming", value: "Clear" },
      { label: "Offer eligibility", value: "Eligible" },
    ],
    recommendation: {
      title: "Suite upgrade + late checkout",
      subtitle: "Marcus confirms the room and arranges a 3:00 PM checkout",
      validity: "2 hours",
      reasons: ["The last three equivalent benefits were accepted", "Matching inventory is available", "Risk and budget checks passed"],
      hostMessage: "Good evening, this is Marcus. A suite matching your preference is available tonight, and we have arranged a 3:00 PM checkout tomorrow. Shall I confirm it for you?",
    },
    alternatives: [
      { title: "Priority Japanese dining table", meta: "Estimated acceptance 74%" },
      { title: "Airport transfer upgrade", meta: "Estimated acceptance 58%" },
    ],
    answer: "The suite upgrade is based on three facts: the customer accepted the last three equivalent benefits, has not used a benefit during this stay, and both inventory and budget are available. Estimated acceptance is 91%.",
  },
  "VIP-3149": {
    label: "Patron 3149",
    tier: "Gold",
    status: "Re-engagement",
    game: "Blackjack",
    duration: "27m",
    visits: "3 / 90 days",
    value: "Top 18%",
    preferences: ["Live music", "Cocktail bar", "Weekend events"],
    facts: [
      "It has been 43 days since the previous visit",
      "Five consecutive generic offers were ignored",
      "The customer asked about weekend music events twice",
    ],
    insights: [
      { title: "Generic offer fatigue", detail: "Price-led messages have low response and should not be repeated." },
      { title: "Experience-led interest", detail: "Music and social experiences are more likely to create engagement than direct incentives." },
      { title: "Relationship recovery", detail: "A low-pressure, personalized host greeting is the best way to rebuild the relationship." },
    ],
    summary: "The customer has returned after a long gap and shows generic-offer fatigue. Rebuild the relationship through an interest-led experience and personal greeting.",
    change: "The customer returned after 43 days. This is a good moment to begin a lightweight re-engagement journey.",
    signals: [
      { label: "Session intensity", value: "Normal" },
      { label: "Churn likelihood", value: "Medium" },
      { label: "Offer eligibility", value: "Eligible" },
    ],
    recommendation: {
      title: "Weekend live-music invitation",
      subtitle: "A personal invitation from Amelia with a reserved cocktail-bar seat",
      validity: "24 hours",
      reasons: ["The customer previously asked about similar events", "Avoids repeating generic offers", "Supports low-pressure relationship recovery"],
      hostMessage: "Welcome back, this is Amelia. We have a live-music event this weekend that you may enjoy, and I can reserve a quiet cocktail-bar seat for you.",
    },
    alternatives: [
      { title: "Weekend dining experience", meta: "Estimated acceptance 55%" },
      { title: "Generic gaming offer", meta: "Ignored five times recently" },
    ],
    answer: "The customer ignored five consecutive generic offers but asked about live music twice. This recommendation focuses on interest and relationship recovery rather than increasing the incentive amount.",
  },
};

const zhText = {
  brand: "AI 忠诚度引擎",
  title: "AI 决策工作台",
  localDemo: "本地演示",
  dataSynced: "MongoDB 上下文 · 本地只读快照",
  settings: "打开设置",
  customerQueue: "VIP 客户队列",
  previousCustomer: "上一位客户",
  nextCustomer: "下一位客户",
  autoTour: "自动轮播",
  searchCustomer: "搜索客户",
  searchHint: "输入 VIP 编号、等级、客户经理或游戏",
  noResults: "没有匹配的客户",
  clearSearch: "清除搜索",
  filters: "筛选",
  customerStatus: "客户状态",
  vipTier: "VIP 等级",
  gameType: "游戏类型",
  behaviorTag: "行为标签",
  all: "全部",
  needsAttention: "需关注",
  healthy: "状态良好",
  reengagement: "回访机会",
  platinum: "白金",
  diamond: "钻石",
  gold: "黄金",
  silver: "白银",
  bronze: "青铜",
  baccarat: "百家乐",
  blackjack: "二十一点",
  poker: "Poker",
  promoSeeker: "优惠偏好",
  aggressive: "激进投注",
  stable: "稳定",
  conservative: "保守投注",
  highVariance: "高波动",
  noHistory: "无互动历史",
  resetFilters: "重置筛选",
  showCustomers: "显示客户",
  realDataPulse: "MongoDB 数据脉搏",
  realSnapshot: "TapData API 实时读取",
  profilesCount: "310 客户画像",
  sessionsCount: "292 活跃 Session",
  recommendationsCount: "600 AI 推荐",
  risksCount: "126 风险案例",
  messagesCount: "120 AI 消息",
  viewDataDetails: "查看数据详情",
  sourceCollection: "来源集合",
  closeDialog: "关闭弹窗",
  evidencePackage: "真实数据证据包",
  evidenceCollections: "来自 4 个 MongoDB 集合",
  maskedPatron: "脱敏客户",
  tierRegion: "等级 / 地区",
  sessionBet: "Session 投注",
  stackEstimate: "筹码估算",
  behaviorRisk: "行为 / 风险",
  reportModel: "报告 / 模型",
  alertCenter: "告警中心",
  activeAlerts: "3 个待处理告警",
  activeAlertsSuffix: "个待处理告警",
  governanceCenter: "治理中心",
  noRiskAlerts: "当前没有待处理风险告警",
  noRiskAlertDetail: "当前真实数据未发现活动风险案例，不需要发送风险告警；推荐可进入正常治理审批流程。",
  noRiskAlertAction: "无需发送风险告警",
  notifyHost: "通知客户经理",
  sendRecommendation: "发送推荐",
  chooseChannel: "选择发送渠道",
  whatsapp: "WhatsApp",
  sms: "短信",
  appPush: "App Push",
  sendNow: "立即发送",
  sent: "已发送",
  deliveredTo: "已发送给",
  sendRiskAlert: "发送风险告警",
  sendingRiskAlert: "发送中",
  riskAlertSent: "已通知管理员",
  closeRiskAlert: "标记已处理",
  closingRiskAlert: "闭环中",
  riskAlertClosed: "已闭环",
  riskAlertAwaitingReview: "等待管理员复核",
  riskAlertClosedDetail: "管理员已处理，闭环记录已写入审计库",
  auditEvent: "审计事件",
  mongoPersisted: "Mongo 已落库",
  mongoNotConfigured: "Mongo 未配置，前端仅展示状态",
  mongoBridgeOffline: "Mongo 写入桥未启动，请重启 npm run dev",
  mongoPersistFailed: "Mongo 写入失败",
  riskAutoRoute: "风险告警自动路由",
  riskAdministrator: "风险值班管理员 · ADM-01",
  notificationPreview: "手机通知预览",
  deliveryReceipt: "发送回执",
  governanceFirst: "批准后才可发送",
  recommendationCompleted: "已推荐",
  recommendationCompletedDetail: "本次推荐已完成触达；如客户状态或画像变化，系统会重新生成可推荐动作。",
  language: "语言",
  presentStory: "演示故事",
  exitStory: "退出故事",
  runAnalysis: "运行 AI 分析",
  liveContext: "实时客户上下文",
  activeSession: "当前 Session",
  live: "实时",
  turnover: "Session 投注",
  estNet: "筹码估算",
  avgBet: "客户 ADT",
  latestBet: "积分余额",
  relationship: "AI 执行上下文",
  days90: "MongoDB",
  host: "建议客户经理",
  visits: "报告状态",
  customerValue: "地区",
  preferences: "行为与风险标签",
  aiAnalysis: "AI 客户分析",
  whatMatters: "此刻最值得关注的事情",
  lastRun: "上次分析",
  currentAssessment: "当前判断",
  new: "新增",
  whatChanged: "发生了什么变化？",
  observedFacts: "已观测事实",
  fromMongo: "来自 MongoDB 上下文",
  inferredInsights: "AI 推断洞察",
  explanationOnly: "解释结果，不是源数据",
  nextBestAction: "下一步最佳动作",
  recommendedNow: "当前推荐",
  governed: "已治理",
  acceptance: "预计接受率",
  estCost: "预计成本",
  validFor: "有效时间",
  whyAction: "推荐依据",
  alternatives: "备选动作",
  eligible: "可执行",
  blocked: "已拦截",
  manualOverride: "人工覆盖",
  resetDecision: "恢复规则判断",
  changeActionStatus: "切换动作状态",
  hostMessage: "建议客户经理话术",
  copy: "复制",
  copied: "已复制",
  restoreAiMessage: "恢复 AI 原稿",
  customizedMessage: "已自定义",
  approvedReady: "已批准 · 可以发送",
  approve: "批准推荐",
  whyRecommendation: "为什么这样推荐？",
  governanceComplete: "治理检查已完成",
  governanceDetail: "策略 v2026.08 · 决策证据已全部记录",
  decisionId: "决策编号",
  storyProgress: "故事步骤",
  jumpTo: "跳转到",
  next: "下一步",
  replay: "重新播放",
  collections: "5 个集合",
  records: "32 条记录",
  freshness: "3 秒新鲜度",
  observedCount: "3 条已观测事实",
  inferredCount: "3 条推断洞察",
  recommendedCount: "1 个推荐动作",
  alternativeCount: "2 个备选动作",
  policyVersion: "策略 v2026.08",
  auditCaptured: "审计已记录",
};

const enText: typeof zhText = {
  brand: "LOYALTY AI ENGINE",
  title: "AI Decision Desk",
  localDemo: "Local demo",
  dataSynced: "MongoDB context · local read-only snapshot",
  settings: "Open settings",
  customerQueue: "VIP customer queue",
  previousCustomer: "Previous customer",
  nextCustomer: "Next customer",
  autoTour: "Auto tour",
  searchCustomer: "Search customers",
  searchHint: "Search VIP ID, tier, host or game",
  noResults: "No matching customers",
  clearSearch: "Clear search",
  filters: "Filters",
  customerStatus: "Customer status",
  vipTier: "VIP tier",
  gameType: "Game type",
  behaviorTag: "Behavior tag",
  all: "All",
  needsAttention: "Needs attention",
  healthy: "Healthy",
  reengagement: "Re-engagement",
  platinum: "Platinum",
  diamond: "Diamond",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  baccarat: "Baccarat",
  blackjack: "Blackjack",
  poker: "Poker",
  promoSeeker: "Promo seeker",
  aggressive: "Aggressive",
  stable: "Stable",
  conservative: "Conservative",
  highVariance: "High variance",
  noHistory: "No interaction history",
  resetFilters: "Reset filters",
  showCustomers: "Show customers",
  realDataPulse: "MongoDB data pulse",
  realSnapshot: "Live via TapData API",
  profilesCount: "310 patron profiles",
  sessionsCount: "292 active sessions",
  recommendationsCount: "600 AI recommendations",
  risksCount: "126 risk cases",
  messagesCount: "120 AI messages",
  viewDataDetails: "View data details",
  sourceCollection: "Source collections",
  closeDialog: "Close dialog",
  evidencePackage: "Real-data evidence package",
  evidenceCollections: "From 4 MongoDB collections",
  maskedPatron: "Masked patron",
  tierRegion: "Tier / region",
  sessionBet: "Session wager",
  stackEstimate: "Stack estimate",
  behaviorRisk: "Behavior / risk",
  reportModel: "Report / model",
  alertCenter: "Alert center",
  activeAlerts: "3 alerts require action",
  activeAlertsSuffix: "alerts require action",
  governanceCenter: "Governance center",
  noRiskAlerts: "No pending risk alerts",
  noRiskAlertDetail: "No active risk case is present in the current live data; no risk alert should be sent. Recommendations may proceed through normal governance approval.",
  noRiskAlertAction: "No risk alert needed",
  notifyHost: "Notify host",
  sendRecommendation: "Send recommendation",
  chooseChannel: "Choose delivery channel",
  whatsapp: "WhatsApp",
  sms: "SMS",
  appPush: "App push",
  sendNow: "Send now",
  sent: "Sent",
  deliveredTo: "Delivered to",
  sendRiskAlert: "Send risk alert",
  sendingRiskAlert: "Sending",
  riskAlertSent: "Administrator notified",
  closeRiskAlert: "Mark resolved",
  closingRiskAlert: "Closing",
  riskAlertClosed: "Closed loop",
  riskAlertAwaitingReview: "Awaiting admin review",
  riskAlertClosedDetail: "Administrator handled it; closure is captured in the audit store",
  auditEvent: "Audit event",
  mongoPersisted: "Persisted to Mongo",
  mongoNotConfigured: "Mongo not configured; UI state only",
  mongoBridgeOffline: "Mongo bridge is offline; restart npm run dev",
  mongoPersistFailed: "Mongo write failed",
  riskAutoRoute: "Risk alert auto-route",
  riskAdministrator: "Risk duty administrator · ADM-01",
  notificationPreview: "Mobile notification preview",
  deliveryReceipt: "Delivery receipt",
  governanceFirst: "Approval required before sending",
  recommendationCompleted: "Recommendation sent",
  recommendationCompletedDetail: "This recommendation has already been delivered. A new actionable recommendation will appear when the patron state or profile changes.",
  language: "Language",
  presentStory: "Present story",
  exitStory: "Exit story",
  runAnalysis: "Run AI analysis",
  liveContext: "Live customer context",
  activeSession: "Active session",
  live: "Live",
  turnover: "Session wager",
  estNet: "Stack estimate",
  avgBet: "Patron ADT",
  latestBet: "Points balance",
  relationship: "AI execution context",
  days90: "MongoDB",
  host: "Suggested host",
  visits: "Report status",
  customerValue: "Region",
  preferences: "Behavior & risk tags",
  aiAnalysis: "AI customer analysis",
  whatMatters: "What matters right now",
  lastRun: "Last run",
  currentAssessment: "Current assessment",
  new: "New",
  whatChanged: "What changed?",
  observedFacts: "Observed facts",
  fromMongo: "From MongoDB context",
  inferredInsights: "AI-inferred insights",
  explanationOnly: "Explanation, not source data",
  nextBestAction: "Next-best-action",
  recommendedNow: "Recommended now",
  governed: "Governed",
  acceptance: "Acceptance",
  estCost: "Est. cost",
  validFor: "Valid for",
  whyAction: "Why this action",
  alternatives: "Alternative actions",
  eligible: "Eligible",
  blocked: "Blocked",
  manualOverride: "Manual override",
  resetDecision: "Restore rule decision",
  changeActionStatus: "Change action status",
  hostMessage: "Suggested host message",
  copy: "Copy",
  copied: "Copied",
  restoreAiMessage: "Restore AI draft",
  customizedMessage: "Customized",
  approvedReady: "Approved · Ready to send",
  approve: "Approve recommendation",
  whyRecommendation: "Why this recommendation?",
  governanceComplete: "Governance checks complete",
  governanceDetail: "Policy v2026.08 · All decision evidence captured",
  decisionId: "Decision ID",
  storyProgress: "Story step",
  jumpTo: "Jump to",
  next: "Next",
  replay: "Replay",
  collections: "5 collections",
  records: "32 records",
  freshness: "8s freshness",
  observedCount: "3 observed facts",
  inferredCount: "3 inferred insights",
  recommendedCount: "1 recommended",
  alternativeCount: "2 alternatives",
  policyVersion: "Policy v2026.08",
  auditCaptured: "Audit captured",
};

const stageLabelsZh = ["读取实时画像", "识别行为信号", "生成下一步动作", "执行治理检查"];
const stageLabelsEn = ["Reading live profile", "Detecting behavior signals", "Generating next-best-action", "Running governance checks"];

const storyStepsZh = [
  {
    kicker: "01 · API CONTEXT",
    title: "把分散记录组装成一个实时客户上下文",
    copy: "读取 patron_profiles、patron_table_sessions、patron_activity_events、patron_interaction_history 与 offer_catalog。",
  },
  {
    kicker: "02 · SIGNALS",
    title: "AI 区分事实与推断，发现单条记录看不到的变化",
    copy: "例如将游戏时段长度、最近下注节奏和历史优惠响应组合为可解释的行为信号。",
  },
  {
    kicker: "03 · DECISION",
    title: "从可用权益中排序下一步最佳动作",
    copy: "综合即时需求、历史偏好、预计接受率、成本与客户经理可执行性，给出推荐和备选动作。",
  },
  {
    kicker: "04 · GOVERNANCE",
    title: "让规则决定能不能做，让 AI 解释为什么",
    copy: "资格、负责任博彩和审批规则由确定性服务执行；模型生成替代建议、理由和沟通话术。",
  },
];

const storyStepsEn = [
  {
    kicker: "01 · API CONTEXT",
    title: "Assemble distributed records into one live customer context",
    copy: "Read patron_profiles, patron_table_sessions, patron_activity_events, patron_interaction_history and offer_catalog.",
  },
  {
    kicker: "02 · SIGNALS",
    title: "Separate facts from inference and reveal cross-record changes",
    copy: "Combine session duration, recent betting pace and historical offer response into explainable behavior signals.",
  },
  {
    kicker: "03 · DECISION",
    title: "Rank the next-best-action from eligible benefits",
    copy: "Balance immediate need, historical preference, acceptance, cost and host execution to produce a recommendation and alternatives.",
  },
  {
    kicker: "04 · GOVERNANCE",
    title: "Rules decide what is allowed; AI explains why",
    copy: "Deterministic services enforce eligibility, responsible-gaming and approval policies. AI creates alternatives, reasons and host language.",
  },
];

const identityConverter = (text: string) => text;

function deepConvert<T>(value: T, converter: (text: string) => string): T {
  if (typeof value === "string") return converter(value) as T;
  if (Array.isArray(value)) return value.map((item) => deepConvert(item, converter)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepConvert(item, converter)])) as T;
  }
  return value;
}

function formatAmount(value: number, locale: Locale) {
  return `HKD ${new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN", { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function isGovernanceRiskSignal(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized || ["none", "clear", "normal", "healthy", "stable", "状态良好", "狀態良好"].includes(normalized)) return false;
  return ["cardcounterwatch", "aggressive", "highvariance", "responsibleplay", "selfexcluded"].includes(normalized) || normalized.includes("risk") || normalized.startsWith("rg-");
}

function liveRiskExplanation(patron: LivePatron) {
  const tags = [...(patron.activeSession?.behaviorTags || []), ...patron.riskFlags].filter((item) => item && item.toLocaleLowerCase() !== "none");
  const hasTag = (tag: string) => tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase());
  const hasRiskCase = patron.activeRiskCount > 0;
  const tableId = patron.activeSession?.tableId || "—";
  const wager = formatAmount(patron.activeSession?.sessionBetAmount || 0, "zh-Hans");

  if (hasTag("CardCounterWatch")) {
    return {
      categoryZh: "桌面保护风险：疑似算牌观察",
      categoryEn: "Table protection risk: card-counter watch",
      triggerZh: `行为标签 CardCounterWatch；桌台 ${tableId}；Session 投注 ${wager}`,
      triggerEn: `Behavior tag CardCounterWatch; table ${tableId}; session wager ${wager}`,
      actionZh: "暂停自动优惠，通知桌面主管 / 风险管理员人工复核。",
      actionEn: "Pause automatic offers and route to floor supervisor / risk administrator for review.",
    };
  }
  if (hasTag("Aggressive") || hasTag("HighVariance")) {
    return {
      categoryZh: "负责任博彩风险：激进 / 高波动行为",
      categoryEn: "Responsible play risk: aggressive or high-variance play",
      triggerZh: `行为标签 ${tags.join(" · ") || "—"}；Session 投注 ${wager}`,
      triggerEn: `Behavior tags ${tags.join(" · ") || "—"}; session wager ${wager}`,
      actionZh: "拦截博彩激励，优先提供非博彩关怀，并由管理员复核。",
      actionEn: "Block gaming incentives, prefer non-gaming care, and require administrator review.",
    };
  }
  if (hasTag("LateNight")) {
    return {
      categoryZh: "服务提醒：深夜在场",
      categoryEn: "Service signal: late-night presence",
      triggerZh: `行为标签 LateNight；最近动作来自 ${tableId}`,
      triggerEn: `Behavior tag LateNight; latest action from ${tableId}`,
      actionZh: "可由客户经理低压问候；不作为风险拦截。",
      actionEn: "Use a low-pressure host check-in; this is not a risk block.",
    };
  }
  if (hasRiskCase) {
    return {
      categoryZh: "活动风险案例：需要管理员复核",
      categoryEn: "Active risk case: administrator review required",
      triggerZh: `patron_risk_cases 当前有 ${patron.activeRiskCount} 条活动案例`,
      triggerEn: `patron_risk_cases has ${patron.activeRiskCount} active case(s)`,
      actionZh: "通知风险值班管理员，审批前不触达客户。",
      actionEn: "Notify the risk duty administrator; do not contact the patron before approval.",
    };
  }
  return {
    categoryZh: "治理校验：状态正常",
    categoryEn: "Governance check: healthy",
    triggerZh: "当前未发现风险案例或敏感行为标签",
    triggerEn: "No risk case or sensitive behavior tag is currently present",
    actionZh: "可进入正常推荐审批流程；如涉及成本或客户触达，仍需审批留痕。",
    actionEn: "Proceed through the normal recommendation approval flow; cost or outreach still requires audit approval.",
  };
}

function livePatronSnapshot(patron: LivePatron): MongoSnapshot {
  const behavior = patron.activeSession?.behaviorTags.join(" · ") || "Stable";
  const effectiveRiskFlags = patron.riskFlags.filter(isGovernanceRiskSignal);
  const riskBehaviorTags = (patron.activeSession?.behaviorTags || []).filter(isGovernanceRiskSignal);
  const riskFlag = effectiveRiskFlags.join(" · ") || (patron.activeRiskCount > 0 ? `${patron.activeRiskCount} Active` : "None");
  const hasRisk = patron.activeRiskCount > 0 || effectiveRiskFlags.length > 0 || riskBehaviorTags.length > 0;
  const risk = liveRiskExplanation(patron);
  return {
    patronId: patron.patronId,
    maskedName: patron.maskedName || patron.patronId,
    tier: patron.tier,
    region: patron.region,
    adt: formatAmount(patron.adt, "zh-Hans"),
    points: new Intl.NumberFormat("zh-CN").format(patron.pointsBalance || 0),
    tableId: patron.activeSession?.tableId || "—",
    sessionBet: formatAmount(patron.activeSession?.sessionBetAmount || 0, "zh-Hans"),
    stack: formatAmount(patron.activeSession?.currentStackEstimate || 0, "zh-Hans"),
    behavior,
    riskFlag,
    reportId: `LIVE-${patron.patronId}`,
    reportStatus: "Live",
    model: "deepseek-chat",
    suggestedPr: "待分配 · LIVE",
    alertLevel: hasRisk ? "critical" : behavior.toLocaleLowerCase().includes("aggressive") ? "warning" : "review",
    alertZh: hasRisk ? `${risk.categoryZh}。触发证据：${risk.triggerZh}。治理动作：${risk.actionZh}` : "当前真实数据未发现活动风险案例；可进入正常治理审批流程。",
    alertEn: hasRisk ? `${risk.categoryEn}. Trigger evidence: ${risk.triggerEn}. Governed action: ${risk.actionEn}` : "No active risk case is present; proceed through normal governance approval.",
    riskCategoryZh: risk.categoryZh,
    riskCategoryEn: risk.categoryEn,
    riskTriggerZh: risk.triggerZh,
    riskTriggerEn: risk.triggerEn,
    riskActionZh: risk.actionZh,
    riskActionEn: risk.actionEn,
  };
}

function livePatronScenario(patron: LivePatron, locale: Locale, converter: (text: string) => string): Scenario {
  const session = patron.activeSession;
  const effectiveRiskFlags = patron.riskFlags.filter(isGovernanceRiskSignal);
  const riskBehaviorTags = (session?.behaviorTags || []).filter(isGovernanceRiskSignal);
  const hasRisk = patron.activeRiskCount > 0 || effectiveRiskFlags.length > 0 || riskBehaviorTags.length > 0;
  const statusTone: Scenario["statusTone"] = hasRisk ? "watch" : session ? "safe" : "warm";
  const local = (hans: string, hant: string, english: string) => locale === "en" ? english : locale === "zh-Hant" ? converter(hant) : hans;
  const lastAction = session?.lastActionAt ? new Date(session.lastActionAt).toLocaleTimeString(locale === "en" ? "en-GB" : "zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
  const game = patron.preferredGames[0] || local("未标注游戏", "未標註遊戲", "Game not tagged");
  const riskText = hasRisk
    ? local(`${patron.activeRiskCount || effectiveRiskFlags.length} 条风险信号`, `${patron.activeRiskCount || effectiveRiskFlags.length} 條風險訊號`, `${patron.activeRiskCount || effectiveRiskFlags.length} risk signal(s)`)
    : local("无活动风险案例", "無活動風險案例", "No active risk case");
  const sessionFact = session
    ? local(`当前在 ${session.tableId}，Session 投注 ${formatAmount(session.sessionBetAmount, locale)}`, `目前在 ${session.tableId}，Session 投注 ${formatAmount(session.sessionBetAmount, locale)}`, `Active at ${session.tableId}; session wager ${formatAmount(session.sessionBetAmount, locale)}`)
    : local("当前没有活跃 Session", "目前沒有活躍 Session", "No active session");
  const tags = session?.behaviorTags.length ? session.behaviorTags.join(" · ") : local("无行为标签", "無行為標籤", "No behavior tag");
  const isVip = ["Diamond", "Platinum", "Gold"].includes(patron.tier);
  const isHighValue = isVip || patron.adt >= 10000 || (session?.sessionBetAmount || 0) >= 18000;
  const likesPromo = tags.includes("PromoSeeker") || patron.pointsBalance >= 50000;
  const upgradeBenefitTitle = patron.tier === "Diamond"
    ? local("套房升级 + 延迟退房 + 豪车接送 + 餐饮体验券", "套房升級 + 延遲退房 + 豪車接送 + 餐飲體驗券", "Suite upgrade + late checkout + chauffeur + dining voucher")
    : patron.tier === "Platinum"
      ? local("套房升级 + 延迟退房 + 豪车接送", "套房升級 + 延遲退房 + 豪車接送", "Suite upgrade + late checkout + chauffeur")
      : local("套房升级 + 延迟退房", "套房升級 + 延遲退房", "Suite upgrade + late checkout");
  const recommendedTitle = hasRisk
    ? local("暂停刺激型优惠，改为客户经理关怀", "暫停刺激型優惠，改為客戶經理關懷", "Pause incentives; switch to host care")
    : isHighValue && isVip
      ? upgradeBenefitTitle
      : likesPromo
        ? local("积分闪兑礼遇 + 餐饮券", "積分閃兌禮遇 + 餐飲券", "Points redemption boost + dining voucher")
        : session
          ? local("客户经理问候 + 轻量餐饮礼遇", "客戶經理問候 + 輕量餐飲禮遇", "Host greeting + light F&B benefit")
          : local("客户经理回访提醒", "客戶經理回訪提醒", "Host follow-up reminder");
  const recommendedSubtitle = hasRisk
    ? local("命中风险信号，不触达优惠，先通知管理员与客户经理复核", "命中風險訊號，不觸達優惠，先通知管理員與客戶經理複核", "Risk signal present; do not send an offer before admin and host review")
    : local("基于客户画像、当前 Session、偏好与治理规则自动生成", "基於客戶畫像、目前 Session、偏好與治理規則自動產生", "Generated from profile, live session, preference and governance rules");
  const acceptance = hasRisk ? 0 : isHighValue ? (likesPromo ? 91 : 86) : session ? 72 : 58;
  const estimatedCost = hasRisk
    ? "HKD 0"
    : patron.tier === "Diamond" || patron.tier === "Platinum"
      ? "HKD 2,400"
      : likesPromo
        ? "HKD 600"
        : session
          ? "HKD 480"
          : "HKD 0";
  const validity = hasRisk
    ? local("立即复核", "立即複核", "Immediate review")
    : session
      ? local("2 小时", "2 小時", "2 hours")
      : local("24 小时", "24 小時", "24 hours");
  const hostMessage = hasRisk
    ? local("您好，我是客户经理。我们先确认您当前体验是否舒适，如需休息或餐饮安排，我可以马上协助。", "您好，我是客戶經理。我們先確認您目前體驗是否舒適，如需休息或餐飲安排，我可以馬上協助。", "Hello, this is your host. I’d like to check that you are comfortable; I can arrange a short break or dining support if helpful.")
    : isHighValue
      ? local("您好，看到您今天正在场内体验，我们为您准备了一份酒店/餐饮礼遇。如果方便，我现在帮您确认安排。", "您好，看到您今天正在場內體驗，我們為您準備了一份酒店/餐飲禮遇。如果方便，我現在幫您確認安排。", "Hello, I see you are currently on property. We prepared a hotel or dining benefit for you; I can confirm the arrangement now if convenient.")
      : session
        ? local("您好，我们正在关注您当前的体验。如有餐饮或休息安排需要，我可以马上协助。", "您好，我們正在關注您目前的體驗。如有餐飲或休息安排需要，我可以馬上協助。", "Hello, we are checking in on your current experience. I can help with dining or a short break if useful.")
        : local("您好，欢迎您下次到访时联系我，我可以提前为您安排合适的服务。", "您好，歡迎您下次到訪時聯絡我，我可以提前為您安排合適的服務。", "Hello, please contact me before your next visit and I can arrange suitable service in advance.");
  const recommendationReasons = hasRisk
    ? [
        riskText,
        local(`风险标签 ${[...effectiveRiskFlags, ...riskBehaviorTags].join(" · ") || "—"}`, `風險標籤 ${[...effectiveRiskFlags, ...riskBehaviorTags].join(" · ") || "—"}`, `Risk tags ${[...effectiveRiskFlags, ...riskBehaviorTags].join(" · ") || "—"}`),
        local("治理规则要求先人工复核", "治理規則要求先人工複核", "Governance requires human review first"),
      ]
    : [
        sessionFact,
        local(`画像等级 ${patron.tier}；ADT ${formatAmount(patron.adt, locale)}`, `畫像等級 ${patron.tier}；ADT ${formatAmount(patron.adt, locale)}`, `Profile tier ${patron.tier}; ADT ${formatAmount(patron.adt, locale)}`),
        local(`偏好 ${patron.preferredGames.join(" · ") || game}；积分 ${new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(patron.pointsBalance || 0)}`, `偏好 ${patron.preferredGames.join(" · ") || game}；積分 ${new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(patron.pointsBalance || 0)}`, `Preference ${patron.preferredGames.join(" · ") || game}; points ${new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(patron.pointsBalance || 0)}`),
      ];

  return {
    id: patron.patronId,
    initials: patron.patronId.replace(/\D/g, "").slice(-2).padStart(2, "0"),
    label: local(`客户 ${patron.patronId}`, `客戶 ${patron.patronId}`, `Patron ${patron.patronId}`),
    tier: patron.tier,
    status: hasRisk ? local("需关注", "需關注", "Review") : session ? local("当前活跃", "目前活躍", "Active") : local("暂不在场", "暫不在場", "Offline"),
    statusTone,
    table: session?.tableId || "—",
    game,
    duration: session ? local(`最后动作 ${lastAction}`, `最後動作 ${lastAction}`, `Last action ${lastAction}`) : "—",
    turnover: formatAmount(session?.sessionBetAmount || 0, locale),
    net: formatAmount(session?.currentStackEstimate || 0, locale),
    avgBet: formatAmount(patron.adt, locale),
    latestBet: new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(patron.pointsBalance || 0),
    host: local("待分配", "待分配", "Unassigned"),
    visits: patron.lastActiveAt ? new Date(patron.lastActiveAt).toLocaleDateString(locale === "en" ? "en-GB" : "zh-CN") : "—",
    value: patron.region,
    preferences: patron.preferredGames.length ? patron.preferredGames : [local("暂无偏好", "暫無偏好", "No preference data")],
    facts: [
      { time: lastAction, text: sessionFact, source: "patron_table_sessions" },
      { time: lastAction, text: local(`筹码估值 ${formatAmount(session?.currentStackEstimate || 0, locale)}；行为 ${tags}`, `籌碼估值 ${formatAmount(session?.currentStackEstimate || 0, locale)}；行為 ${tags}`, `Stack estimate ${formatAmount(session?.currentStackEstimate || 0, locale)}; behavior ${tags}`), source: "patron_table_sessions" },
      { time: "LIVE", text: riskText, source: "patron_risk_cases" },
    ],
    insights: [
      { title: local("实时在场状态", "即時在場狀態", "Live presence"), detail: sessionFact, confidence: session ? 100 : 0, tone: session ? "mint" : "blue" },
      { title: local("行为标签", "行為標籤", "Behavior tags"), detail: tags, confidence: session?.behaviorTags.length ? 100 : 0, tone: hasRisk ? "amber" : "blue" },
      { title: local("风险状态", "風險狀態", "Risk status"), detail: riskText, confidence: 100, tone: hasRisk ? "amber" : "mint" },
    ],
    summary: local(`${patron.patronId} 的实时上下文已从 MongoDB 加载。${sessionFact}；${riskText}。`, `${patron.patronId} 的即時上下文已從 MongoDB 載入。${sessionFact}；${riskText}。`, `Live MongoDB context loaded for ${patron.patronId}. ${sessionFact}; ${riskText}.`),
    change: local(`数据更新时间以 ${lastAction} 的最近动作记录为准。`, `數據更新時間以 ${lastAction} 的最近動作記錄為準。`, `Freshness follows the latest action at ${lastAction}.`),
    signals: [
      { label: local("Session", "Session", "Session"), value: session ? local("活跃", "活躍", "Active") : local("无", "無", "None"), tone: session ? "neutral" : "warning" },
      { label: local("风险案例", "風險案例", "Risk cases"), value: String(patron.activeRiskCount), tone: hasRisk ? "danger" : "neutral" },
      { label: local("数据来源", "數據來源", "Source"), value: "LIVE", tone: "neutral" },
    ],
    recommendation: {
      title: recommendedTitle,
      subtitle: recommendedSubtitle,
      acceptance,
      cost: estimatedCost,
      validity,
      reasons: recommendationReasons,
      hostMessage,
    },
    alternatives: [
      { title: local("客户经理人工复核", "客戶經理人工複核", "Host review"), meta: local("基于实时数据确认下一步", "基於即時數據確認下一步", "Confirm the next step from live data"), status: "eligible" },
      { title: local("审批后发送礼遇", "審批後發送禮遇", "Send benefit after approval"), meta: hasRisk ? local("命中风险信号，保持拦截", "命中風險訊號，保持攔截", "Blocked by risk signal") : local("状态正常，需审批留痕", "狀態正常，需審批留痕", "Healthy status; approval audit required"), status: hasRisk ? "blocked" : "eligible" },
    ],
    answer: local("该推荐基于 patron_table_sessions 的实时在场与投注、patron_profiles 的等级/偏好/积分、patron_risk_cases 的活动风险数量，以及治理规则共同生成。若命中风险，系统不发送优惠；若状态正常，则进入审批留痕后触达。", "該推薦基於 patron_table_sessions 的即時在場與投注、patron_profiles 的等級/偏好/積分、patron_risk_cases 的活動風險數量，以及治理規則共同產生。若命中風險，系統不發送優惠；若狀態正常，則進入審批留痕後觸達。", "This recommendation is generated from live presence and wager in patron_table_sessions, tier/preference/points in patron_profiles, active risk count in patron_risk_cases, plus governance rules. Risk blocks offers; healthy status proceeds to audited approval."),
  };
}

function translateScenario(source: Scenario, locale: Locale, converter: (text: string) => string): Scenario {
  if (locale === "zh-Hans") return source;
  if (locale === "zh-Hant") return deepConvert(source, converter);

  const text = englishScenarioText[source.id];
  return {
    ...source,
    label: text.label,
    tier: text.tier,
    status: text.status,
    game: text.game,
    duration: text.duration,
    visits: text.visits,
    value: text.value,
    preferences: text.preferences,
    facts: source.facts.map((fact, index) => ({ ...fact, text: text.facts[index] })),
    insights: source.insights.map((insight, index) => ({ ...insight, ...text.insights[index] })),
    summary: text.summary,
    change: text.change,
    signals: source.signals.map((signal, index) => ({ ...signal, ...text.signals[index] })),
    recommendation: { ...source.recommendation, ...text.recommendation },
    alternatives: source.alternatives.map((item, index) => ({ ...item, ...text.alternatives[index] })),
    answer: text.answer,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
  const [selectedId, setSelectedId] = useState(scenarios[0].id);
  const [livePatrons, setLivePatrons] = useState<LivePatron[] | null>(null);
  const [liveSourceCounts, setLiveSourceCounts] = useState<LiveSourceCounts | null>(null);
  const [liveDataError, setLiveDataError] = useState("");
  const [liveRefreshTick, setLiveRefreshTick] = useState(0);
  const [primaryView, setPrimaryView] = useState<"customers" | "operations">("operations");
  const [locale, setLocale] = useState<Locale>("zh-Hant");
  const [traditionalConverter, setTraditionalConverter] = useState<((text: string) => string)>(() => identityConverter);
  const [autoTour, setAutoTour] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [analysisStage, setAnalysisStage] = useState(-1);
  const [lastRun, setLastRun] = useState("22:47:08");
  const [approvedRecommendations, setApprovedRecommendations] = useState<Record<string, string>>({});
  const [showAnswer, setShowAnswer] = useState(false);
  const [storyMode, setStoryMode] = useState(false);
  const [storyStep, setStoryStep] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>("whatsapp");
  const [deliveryLog, setDeliveryLog] = useState<Record<string, RecommendationDeliveryLog>>({});
  const [alertWorkflowLog, setAlertWorkflowLog] = useState<Record<string, AlertWorkflowLog>>({});
  const [toast, setToast] = useState("");
  const [lastRecipient, setLastRecipient] = useState("");
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [lastDispatchKind, setLastDispatchKind] = useState<"risk" | "recommendation">("risk");
  const [pulseOpen, setPulseOpen] = useState(false);
  const [pulseMetric, setPulseMetric] = useState<PulseMetric>("profiles");
  const [alternativeOverrides, setAlternativeOverrides] = useState<Record<string, Record<number, "eligible" | "blocked">>>({});
  const [upgradeJourney, setUpgradeJourney] = useState<UpgradeJourney | null>(null);
  // Keep a checkpoint for every patron opened in the decision workspace so
  // the operations view can render the same persisted upgrade/session state.
  const [upgradeJourneys, setUpgradeJourneys] = useState<Record<string, UpgradeJourney>>({});
  // The journey is persisted and advanced in the background. Its internal
  // loading/error state is intentionally not exposed in the customer UI.
  const [, setUpgradeLoading] = useState(false);
  const [, setUpgradeError] = useState("");
  const filterControlRef = useRef<HTMLDivElement>(null);
  const notificationControlRef = useRef<HTMLDivElement>(null);
  const pendingDecisionSelectionRef = useRef<string | null>(null);
  const livePatronsRef = useRef<LivePatron[] | null>(null);
  const livePatronCount = livePatrons?.length ?? 0;
  const effectiveLivePatrons = useMemo(() => {
    if (!livePatrons?.length) return livePatrons;
    const journeys = { ...upgradeJourneys };
    if (upgradeJourney) journeys[upgradeJourney.patronId] = upgradeJourney;
    return livePatrons.map((patron) => {
      const journey = journeys[patron.patronId];
      if (!journey) return patron;
      const sourceSession = patron.activeSession;
      const tableId = sourceSession?.tableId || journey.tableId || "T-0001";
      return {
        ...patron,
        tier: journey.currentTier,
        adt: Math.min(DEMO_MAX_SESSION_WAGER, Math.max(patron.adt, Math.round(Math.min(DEMO_MAX_SESSION_WAGER, journey.currentWager) * 0.55))),
        activeSession: {
          ...(sourceSession || {
            tableId,
            seatedAt: journey.seatedAt || journey.startedAt,
            lastActionAt: journey.updatedAt,
            sessionBetAmount: Math.min(DEMO_MAX_SESSION_WAGER, journey.currentWager),
            currentStackEstimate: journey.currentStackEstimate || 0,
            behaviorTags: journey.behaviorTags || [],
            isActive: true,
          }),
          tableId,
          seatedAt: sourceSession?.seatedAt || journey.seatedAt || journey.startedAt,
          // The journey may be ahead of the last API snapshot, but it must
          // never make a live session appear to lose its wager or stack.
          sessionBetAmount: Math.min(DEMO_MAX_SESSION_WAGER, Math.max(sourceSession?.sessionBetAmount || 0, journey.currentWager)),
          currentStackEstimate: Math.max(sourceSession?.currentStackEstimate || 0, journey.currentStackEstimate || 0),
          behaviorTags: journey.behaviorTags?.length ? journey.behaviorTags : (sourceSession?.behaviorTags || []),
          isActive: true,
          lastActionAt: journey.updatedAt,
        },
      };
    });
  }, [livePatrons, upgradeJourney, upgradeJourneys]);
  const localizedScenarios = useMemo(() => effectiveLivePatrons?.length
    ? effectiveLivePatrons.map((patron) => livePatronScenario(patron, locale, traditionalConverter))
    : scenarios.map((item) => translateScenario(item, locale, traditionalConverter)),
  [effectiveLivePatrons, locale, traditionalConverter]);
  const snapshotMap = useMemo(() => effectiveLivePatrons?.length
    ? Object.fromEntries(effectiveLivePatrons.map((patron) => [patron.patronId, livePatronSnapshot(patron)]))
    : mongoSnapshots,
  [effectiveLivePatrons]);
  const t = useMemo(
    () => locale === "en" ? enText : locale === "zh-Hant" ? deepConvert(zhText, traditionalConverter) : zhText,
    [locale, traditionalConverter],
  );
  const stageLabels = useMemo(
    () => locale === "en" ? stageLabelsEn : locale === "zh-Hant" ? stageLabelsZh.map(traditionalConverter) : stageLabelsZh,
    [locale, traditionalConverter],
  );
  const pulseDetails = useMemo(
    () => locale === "en" ? pulseDetailsEn : locale === "zh-Hant" ? deepConvert(pulseDetailsZh, traditionalConverter) : pulseDetailsZh,
    [locale, traditionalConverter],
  );
  // The pulse strip and its detail dialog must be driven by the same live
  // source-count snapshot. Previously the strip used liveSourceCounts while
  // the dialog kept the demo seed values (310/292/600/126/120), which made
  // the two surfaces disagree after a refresh.
  const visiblePulseDetails = useMemo<Record<PulseMetric, PulseDetail>>(() => {
    if (!liveSourceCounts) return pulseDetails;
    const countLabel = (value: number, hans: string, hant: string, english: string) =>
      `${value} ${locale === "en" ? english : locale === "zh-Hant" ? hant : hans}`;
    return {
      ...pulseDetails,
      profiles: {
        ...pulseDetails.profiles,
        title: countLabel(liveSourceCounts.patron_profiles, "个客户画像", "個客戶畫像", "patron profiles"),
        summary: locale === "en"
          ? `The latest TapData snapshot returned ${liveSourceCounts.patron_profiles} patron profile records for the AI context.`
          : locale === "zh-Hant"
            ? `最新 TapData 快照返回 ${liveSourceCounts.patron_profiles} 筆客戶畫像，作為 AI 上下文。`
            : `最新 TapData 快照返回 ${liveSourceCounts.patron_profiles} 条客户画像，作为 AI 上下文。`,
        stats: [{ label: locale === "en" ? "Live records" : locale === "zh-Hant" ? "即時記錄" : "实时记录", value: String(liveSourceCounts.patron_profiles), note: locale === "en" ? "patron_profiles returned by the latest refresh" : locale === "zh-Hant" ? "本輪刷新由 patron_profiles 返回" : "本轮刷新由 patron_profiles 返回" }],
      },
      sessions: {
        ...pulseDetails.sessions,
        title: countLabel(liveSourceCounts.patron_table_sessions, "个活跃 Session", "個活躍 Session", "active sessions"),
        summary: locale === "en"
          ? `The latest TapData snapshot returned ${liveSourceCounts.patron_table_sessions} table-session records used by the live view.`
          : locale === "zh-Hant"
            ? `最新 TapData 快照返回 ${liveSourceCounts.patron_table_sessions} 筆桌台 Session，供即時畫面使用。`
            : `最新 TapData 快照返回 ${liveSourceCounts.patron_table_sessions} 条桌台 Session，供实时画面使用。`,
        stats: [{ label: locale === "en" ? "Live records" : locale === "zh-Hant" ? "即時記錄" : "实时记录", value: String(liveSourceCounts.patron_table_sessions), note: locale === "en" ? "patron_table_sessions returned by the latest refresh" : locale === "zh-Hant" ? "本輪刷新由 patron_table_sessions 返回" : "本轮刷新由 patron_table_sessions 返回" }],
      },
      recommendations: {
        ...pulseDetails.recommendations,
        title: countLabel(liveSourceCounts.offer_recommendations, "条 AI 推荐", "條 AI 推薦", "AI recommendations"),
        stats: [{ label: locale === "en" ? "Live records" : locale === "zh-Hant" ? "即時記錄" : "实时记录", value: String(liveSourceCounts.offer_recommendations), note: locale === "en" ? "offer_recommendations returned by the latest refresh" : locale === "zh-Hant" ? "本輪刷新由 offer_recommendations 返回" : "本轮刷新由 offer_recommendations 返回" }],
      },
      risks: {
        ...pulseDetails.risks,
        title: countLabel(liveSourceCounts.patron_risk_cases, "个风险案例", "個風險案例", "risk cases"),
        stats: [{ label: locale === "en" ? "Live records" : locale === "zh-Hant" ? "即時記錄" : "实时记录", value: String(liveSourceCounts.patron_risk_cases), note: locale === "en" ? "patron_risk_cases returned by the latest refresh" : locale === "zh-Hant" ? "本輪刷新由 patron_risk_cases 返回" : "本轮刷新由 patron_risk_cases 返回" }],
      },
      messages: {
        ...pulseDetails.messages,
        title: countLabel(liveSourceCounts.chat_messages, "条 AI 消息", "條 AI 訊息", "AI messages"),
        stats: [{ label: locale === "en" ? "Live records" : locale === "zh-Hant" ? "即時記錄" : "实时记录", value: String(liveSourceCounts.chat_messages), note: locale === "en" ? "chat_messages returned by the latest refresh" : locale === "zh-Hant" ? "本輪刷新由 chat_messages 返回" : "本轮刷新由 chat_messages 返回" }],
      },
    };
  }, [liveSourceCounts, locale, pulseDetails]);
  const activePulseDetail = visiblePulseDetails[pulseMetric];
  const storySteps = useMemo(
    () => locale === "en" ? storyStepsEn : locale === "zh-Hant" ? deepConvert(storyStepsZh, traditionalConverter) : storyStepsZh,
    [locale, traditionalConverter],
  );
  const scenario = useMemo(
    () => localizedScenarios.find((item) => item.id === selectedId) ?? localizedScenarios[0],
    [localizedScenarios, selectedId],
  );
  const scenarioIndex = localizedScenarios.findIndex((item) => item.id === selectedId);
  const snapshot = snapshotMap[scenario.id];
  const currentHostMessage = messageDrafts[scenario.id] ?? scenario.recommendation.hostMessage;
  const recommendationFingerprint = [
    scenario.id,
    scenario.recommendation.title,
    scenario.recommendation.cost,
    scenario.recommendation.validity,
    snapshot.tableId,
    snapshot.sessionBet,
    snapshot.riskFlag,
    snapshot.reportStatus,
  ].join("|");
  const currentDeliveryLog = deliveryLog[scenario.id];
  const recommendationAlreadySent = currentDeliveryLog?.fingerprint === recommendationFingerprint;
  const recommendationApproved = recommendationAlreadySent || approvedRecommendations[scenario.id] === recommendationFingerprint;
  const alertText = locale === "en" ? snapshot.alertEn : locale === "zh-Hant" ? traditionalConverter(snapshot.alertZh) : snapshot.alertZh;
  const riskCategoryText = locale === "en" ? snapshot.riskCategoryEn : locale === "zh-Hant" ? (snapshot.riskCategoryZh ? traditionalConverter(snapshot.riskCategoryZh) : undefined) : snapshot.riskCategoryZh;
  const riskTriggerText = locale === "en" ? snapshot.riskTriggerEn : locale === "zh-Hant" ? (snapshot.riskTriggerZh ? traditionalConverter(snapshot.riskTriggerZh) : undefined) : snapshot.riskTriggerZh;
  const riskActionText = locale === "en" ? snapshot.riskActionEn : locale === "zh-Hant" ? (snapshot.riskActionZh ? traditionalConverter(snapshot.riskActionZh) : undefined) : snapshot.riskActionZh;
  const showingRecommendationReceipt = lastDispatchKind === "recommendation" && recommendationAlreadySent;
  const deliveredChannelLabel = currentDeliveryLog ? { whatsapp: t.whatsapp, sms: t.sms, push: t.appPush }[currentDeliveryLog.channel] : t.whatsapp;
  const currentAlertWorkflow = alertWorkflowLog[scenario.id] ?? { status: "open" as const };
  const riskScenarioIds = localizedScenarios
    .filter((item) => ["critical", "warning"].includes(snapshotMap[item.id]?.alertLevel || ""))
    .map((item) => item.id);
  const hasCurrentRiskSignal = riskScenarioIds.includes(scenario.id);
  const closedAlertCount = riskScenarioIds.filter((id) => alertWorkflowLog[id]?.status === "closed").length;
  const pendingAlertCount = Math.max(0, riskScenarioIds.length - closedAlertCount);
  const pendingAlertText = locale === "en"
    ? `${pendingAlertCount} ${t.activeAlertsSuffix}`
    : `${pendingAlertCount} ${t.activeAlertsSuffix}`;
  const alertWorkflowLabel = currentAlertWorkflow.status === "closed"
    ? t.riskAlertClosed
    : currentAlertWorkflow.status === "sent"
      ? t.riskAlertAwaitingReview
      : currentAlertWorkflow.status === "sending"
        ? t.sendingRiskAlert
        : currentAlertWorkflow.status === "closing"
          ? t.closingRiskAlert
          : hasCurrentRiskSignal ? pendingAlertText : t.noRiskAlerts;
  const currentAlternativeOverrides = alternativeOverrides[scenario.id] ?? {};
  const alternativeOverrideCount = Object.keys(currentAlternativeOverrides).length;
  const effectiveSearchFilters = searchQuery.trim() ? defaultFilters : filters;
  const filteredScenarios = useMemo(() => {
    return localizedScenarios.filter((item) => matchesScenario(item, effectiveSearchFilters, snapshotMap, searchQuery));
  }, [effectiveSearchFilters, localizedScenarios, searchQuery, snapshotMap]);
  const activeFilterCount = Object.values(filters).filter((value) => value !== "all").length;
  const pulseLabels = useMemo<Record<PulseMetric, string>>(() => ({
    profiles: liveSourceCounts ? `${liveSourceCounts.patron_profiles} ${locale === "en" ? "patron profiles" : locale === "zh-Hant" ? "客戶畫像" : "客户画像"}` : t.profilesCount,
    sessions: liveSourceCounts ? `${liveSourceCounts.patron_table_sessions} ${locale === "en" ? "table sessions" : "Session"}` : t.sessionsCount,
    recommendations: liveSourceCounts ? `${liveSourceCounts.offer_recommendations} ${locale === "en" ? "AI recommendations" : locale === "zh-Hant" ? "AI 推薦" : "AI 推荐"}` : t.recommendationsCount,
    risks: liveSourceCounts ? `${liveSourceCounts.patron_risk_cases} ${locale === "en" ? "risk cases" : locale === "zh-Hant" ? "風險案例" : "风险案例"}` : t.risksCount,
    messages: liveSourceCounts ? `${liveSourceCounts.chat_messages} ${locale === "en" ? "AI messages" : locale === "zh-Hant" ? "AI 訊息" : "AI 消息"}` : t.messagesCount,
  }), [liveSourceCounts, locale, t]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Hydrate the shell with the last successful snapshot while the first live
  // request is in flight. This avoids a blank dashboard during a cold start
  // or a transient TapData delay; a successful response always replaces it.
  useEffect(() => {
    if (primaryView !== "customers") return;
    const cached = readLivePatronSnapshot<LivePatron, LiveSourceCounts>();
    if (!cached) return;
    const timer = window.setTimeout(() => {
      setLivePatrons(cached.data);
      if (cached.sourceCounts) setLiveSourceCounts(cached.sourceCounts);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [primaryView]);

  useEffect(() => {
    if (primaryView !== "customers") return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const requestSequence = liveRefreshTick;
    const requestTimer = window.setTimeout(() => controller.abort(), 15_000);
    async function loadLivePatrons() {
      try {
        setLiveDataError("");
        const response = await fetch("/api/data/patrons", {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (response.status === 304) {
          if (!cancelled && requestSequence === liveRefreshTick) setLiveDataError("");
          return;
        }
        const result = await response.json() as { data?: LivePatron[]; sourceCounts?: LiveSourceCounts; fetchedAt?: string; error?: string; warnings?: Array<{ collection: string; message: string }> };
        if (!response.ok || !result.data) throw new Error(result.error || "No live patron data returned");
        if (cancelled) return;
        if (requestSequence !== liveRefreshTick) return;
        // Never replace a known-good snapshot with an empty response. A
        // transient TapData/Vercel timeout can otherwise make the whole
        // customer surface disappear during the next polling tick. Keep the
        // previous data visible and retry in the background; only a non-empty
        // response is allowed to become the new browser snapshot.
        if (!result.data.length) {
          setLiveDataError(result.warnings?.[0]?.message || "TapData returned 0 live patrons in this refresh; keeping the last good snapshot");
          return;
        }
        const nextPatrons = result.data;
        setLivePatrons(nextPatrons);
        if (result.sourceCounts) setLiveSourceCounts(result.sourceCounts);
        writeLivePatronSnapshot(nextPatrons, result.sourceCounts, result.fetchedAt);
        setLiveDataError("");
        setSelectedId((current) => {
          const pending = pendingDecisionSelectionRef.current;
          if (pending) {
            if (nextPatrons.some((patron) => patron.patronId === pending)) pendingDecisionSelectionRef.current = null;
            return pending;
          }
          return nextPatrons.some((patron) => patron.patronId === current)
            ? current
            : nextPatrons[0]?.patronId ?? current;
        });
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error && error.name === "AbortError"
            ? (locale === "en" ? "The API did not return within 15s; this refresh was skipped and will retry in 3s." : locale === "zh-Hant" ? "接口超過 15 秒未返回，已跳過本輪刷新，3 秒後自動重試。" : "接口超过 15 秒未返回，已跳过本轮刷新，3 秒后自动重试。")
            : error instanceof Error ? error.message : "Unable to load live patrons";
          setLiveDataError(message);
        }
      } finally {
        window.clearTimeout(requestTimer);
      }
    }
    loadLivePatrons();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(requestTimer);
    };
  }, [liveRefreshTick, locale, primaryView]);

  useEffect(() => {
    if (primaryView !== "customers") return undefined;
    const timer = window.setInterval(() => setLiveRefreshTick((tick) => tick + 1), 3_000);
    return () => window.clearInterval(timer);
  }, [primaryView]);

  useEffect(() => {
    livePatronsRef.current = livePatrons;
  }, [livePatrons]);

  // The upgrade journey is deliberately started only after the operator opens
  // a customer decision workspace. Each three-second poll advances and
  // persists the journey in MongoDB, so the wager/tier progression is not a
  // browser-only animation and can be inspected after the demo.
  useEffect(() => {
    if (primaryView !== "customers" || !selectedId || livePatronCount === 0) {
      return undefined;
    }
    const selected = livePatronsRef.current?.find((patron) => patron.patronId === selectedId);
    if (!selected) return undefined;
    // Capture the narrowed value for the interval callback. TypeScript cannot
    // carry the outer `if (!selected)` narrowing into the nested async function.
    const selectedPatron = selected;
    let cancelled = false;
    let firstRequest = true;
    let requestInFlight = false;

    async function requestJourney() {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;
      const isFirstRequest = firstRequest;
      try {
        if (isFirstRequest) setUpgradeLoading(true);
        const response = await fetch(isFirstRequest ? "/api/demo/upgrade" : `/api/demo/upgrade?patronId=${encodeURIComponent(selectedId)}`, {
          method: isFirstRequest ? "POST" : "GET",
          headers: { accept: "application/json", ...(isFirstRequest ? { "content-type": "application/json" } : {}) },
          body: isFirstRequest ? JSON.stringify({
            patronId: selectedId,
            startTier: selectedPatron.tier,
            tableId: selectedPatron.activeSession?.tableId || "T-0001",
            seatedAt: selectedPatron.activeSession?.seatedAt || new Date().toISOString(),
            behaviorTags: selectedPatron.activeSession?.behaviorTags || [],
            currentStackEstimate: selectedPatron.activeSession?.currentStackEstimate || 0,
            sessionBetAmount: selectedPatron.activeSession?.sessionBetAmount || 0,
          }) : undefined,
          cache: "no-store",
        });
        const payload = await response.json() as { ok?: boolean; journey?: UpgradeJourney | null; error?: string };
        if (!response.ok || payload.ok === false || !payload.journey) throw new Error(payload.error || "Unable to start the upgrade journey");
        if (!cancelled) {
          setUpgradeJourney(payload.journey);
          setUpgradeJourneys((current) => payload.journey
            ? { ...current, [payload.journey.patronId]: payload.journey }
            : current);
          setUpgradeError("");
          firstRequest = false;
        }
      } catch (error) {
        if (!cancelled) setUpgradeError(error instanceof Error ? error.message : "Unable to persist the upgrade journey");
      } finally {
        if (isFirstRequest) setUpgradeLoading(false);
        requestInFlight = false;
      }
    }

    void requestJourney();
    const timer = window.setInterval(() => void requestJourney(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [livePatronCount, primaryView, selectedId]);

  useEffect(() => {
    if (!pulseOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPulseOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pulseOpen]);

  useEffect(() => {
    if (!filterOpen && !notificationOpen) return;
    const closePopovers = (event: Event) => {
      const target = event.target as Node;
      if (filterOpen && !filterControlRef.current?.contains(target)) setFilterOpen(false);
      if (notificationOpen && !notificationControlRef.current?.contains(target)) setNotificationOpen(false);
    };
    document.addEventListener("pointerdown", closePopovers);
    document.addEventListener("mousedown", closePopovers);
    return () => {
      document.removeEventListener("pointerdown", closePopovers);
      document.removeEventListener("mousedown", closePopovers);
    };
  }, [filterOpen, notificationOpen]);

  useEffect(() => {
    if (!autoTour || analysisStage >= 0 || storyMode || filteredScenarios.length < 2) return;
    const timer = window.setInterval(() => {
      setSelectedId((current) => {
        const currentIndex = filteredScenarios.findIndex((item) => item.id === current);
        return filteredScenarios[(Math.max(currentIndex, 0) + 1) % filteredScenarios.length].id;
      });
      setShowAnswer(false);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [analysisStage, autoTour, filteredScenarios, storyMode]);

  async function runAnalysis() {
    if (analysisStage >= 0) return;
    setShowAnswer(false);
    for (let step = 0; step < stageLabels.length; step += 1) {
      setAnalysisStage(step);
      await sleep(step === 0 ? 520 : 660);
    }
    const timeLocale = locale === "en" ? "en-GB" : locale === "zh-Hant" ? "zh-HK" : "zh-CN";
    setLastRun(new Date().toLocaleTimeString(timeLocale, { hour12: false }));
    setAnalysisStage(-1);
  }

  function changeScenario(id: string) {
    setUpgradeJourney(null);
    setUpgradeError("");
    setSelectedId(id);
    setShowAnswer(false);
    setCopiedMessage(false);
  }

  function updateFilters(nextFilters: FilterState) {
    setFilters(nextFilters);
    const candidates = localizedScenarios.filter((item) => matchesScenario(item, nextFilters, snapshotMap, searchQuery));
    if (candidates.length > 0 && !candidates.some((item) => item.id === selectedId)) {
      changeScenario(candidates[0].id);
    }
  }

  function selectSearchResult(id: string) {
    changeScenario(id);
    setSearchQuery("");
    setSearchOpen(false);
  }

  function advanceScenario(direction: number) {
    if (filteredScenarios.length === 0) return;
    const currentIndex = filteredScenarios.findIndex((item) => item.id === selectedId);
    const nextIndex = (Math.max(currentIndex, 0) + direction + filteredScenarios.length) % filteredScenarios.length;
    changeScenario(filteredScenarios[nextIndex].id);
  }

  async function persistAuditEvent(actionType: "risk_alert_sent" | "risk_alert_closed" | "recommendation_sent", options: {
    channel: string;
    recipient: string;
    message: string;
    status: string;
    closeReason?: string;
  }) {
    const response = await fetch("/api/audit/events", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        actionType,
        scenarioId: scenario.id,
        patronId: snapshot.patronId,
        maskedName: snapshot.maskedName,
        tableId: snapshot.tableId,
        reportId: snapshot.reportId,
        alertLevel: snapshot.alertLevel,
        channel: options.channel,
        recipient: options.recipient,
        message: options.message,
        status: options.status,
        closeReason: options.closeReason,
        metadata: {
          reportStatus: snapshot.reportStatus,
          suggestedPr: snapshot.suggestedPr,
          locale,
        },
      }),
    });
    const payload = await response.json() as AuditPersistResponse;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Unable to persist audit event");
    return payload;
  }

  function mongoPersistenceLabel(payload: AuditPersistResponse) {
    if (payload.persisted) return t.mongoPersisted;
    if (payload.mode === "bridge_offline") return t.mongoBridgeOffline;
    return t.mongoNotConfigured;
  }

  async function dispatchNotification(kind: "risk" | "recommendation") {
    const recipient = kind === "risk" ? t.riskAdministrator : snapshot.suggestedPr;
    const channel = kind === "risk" ? t.whatsapp : { whatsapp: t.whatsapp, sms: t.sms, push: t.appPush }[deliveryChannel];
    const message = kind === "risk" ? alertText : currentHostMessage;
    const actionType = kind === "risk" ? "risk_alert_sent" : "recommendation_sent";
    if (kind === "risk") {
      setAlertWorkflowLog((current) => ({
        ...current,
        [scenario.id]: { ...(current[scenario.id] || {}), status: "sending" },
      }));
    }
    setLastRecipient(recipient);
    setLastDispatchKind(kind);
    setNotificationOpen(true);
    try {
      const persisted = await persistAuditEvent(actionType, {
        channel,
        recipient,
        message,
        status: "sent",
      });
      if (kind === "recommendation") {
        setDeliveryLog((current) => ({
          ...current,
          [scenario.id]: {
            channel: deliveryChannel,
            fingerprint: recommendationFingerprint,
            sentAt: persisted.createdAt || new Date().toISOString(),
          },
        }));
      } else {
        setAlertWorkflowLog((current) => ({
          ...current,
          [scenario.id]: {
            status: "sent",
            eventId: persisted.eventId,
            sentAt: persisted.createdAt || new Date().toISOString(),
            persisted: Boolean(persisted.persisted),
            mode: persisted.mode,
          },
        }));
      }
      const notificationMessage = kind === "risk" ? t.sendRiskAlert : t.sendRecommendation;
      const persistenceLabel = mongoPersistenceLabel(persisted);
      setToast(`${notificationMessage} · ${t.sent} · ${persistenceLabel}`);
    } catch (error) {
      if (kind === "risk") {
        setAlertWorkflowLog((current) => ({
          ...current,
          [scenario.id]: { ...(current[scenario.id] || {}), status: "open" },
        }));
      }
      setToast(`${t.mongoPersistFailed} · ${error instanceof Error ? error.message : "unknown error"}`);
    }
    window.setTimeout(() => setToast(""), 3600);
  }

  async function closeRiskAlert() {
    setAlertWorkflowLog((current) => ({
      ...current,
      [scenario.id]: { ...(current[scenario.id] || {}), status: "closing" },
    }));
    setLastRecipient(t.riskAdministrator);
    setLastDispatchKind("risk");
    setNotificationOpen(true);
    try {
      const persisted = await persistAuditEvent("risk_alert_closed", {
        channel: t.whatsapp,
        recipient: t.riskAdministrator,
        message: alertText,
        status: "closed",
        closeReason: "Administrator reviewed and accepted the AI risk alert.",
      });
      setAlertWorkflowLog((current) => ({
        ...current,
        [scenario.id]: {
          ...(current[scenario.id] || {}),
          status: "closed",
          eventId: persisted.eventId || current[scenario.id]?.eventId,
          closedAt: persisted.createdAt || new Date().toISOString(),
          persisted: Boolean(persisted.persisted),
          mode: persisted.mode,
        },
      }));
      setToast(`${t.riskAlertClosed} · ${mongoPersistenceLabel(persisted)}`);
    } catch (error) {
      setAlertWorkflowLog((current) => ({
        ...current,
        [scenario.id]: { ...(current[scenario.id] || {}), status: current[scenario.id]?.eventId ? "sent" : "open" },
      }));
      setToast(`${t.mongoPersistFailed} · ${error instanceof Error ? error.message : "unknown error"}`);
    }
    window.setTimeout(() => setToast(""), 3600);
  }

  function updateHostMessage(value: string) {
    setMessageDrafts((current) => ({ ...current, [scenario.id]: value }));
  }

  function openPulseDetail(metric: PulseMetric) {
    setPulseMetric(metric);
    setPulseOpen(true);
  }

  function toggleAlternativeStatus(index: number, originalStatus: "eligible" | "blocked") {
    setAlternativeOverrides((current) => {
      const scenarioOverrides = { ...(current[scenario.id] ?? {}) };
      const effectiveStatus = scenarioOverrides[index] ?? originalStatus;
      const nextStatus = effectiveStatus === "eligible" ? "blocked" : "eligible";
      if (nextStatus === originalStatus) delete scenarioOverrides[index];
      else scenarioOverrides[index] = nextStatus;
      return { ...current, [scenario.id]: scenarioOverrides };
    });
  }

  function resetAlternativeStatuses() {
    setAlternativeOverrides((current) => ({ ...current, [scenario.id]: {} }));
  }

  function restoreHostMessage() {
    setMessageDrafts((current) => {
      const next = { ...current };
      delete next[scenario.id];
      return next;
    });
  }

  async function copyHostMessage() {
    try {
      await navigator.clipboard.writeText(currentHostMessage);
      setCopiedMessage(true);
      window.setTimeout(() => setCopiedMessage(false), 1800);
    } catch {
      setCopiedMessage(false);
    }
  }

  async function changeLocale(nextLocale: Locale) {
    if (nextLocale === "zh-Hant" && traditionalConverter === identityConverter) {
      const { Converter } = await import("opencc-js/cn2t");
      setTraditionalConverter(() => Converter({ from: "cn", to: "tw" }));
    }
    setLocale(nextLocale);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && filteredScenarios[0]) {
      event.preventDefault();
      selectSearchResult(filteredScenarios[0].id);
    }
    if (event.key === "Escape") {
      setSearchOpen(false);
      setSearchQuery("");
    }
  }

  return (
    <main className={`app-shell ${primaryView === "customers" ? "approval-console" : "operations-console"} ${storyMode ? `story-active story-step-${storyStep}` : ""}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div>
            <p className="eyebrow">{t.brand}</p>
            <h1>{t.title}</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="locale-switcher" role="group" aria-label={t.language}>
            <button type="button" className={locale === "zh-Hans" ? "active" : ""} onClick={() => changeLocale("zh-Hans")}>简</button>
            <button type="button" className={locale === "zh-Hant" ? "active" : ""} onClick={() => changeLocale("zh-Hant")}>繁</button>
            <button type="button" className={locale === "en" ? "active" : ""} onClick={() => changeLocale("en")}>EN</button>
          </div>
          <span className="environment-pill"><i /> {t.localDemo}</span>
          <span className={liveDataError ? "data-pill error" : "data-pill live"}>
            {livePatrons
              ? `${livePatrons.length} ${locale === "en" ? "live patrons" : locale === "zh-Hant" ? "位真實客戶" : "位真实客户"}`
              : liveDataError
                ? (locale === "en" ? "Live data unavailable" : locale === "zh-Hant" ? "真實數據載入失敗" : "真实数据加载失败")
                : (locale === "en" ? "Loading live patrons…" : locale === "zh-Hant" ? "正在載入真實客戶…" : "正在加载真实客户…")}
          </span>
          <div className="notification-control" ref={notificationControlRef}>
            <button className="notification-button" type="button" aria-label={hasCurrentRiskSignal ? t.alertCenter : t.governanceCenter} aria-expanded={notificationOpen} onClick={() => { setNotificationOpen((value) => !value); setFilterOpen(false); }}>
              <span>!</span>{pendingAlertCount > 0 && <b>{pendingAlertCount}</b>}
            </button>
            {notificationOpen && (
              <div className="notification-popover">
                <div className="notification-head"><div><strong>{showingRecommendationReceipt ? t.deliveryReceipt : hasCurrentRiskSignal ? t.alertCenter : t.governanceCenter}</strong><small>{showingRecommendationReceipt ? `${t.sent} · ${deliveredChannelLabel}` : alertWorkflowLabel}</small></div><span className={showingRecommendationReceipt || !hasCurrentRiskSignal || currentAlertWorkflow.status === "closed" || currentAlertWorkflow.status === "sent" ? "sent" : snapshot.alertLevel}>{showingRecommendationReceipt ? t.sent : !hasCurrentRiskSignal ? "CLEAR" : currentAlertWorkflow.status === "closed" ? t.riskAlertClosed : currentAlertWorkflow.status === "sent" ? t.riskAlertSent : snapshot.alertLevel}</span></div>
                <div className="mobile-preview">
                  <div className="mobile-app"><span>AI</span><div><strong>AI 忠诚度引擎</strong><small>{t.notificationPreview} · now</small></div></div>
                  <p>{showingRecommendationReceipt ? currentHostMessage : !hasCurrentRiskSignal ? t.noRiskAlertDetail : currentAlertWorkflow.status === "closed" ? t.riskAlertClosedDetail : alertText}</p>
                  <code>{currentAlertWorkflow.eventId ? `${t.auditEvent} · ${currentAlertWorkflow.eventId}` : `${snapshot.patronId} · ${snapshot.reportStatus}`}</code>
                </div>
                {!showingRecommendationReceipt && hasCurrentRiskSignal && (
                  <div className="alert-workflow">
                    <span className="done">1 {t.currentAssessment}</span>
                    <span className={["sent", "closing", "closed"].includes(currentAlertWorkflow.status) ? "done" : currentAlertWorkflow.status === "sending" ? "active" : ""}>2 {currentAlertWorkflow.status === "sending" ? t.sendingRiskAlert : t.riskAlertSent}</span>
                    <span className={currentAlertWorkflow.status === "closed" ? "done" : currentAlertWorkflow.status === "closing" ? "active" : ""}>3 {currentAlertWorkflow.status === "closing" ? t.closingRiskAlert : t.riskAlertClosed}</span>
                  </div>
                )}
                <div className="notification-recipient"><span>{showingRecommendationReceipt ? t.deliveredTo : hasCurrentRiskSignal ? t.riskAutoRoute : t.governanceComplete}</span><strong>{showingRecommendationReceipt ? snapshot.suggestedPr : hasCurrentRiskSignal ? t.riskAdministrator : t.noRiskAlerts}</strong></div>
                {!showingRecommendationReceipt && hasCurrentRiskSignal && currentAlertWorkflow.status === "sent" && <button type="button" className="notify-button secondary" onClick={() => void closeRiskAlert()}>{t.closeRiskAlert}</button>}
                {!showingRecommendationReceipt && hasCurrentRiskSignal && currentAlertWorkflow.status === "closed" && <button type="button" className="notify-button closed" disabled>✓ {t.riskAlertClosed} · {currentAlertWorkflow.persisted ? t.mongoPersisted : currentAlertWorkflow.mode === "bridge_offline" ? t.mongoBridgeOffline : t.mongoNotConfigured}</button>}
                {!showingRecommendationReceipt && hasCurrentRiskSignal && !["sent", "closed"].includes(currentAlertWorkflow.status) && <button type="button" className="notify-button" disabled={currentAlertWorkflow.status === "sending" || currentAlertWorkflow.status === "closing"} onClick={() => void dispatchNotification("risk")}>{currentAlertWorkflow.status === "sending" ? t.sendingRiskAlert : t.sendRiskAlert} · {t.whatsapp}</button>}
                {!showingRecommendationReceipt && !hasCurrentRiskSignal && <button type="button" className="notify-button closed" disabled>✓ {t.noRiskAlertAction}</button>}
              </div>
            )}
          </div>
          <button className="icon-button" type="button" aria-label={t.settings}>•••</button>
        </div>
      </header>

      {primaryView === "customers" ? <>

      <div className="decision-backbar">
        <button type="button" onClick={() => { setUpgradeError(""); setPrimaryView("operations"); }}>← {locale === "en" ? "Back to system menu" : locale === "zh-Hant" ? "返回系統選單" : "返回系统菜单"}</button>
        <span>{locale === "en" ? "Customer decision workspace" : locale === "zh-Hant" ? "客戶決策工作台" : "客户决策工作台"} · {snapshot.patronId}</span>
      </div>

      <section className="context-bar" aria-label={t.customerQueue}>
        <div className="vip-queue">
          <div className="queue-label"><span>{t.customerQueue}</span><small>{livePatrons ? `${scenarioIndex + 1} / ${localizedScenarios.length} · ${snapshot.patronId}` : (locale === "en" ? "Connecting to live data…" : locale === "zh-Hant" ? "連接真實數據中…" : "连接真实数据中…")}</small></div>
          <button className="queue-arrow" type="button" onClick={() => advanceScenario(-1)} aria-label={t.previousCustomer}>←</button>
          <div className="customer-search">
            <span className="search-glyph" aria-hidden="true">⌕</span>
            <input
              type="search"
              role="combobox"
              value={searchQuery}
              placeholder={`${t.searchCustomer} · ${snapshot.maskedName}`}
              aria-label={t.searchHint}
              aria-expanded={searchOpen}
              aria-controls="customer-search-results"
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 140)}
              onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true); }}
              onKeyDown={handleSearchKeyDown}
            />
            {searchQuery && (
              <button type="button" className="search-clear" aria-label={t.clearSearch} onClick={() => setSearchQuery("")}>×</button>
            )}
            {searchOpen && (
              <div className="search-results" id="customer-search-results" role="listbox" key={`${searchQuery}-${filters.status}-${filters.tier}-${filters.game}-${filters.tag}`}>
                <div className="search-results-head"><span>{t.customerQueue}</span><small>{filteredScenarios.length}</small></div>
                {filteredScenarios.length > 0 ? filteredScenarios.map((item) => {
                  const itemSnapshot = snapshotMap[item.id];
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.id === selectedId}
                      className={item.id === selectedId ? "search-result active" : "search-result"}
                      key={item.id}
                      onClick={() => selectSearchResult(item.id)}
                    >
                      <span className="result-avatar">{item.initials}</span>
                      <span className="result-copy"><strong>{itemSnapshot.patronId} · {itemSnapshot.maskedName}</strong><small>{itemSnapshot.tier} · {item.game} · {itemSnapshot.region}</small></span>
                      <span className={`result-status ${item.statusTone}`}>{item.status}</span>
                    </button>
                  );
                }) : <div className="no-results"><span>⌕</span>{t.noResults}</div>}
              </div>
            )}
          </div>
          <div className="filter-control" ref={filterControlRef}>
            <button
              className={activeFilterCount > 0 ? "filter-button active" : "filter-button"}
              type="button"
              aria-expanded={filterOpen}
              onClick={() => { setFilterOpen((value) => !value); setSearchOpen(false); setNotificationOpen(false); }}
            >
              <span aria-hidden="true">≡</span>{t.filters}
              {activeFilterCount > 0 && <b>{activeFilterCount}</b>}
            </button>
            {filterOpen && (
              <div className="filter-popover">
                <div className="filter-group">
                  <h3>{t.customerStatus}</h3>
                  <div className="filter-chip-list">
                    {([
                      ["all", t.all],
                      ["watch", t.needsAttention],
                      ["safe", t.healthy],
                      ["warm", t.reengagement],
                    ] as const).map(([value, label]) => (
                      <button key={value} type="button" className={filters.status === value ? "filter-chip active" : "filter-chip"} onClick={() => updateFilters({ ...filters, status: value })}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="filter-group">
                  <h3>{t.vipTier}</h3>
                  <div className="filter-chip-list">
                    {([
                      ["all", t.all],
                      ["diamond", t.diamond],
                      ["platinum", t.platinum],
                      ["gold", t.gold],
                      ["silver", t.silver],
                      ["bronze", t.bronze],
                    ] as const).map(([value, label]) => (
                      <button key={value} type="button" className={filters.tier === value ? "filter-chip active" : "filter-chip"} onClick={() => updateFilters({ ...filters, tier: value })}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="filter-group">
                  <h3>{t.gameType}</h3>
                  <div className="filter-chip-list">
                    {([
                      ["all", t.all],
                      ["baccarat", t.baccarat],
                      ["blackjack", t.blackjack],
                      ["poker", t.poker],
                    ] as const).map(([value, label]) => (
                      <button key={value} type="button" className={filters.game === value ? "filter-chip active" : "filter-chip"} onClick={() => updateFilters({ ...filters, game: value })}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="filter-group">
                  <h3>{t.behaviorTag}</h3>
                  <div className="filter-chip-list">
                    {([
                      ["all", t.all],
                      ["aggressive", t.aggressive],
                      ["conservative", t.conservative],
                      ["highVariance", t.highVariance],
                      ["noHistory", t.noHistory],
                    ] as const).map(([value, label]) => (
                      <button key={value} type="button" className={filters.tag === value ? "filter-chip active" : "filter-chip"} onClick={() => updateFilters({ ...filters, tag: value })}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="filter-actions">
                  <button type="button" className="filter-reset" onClick={() => updateFilters(defaultFilters)} disabled={activeFilterCount === 0}>{t.resetFilters}</button>
                  <button type="button" className="filter-apply" onClick={() => setFilterOpen(false)}>{t.showCustomers} · {filteredScenarios.length}</button>
                </div>
              </div>
            )}
          </div>
          <button className="queue-arrow" type="button" onClick={() => advanceScenario(1)} aria-label={t.nextCustomer}>→</button>
          <button
            className={autoTour ? "auto-tour active" : "auto-tour"}
            type="button"
            onClick={() => setAutoTour((value) => !value)}
            aria-pressed={autoTour}
          >
            <span><i /></span>{t.autoTour}
          </button>
        </div>
        <div className="context-actions">
          <button
            className={storyMode ? "story-button active" : "story-button"}
            type="button"
            onClick={() => { setStoryMode((value) => !value); setStoryStep(0); }}
          >
            <span>▶</span> {storyMode ? t.exitStory : t.presentStory}
          </button>
          <button className="run-button" type="button" onClick={runAnalysis} disabled={analysisStage >= 0}>
            <span className={analysisStage >= 0 ? "spark spin" : "spark"}>✦</span>
            {analysisStage >= 0 ? stageLabels[analysisStage] : t.runAnalysis}
          </button>
        </div>
      </section>

      <section className="data-pulse-strip" aria-label={t.realDataPulse}>
        <button type="button" className="data-pulse-title" onClick={() => openPulseDetail("profiles")} aria-label={t.viewDataDetails}><span className="db-live-dot" /><span><strong>{t.realDataPulse}</strong><small>{t.realSnapshot}</small></span></button>
        {([[
          "profiles", pulseLabels.profiles,
        ], [
          "sessions", pulseLabels.sessions,
        ], [
          "recommendations", pulseLabels.recommendations,
        ], [
          "risks", pulseLabels.risks,
        ], [
          "messages", pulseLabels.messages,
        ]] as [PulseMetric, string][]).map(([metric, label]) => (
          <button type="button" className="pulse-metric" key={metric} onClick={() => openPulseDetail(metric)}>{label}<span>↗</span></button>
        ))}
      </section>

      {pulseOpen && (
        <div className="pulse-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPulseOpen(false); }}>
          <section className="pulse-modal" role="dialog" aria-modal="true" aria-labelledby="pulse-dialog-title">
            <div className="pulse-modal-head">
              <div><span className="db-live-dot" /><div><small>{t.realDataPulse}</small><h2 id="pulse-dialog-title">{activePulseDetail.title}</h2></div></div>
              <button type="button" onClick={() => setPulseOpen(false)} aria-label={t.closeDialog}>×</button>
            </div>
            <p className="pulse-modal-summary">{activePulseDetail.summary}</p>
            <div className="pulse-modal-tabs" role="tablist">
              {(Object.keys(visiblePulseDetails) as PulseMetric[]).map((metric) => (
                <button type="button" role="tab" aria-selected={pulseMetric === metric} className={pulseMetric === metric ? "active" : ""} key={metric} onClick={() => setPulseMetric(metric)}>{visiblePulseDetails[metric].title.split(" ")[0]}</button>
              ))}
            </div>
            <div className="pulse-stat-list">
              {activePulseDetail.stats.map((stat) => (
                <article key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong><p>{stat.note}</p></article>
              ))}
            </div>
            <div className="pulse-source"><span>{t.sourceCollection}</span><code>{activePulseDetail.collection}</code></div>
          </section>
        </div>
      )}

      {storyMode && (
        <section className="story-guide" aria-live="polite">
          <div className="story-progress" aria-label={`${t.storyProgress} ${storyStep + 1} / ${storySteps.length}`}>
            {storySteps.map((step, index) => (
              <button
                type="button"
                key={step.kicker}
                className={index === storyStep ? "active" : index < storyStep ? "complete" : ""}
                onClick={() => setStoryStep(index)}
                aria-label={`${t.jumpTo} ${step.title}`}
              >
                <span>{index < storyStep ? "✓" : index + 1}</span>
                <small>{step.kicker.split(" · ")[1]}</small>
              </button>
            ))}
          </div>
          <div className="story-copy">
            <span>{storySteps[storyStep].kicker}</span>
            <div>
              <h2>{storySteps[storyStep].title}</h2>
              <p>{storySteps[storyStep].copy}</p>
            </div>
          </div>
          <div className="story-data">
            {storyStep === 0 && <><code>{t.collections}</code><code>{t.records}</code><code>{t.freshness}</code></>}
            {storyStep === 1 && <><code>{t.observedCount}</code><code>{t.inferredCount}</code></>}
            {storyStep === 2 && <><code>{t.recommendedCount}</code><code>{t.alternativeCount}</code></>}
            {storyStep === 3 && <><code>{t.policyVersion}</code><code>{t.auditCaptured}</code></>}
          </div>
          <button
            className="story-next"
            type="button"
            onClick={() => setStoryStep((step) => (step + 1) % storySteps.length)}
          >
            {storyStep === storySteps.length - 1 ? t.replay : t.next} →
          </button>
        </section>
      )}

      <section className="workspace-grid">
        <aside className="profile-panel panel">
          <div className="panel-kicker">{t.liveContext}</div>
          <div className="identity-block">
            <div className="avatar">{scenario.initials}</div>
            <div>
              <h2>{snapshot.maskedName}</h2>
              <p>{snapshot.patronId} · <strong>{snapshot.tier}</strong></p>
            </div>
            <span className={`status-badge ${scenario.statusTone}`}>{scenario.status}</span>
          </div>

          <div className="session-hero">
            <div className="table-orbit" aria-hidden="true">
              <span>{snapshot.tableId}</span>
            </div>
            <div>
              <p>{t.activeSession}</p>
              <h3>{scenario.game}</h3>
              <span>{snapshot.behavior} · {t.live}</span>
            </div>
          </div>

          <dl className="metric-grid">
            <div><dt>{t.turnover}</dt><dd>{snapshot.sessionBet}</dd></div>
            <div><dt>{t.estNet}</dt><dd>{snapshot.stack}</dd></div>
            <div><dt>{t.avgBet}</dt><dd>{snapshot.adt}</dd></div>
            <div><dt>{t.latestBet}</dt><dd>{snapshot.points}</dd></div>
          </dl>

          <div className="profile-section">
            <div className="section-heading"><h3>{t.relationship}</h3><span>{t.days90}</span></div>
            <div className="relationship-row"><span>{t.host}</span><strong>{snapshot.suggestedPr}</strong></div>
            <div className="relationship-row"><span>{t.visits}</span><strong>{snapshot.reportStatus}</strong></div>
            <div className="relationship-row"><span>{t.customerValue}</span><strong>{snapshot.region}</strong></div>
          </div>

          <div className="profile-section">
            <div className="section-heading"><h3>{t.preferences}</h3></div>
            <div className="tag-list">
              {[snapshot.behavior, snapshot.riskFlag, snapshot.tier].map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        </aside>

        <section className="analysis-panel panel">
          <div className="analysis-heading">
            <div>
              <div className="panel-kicker mint">{t.aiAnalysis}</div>
              <h2>{t.whatMatters}</h2>
            </div>
            <div className="analysis-meta">
              <span>{snapshot.model}</span>
              <small>{t.lastRun} {lastRun}</small>
            </div>
          </div>

          {analysisStage >= 0 && (
            <div className="analysis-progress" role="status" aria-live="polite">
              <div className="progress-track">
                {stageLabels.map((label, index) => (
                  <span key={label} className={index <= analysisStage ? "complete" : ""} />
                ))}
              </div>
              <p><span className="pulse-dot" /> {stageLabels[analysisStage]}…</p>
            </div>
          )}

          <div className={analysisStage >= 0 ? "analysis-content muted" : "analysis-content"}>
            <div className="summary-card">
              <div className="summary-icon">AI</div>
              <div>
                <span>{t.currentAssessment}</span>
                <p>{scenario.summary}</p>
              </div>
            </div>

            <div className="change-callout">
              <span>{t.new}</span>
              <div><strong>{t.whatChanged}</strong><p>{scenario.change}</p></div>
            </div>

            <div className="mongo-evidence-card">
              <div className="evidence-head">
                <div><strong>{t.evidencePackage}</strong><small>{t.evidenceCollections}</small></div>
                <code>{snapshot.reportStatus}</code>
              </div>
              <div className="evidence-grid">
                <div><span>{t.maskedPatron}</span><strong>{snapshot.maskedName}</strong><small>{snapshot.patronId}</small></div>
                <div><span>{t.tierRegion}</span><strong>{snapshot.tier}</strong><small>{snapshot.region}</small></div>
                <div><span>{t.sessionBet}</span><strong>{snapshot.sessionBet}</strong><small>{snapshot.tableId} · Active</small></div>
                <div><span>{t.stackEstimate}</span><strong>{snapshot.stack}</strong><small>ADT {snapshot.adt}</small></div>
                <div><span>{t.behaviorRisk}</span><strong>{snapshot.behavior}</strong><small>{snapshot.riskFlag}</small></div>
                <div><span>{t.reportModel}</span><strong>{snapshot.reportStatus}</strong><small>{snapshot.model}</small></div>
              </div>
              <div className={`evidence-alert ${snapshot.alertLevel}`}><span>!</span><p>{alertText}</p></div>
              {(riskCategoryText || riskTriggerText || riskActionText) && (
                <div className="risk-explain-grid">
                  <article><span>{locale === "en" ? "Risk type" : locale === "zh-Hant" ? "風險類型" : "风险类型"}</span><strong>{riskCategoryText || "—"}</strong></article>
                  <article><span>{locale === "en" ? "Trigger evidence" : locale === "zh-Hant" ? "觸發證據" : "触发证据"}</span><strong>{riskTriggerText || "—"}</strong></article>
                  <article><span>{locale === "en" ? "Governed action" : locale === "zh-Hant" ? "治理動作" : "治理动作"}</span><strong>{riskActionText || "—"}</strong></article>
                </div>
              )}
            </div>

            <div className="section-heading divider-heading">
              <h3>{t.observedFacts}</h3>
              <span>{t.fromMongo}</span>
            </div>
            <div className="fact-timeline">
              {scenario.facts.map((fact, index) => (
                <article key={`${scenario.id}-${index}`}>
                  <time>{fact.time}</time>
                  <span className="timeline-node" />
                  <div><p>{fact.text}</p><code>{fact.source}</code></div>
                </article>
              ))}
            </div>

            <div className="section-heading divider-heading">
              <h3>{t.inferredInsights}</h3>
              <span>{t.explanationOnly}</span>
            </div>
            <div className="insight-list">
              {scenario.insights.map((insight) => (
                <article className="insight-row" key={insight.title}>
                  <div className={`insight-glyph ${insight.tone}`} aria-hidden="true">✦</div>
                  <div className="insight-copy">
                    <div><h4>{insight.title}</h4><strong>{insight.confidence}%</strong></div>
                    <p>{insight.detail}</p>
                    <span><i style={{ width: `${insight.confidence}%` }} /></span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <aside className="action-panel panel">
          <div className="panel-kicker">{t.nextBestAction}</div>
          <div className="action-title-row">
            <h2>{t.recommendedNow}</h2>
            <span className="governed-badge">✓ {t.governed}</span>
          </div>

          <div className="recommendation-card">
            <div className="recommendation-number">01</div>
            <h3>{scenario.recommendation.title}</h3>
            <p>{scenario.recommendation.subtitle}</p>
            <div className="recommendation-stats">
              <div><span>{t.acceptance}</span><strong>{scenario.recommendation.acceptance > 0 ? `${scenario.recommendation.acceptance}%` : "—"}</strong></div>
              <div><span>{t.estCost}</span><strong>{scenario.recommendation.cost}</strong></div>
              <div><span>{t.validFor}</span><strong>{scenario.recommendation.validity}</strong></div>
            </div>
            <div className="reason-box">
              <span>{t.whyAction}</span>
              {scenario.recommendation.reasons.map((reason) => <p key={reason}>✓ {reason}</p>)}
            </div>
          </div>

          <div className="section-heading compact-heading">
            <h3>{t.alternatives}</h3>
            {alternativeOverrideCount > 0 && <button type="button" className="reset-overrides" onClick={resetAlternativeStatuses}>{t.resetDecision} · {alternativeOverrideCount}</button>}
          </div>
          <div className="alternative-list">
            {scenario.alternatives.map((item, index) => {
              const effectiveStatus = currentAlternativeOverrides[index] ?? item.status;
              const isOverridden = currentAlternativeOverrides[index] !== undefined;
              return (
                <article className={effectiveStatus === "blocked" ? "alternative blocked" : "alternative"} key={item.title}>
                  <span>0{index + 2}</span>
                  <div><h4>{item.title}</h4><p>{item.meta}</p>{isOverridden && <small>{t.manualOverride}</small>}</div>
                  <button
                    type="button"
                    className={`alternative-status ${effectiveStatus}`}
                    aria-label={`${t.changeActionStatus}: ${item.title}`}
                    aria-pressed={effectiveStatus === "eligible"}
                    onClick={() => toggleAlternativeStatus(index, item.status)}
                  >
                    {effectiveStatus === "blocked" ? t.blocked : t.eligible}<span>↕</span>
                  </button>
                </article>
              );
            })}
          </div>

          <div className="host-message">
            <div className="section-heading">
              <div className="message-title"><h3>{t.hostMessage}</h3>{messageDrafts[scenario.id] !== undefined && <span>{t.customizedMessage}</span>}</div>
              <div className="message-tools">
                {messageDrafts[scenario.id] !== undefined && <button type="button" onClick={restoreHostMessage}>{t.restoreAiMessage}</button>}
                <button type="button" onClick={copyHostMessage}>{copiedMessage ? `✓ ${t.copied}` : t.copy}</button>
              </div>
            </div>
            <textarea value={currentHostMessage} onFocus={() => setAutoTour(false)} onChange={(event) => updateHostMessage(event.target.value)} aria-label={t.hostMessage} rows={5} />
          </div>

          {recommendationAlreadySent ? (
            <div className="recommendation-complete">
              <span>✓</span>
              <div>
                <strong>{t.recommendationCompleted} · {currentDeliveryLog ? { whatsapp: t.whatsapp, sms: t.sms, push: t.appPush }[currentDeliveryLog.channel] : t.whatsapp}</strong>
                <p>{t.recommendationCompletedDetail}</p>
                {currentDeliveryLog?.sentAt && <small>{new Date(currentDeliveryLog.sentAt).toLocaleTimeString(locale === "en" ? "en-GB" : "zh-CN", { hour12: false })}</small>}
              </div>
            </div>
          ) : (
            <>
              <button className={recommendationApproved ? "approve-button approved" : "approve-button"} type="button" onClick={() => setApprovedRecommendations((current) => ({ ...current, [scenario.id]: recommendationFingerprint }))}>
                {recommendationApproved ? `✓ ${t.approvedReady}` : t.approve}
              </button>

              <div className={recommendationApproved ? "delivery-panel ready" : "delivery-panel"}>
                <div className="delivery-heading"><strong>{t.sendRecommendation}</strong><small>{recommendationApproved ? snapshot.suggestedPr : t.governanceFirst}</small></div>
                <div className="channel-selector" role="group" aria-label={t.chooseChannel}>
                  {([[
                    "whatsapp", t.whatsapp,
                  ], [
                    "sms", t.sms,
                  ], [
                    "push", t.appPush,
                  ]] as [DeliveryChannel, string][]).map(([value, label]) => (
                    <button type="button" key={value} className={deliveryChannel === value ? "active" : ""} onClick={() => setDeliveryChannel(value)}>{label}</button>
                  ))}
                </div>
                <button className="send-button" type="button" disabled={!recommendationApproved} onClick={() => void dispatchNotification("recommendation")}>
                  {t.sendNow}
                </button>
              </div>
            </>
          )}

          <button className="ask-button" type="button" onClick={() => setShowAnswer((value) => !value)}>
            <span>?</span> {t.whyRecommendation}
          </button>
          {showAnswer && <div className="answer-box">{scenario.answer}</div>}
        </aside>
      </section>

      <section className="governance-strip">
        <div>
          <span className="shield">✓</span>
          <div><strong>{t.governanceComplete}</strong><p>{t.governanceDetail}</p></div>
        </div>
        <div className="signal-list">
          {scenario.signals.map((signal) => (
            <span className={`signal ${signal.tone}`} key={signal.label}><small>{signal.label}</small><strong>{signal.value}</strong></span>
          ))}
        </div>
        <div className="audit-id"><small>{t.decisionId}</small><code>{snapshot.reportId}</code></div>
      </section>
      </> : <CommandCenter
        locale={locale}
        patronId={snapshot.patronId}
        onLivePatronsLoaded={(patrons, sourceCounts) => {
          // CommandCenter already filters empty/partial responses. Keep this
          // guard at the shell boundary as well so a future caller cannot
          // clear the global dashboard snapshot with a transient empty list.
          if (!patrons.length) return;
          setLivePatrons(patrons);
          if (sourceCounts) setLiveSourceCounts(sourceCounts);
          setLiveDataError("");
        }}
        onOpenDecision={(patronId) => {
        pendingDecisionSelectionRef.current = patronId;
        // Keep the selected customer in view for the full one-minute demo;
        // the journey itself advances every three seconds in MongoDB.
        setAutoTour(false);
        // Do not discard a persisted journey when the operator leaves and
        // re-enters the same customer. Clear only when switching customers;
        // the API will also restore the latest MongoDB checkpoint on entry.
        setUpgradeJourney((current) => current?.patronId === patronId ? current : (upgradeJourneys[patronId] || null));
        setUpgradeError("");
        setFilters(defaultFilters);
        setSearchQuery("");
        setSearchOpen(false);
        setSelectedId(patronId);
        setLiveRefreshTick((tick) => tick + 1);
        setPrimaryView("customers");
      }}
        journeyOverrides={upgradeJourneys}
      />}
      {toast && <div className="delivery-toast" role="status"><span>✓</span>{toast}<small>{t.deliveredTo} · {lastRecipient}</small></div>}
    </main>
  );
}
