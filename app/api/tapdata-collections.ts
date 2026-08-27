const DEFAULT_COLLECTION_MAP: Record<string, string> = {
  alert_rules: "ops_alert_rules",
  campaign_runs: "marketing_campaign_runs",
  chat_messages: "ai_chat_messages_src",
  chat_sessions: "ai_chat_sessions_src",
  offer_approval_audit: "ai_offer_approval_audit_src",
  offer_catalog: "offer_catalog",
  offer_recommendations: "ai_offer_recommendations_src",
  patron_activity_events: "patron_activity_events_ai_ready",
  patron_alerts: "ops_patron_alerts_ai_ready",
  patron_analysis_reports: "ai_patron_analysis_reports_src",
  patron_interaction_history: "patron_interaction_history_ai_ready",
  patron_profiles: "patron_profiles",
  patron_realtime_decision_signals: "gaming_realtime_decision_signals_ai_ready",
  patron_risk_cases: "responsible_play_cases_ai_ready",
  patron_table_sessions: "patron_table_sessions",
  pr_assignments: "host_assignments_ai_ready",
  pr_agent_profiles: "pr_agent_profiles",
  table_minbet_audit: "gaming_table_minbet_audit",
  table_minbet_recommendations: "gaming_table_minbet_recommendations",
  table_round_counters: "gaming_table_round_counters",
  table_round_history: "gaming_player_round_bets",
  table_state_history: "gaming_table_state_history",
  table_state_snapshots: "gaming_table_state",
};

let cachedRawMap: string | undefined;
let cachedCollectionMap: Record<string, string> | null = null;

function parseCollectionMap(raw: string | undefined) {
  if (!raw?.trim()) return DEFAULT_COLLECTION_MAP;
  if (cachedCollectionMap && cachedRawMap === raw) return cachedCollectionMap;

  const trimmed = raw.trim();
  let parsed: Record<string, string> = {};

  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([, apiName]) => typeof apiName === "string" && apiName.trim())
        .map(([logicalName, apiName]) => [logicalName.trim(), String(apiName).trim()]));
    }
  } catch {
    parsed = Object.fromEntries(trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split(/[:=]/).map((part) => part.trim()))
      .filter((parts): parts is [string, string] => parts.length >= 2 && Boolean(parts[0]) && Boolean(parts[1]))
      .map(([logicalName, apiName]) => [logicalName, apiName]));
  }

  cachedRawMap = raw;
  cachedCollectionMap = { ...DEFAULT_COLLECTION_MAP, ...parsed };
  return cachedCollectionMap;
}

export function tapDataApiCollection(logicalCollection: string) {
  const map = parseCollectionMap(process.env.TAPDATA_COLLECTION_MAP);
  return map[logicalCollection] || logicalCollection;
}

export function tapDataCollectionUrl(baseUrl: string, findPathTemplate: string, logicalCollection: string) {
  const apiCollection = tapDataApiCollection(logicalCollection);
  const path = findPathTemplate.replace("{collection}", encodeURIComponent(apiCollection));
  return /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function tapDataCollectionLabel(logicalCollection: string) {
  const apiCollection = tapDataApiCollection(logicalCollection);
  return apiCollection === logicalCollection ? logicalCollection : `${logicalCollection}→${apiCollection}`;
}
