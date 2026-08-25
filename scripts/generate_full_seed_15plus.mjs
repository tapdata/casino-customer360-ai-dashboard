import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("artifacts/seed-data/full-15plus");
fs.mkdirSync(outDir, { recursive: true });

const games = [
  ["BAC", "Baccarat"],
  ["ROU", "Roulette"],
  ["BLA", "Blackjack"],
  ["POK", "Poker"],
  ["SIC", "Sic Bo"],
];
const tiers = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"];
const ratingCodes = { Diamond: "DIA", Platinum: "PLA", Gold: "GOL", Silver: "SIL", Bronze: "BRO" };
const regions = ["Hong Kong", "Macau", "Guangdong", "Mainland China", "Taiwan", "Singapore"];
const names = [
  ["Chan Wai Ming", "C****n"],
  ["Lau Ka Ho", "L****o"],
  ["Wong Mei Ling", "W****g"],
  ["Zhang Rui", "Z****g"],
  ["Ng Chi Kin", "N****g"],
  ["Ho Man Kit", "H****t"],
  ["Li Wen", "L****n"],
  ["Cheung Hoi Yan", "C****g"],
  ["Tam Ka Lok", "T****m"],
  ["Zhou Chen", "Z****u"],
  ["Lam Sze Nga", "L****m"],
  ["Wu Hao", "W****u"],
  ["Yeung Tsz Hin", "Y****g"],
  ["Chen Jiayi", "C****n"],
  ["Tang Pak Hei", "T****g"],
  ["Liao Ming", "L****o"],
  ["Yip Wing", "Y****p"],
  ["Guo Lin", "G****o"],
  ["Fong Hei", "F****g"],
  ["Ma Jun", "M****a"],
];
const benefitSets = [
  ["SuiteUpgrade", "LateCheckout", "FineDining"],
  ["Cashback", "Hotel"],
  ["Dining", "Show"],
  ["Points", "Dining"],
  ["HostCare", "SuiteUpgrade"],
  ["Transport", "FineDining"],
  ["Concert", "Hotel"],
  ["Spa", "LateCheckout"],
  ["PrivateRoom", "Dining"],
  ["Points", "Show"],
];
const tagSets = [
  ["HighValueReturn", "PromoSeeker"],
  ["Aggressive", "LateNight"],
  ["Steady", "TableWatcher"],
  ["OfferFatigue", "Conservative"],
  ["HighValueReturn", "HostFollowupOverdue"],
  ["NightOnly", "CashbackInterest"],
  ["PromoSensitive", "DiningIntent"],
  ["HighVelocity", "RiskWatch"],
  ["SuiteIntent", "FineDiningInterest"],
  ["LowEngagement", "Conservative"],
];
const patrons = Array.from({ length: 20 }, (_, i) => {
  const n = 100861 + i;
  const tier = tiers[i % tiers.length];
  const [gameCode, game] = games[i % games.length];
  const [fullName, maskedName] = names[i];
  const customerNo = 88921 + i;
  const guestNo = 2918 + i;
  const fixedStoryTables = ["T-0014", "T-0012", "T-0008", "T-0021", "T-0026"];
  const patronId = `P0000${n}`;
  const playerId = `${n}`;
  return {
    i,
    patronId,
    playerId,
    guestId: `H00${guestNo}`,
    memberNo: `VIP${n}`,
    customerId: `C${customerNo}`,
    cardNo: `CARD-${n}`,
    fullName,
    maskedName,
    passportHash: `PASS-DEMO-${n}`,
    mobileHash: `MOB-DEMO-${n}`,
    tier,
    ratingCode: ratingCodes[tier],
    region: regions[i % regions.length],
    gameCode,
    game,
    adt: 6000 + i * 2300 + (tier === "Diamond" ? 18000 : tier === "Platinum" ? 11000 : 0),
    theo: 25000 + i * 7800,
    points: 18000 + i * 12500,
    benefits: benefitSets[i % benefitSets.length],
    tags: tagSets[i % tagSets.length],
    tableId: fixedStoryTables[i] || `T-${String((i % 30) + 1).padStart(4, "0")}`,
    sessionId: `S-${n}-001`,
    bet: 8000 + i * 4200 + (tier === "Diamond" ? 28000 : tier === "Platinum" ? 18000 : 0),
    stack: 25000 + i * 7300,
    hostId: [`PR-007`, `PR-012`, `PR-018`, `PR-021`, `PR-003`, `PR-009`, `PR-011`, `PR-016`, `PR-020`, `PR-025`][i % 10],
  };
});
Object.assign(patrons[0], {
  tier: "Diamond",
  ratingCode: "DIA",
  gameCode: "BAC",
  game: "Baccarat",
  adt: 42000,
  theo: 188000,
  points: 388000,
  benefits: ["SuiteUpgrade", "LateCheckout", "FineDining"],
  tags: ["HighValueReturn", "PromoSeeker"],
  tableId: "T-0014",
  bet: 68000,
  stack: 118000,
  hostId: "PR-007",
});
Object.assign(patrons[1], {
  tier: "Platinum",
  ratingCode: "PLA",
  gameCode: "BAC",
  game: "Baccarat",
  adt: 26000,
  theo: 126000,
  points: 214000,
  benefits: ["Limousine", "FineDining"],
  tags: ["Aggressive", "LateNight"],
  tableId: "T-0012",
  bet: 92000,
  stack: 74000,
  hostId: "PR-012",
});
Object.assign(patrons[2], {
  tier: "Gold",
  ratingCode: "GOL",
  gameCode: "ROU",
  game: "Roulette",
  adt: 16000,
  theo: 82000,
  points: 139000,
  benefits: ["Cashback", "ShowTicket"],
  tags: ["OfferFatigue", "PromoSensitive"],
  tableId: "T-0008",
  bet: 28000,
  stack: 46000,
  hostId: "PR-018",
});
const tables = Array.from({ length: 30 }, (_, i) => {
  const idx = i + 1;
  const [gameCode, game] = games[i % games.length];
  const zone = ["VIP", "A", "B", "C", "Mass"][i % 5];
  const count = i % 7 === 0 ? 9 : (i % 9);
  const capacity = 9;
  return {
    tableId: `T-${String(idx).padStart(4, "0")}`,
    tableName: `Table ${idx}`,
    zone,
    gameCode,
    game,
    capacity,
    patronCount: count,
    minBet: zone === "VIP" ? 1000 : i % 3 === 0 ? 800 : 300 + (i % 3) * 200,
    maxBet: zone === "VIP" ? 200000 : 50000 + (i % 5) * 25000,
    avgBet: 3000 + i * 900 + (zone === "VIP" ? 18000 : 0),
    status: i % 11 === 0 ? "CLOSED" : count >= 8 ? "BUSY" : count >= 6 ? "HOT" : "OPEN",
  };
});
const tableOverrides = {
  "T-0014": { tableName: "Table 14", zone: "VIP", gameCode: "BAC", game: "Baccarat", patronCount: 8, minBet: 1000, maxBet: 200000, avgBet: 28600, status: "HOT" },
  "T-0012": { tableName: "Table 12", zone: "C", gameCode: "BAC", game: "Baccarat", patronCount: 8, minBet: 1000, maxBet: 150000, avgBet: 31800, status: "BUSY" },
  "T-0008": { tableName: "Table 8", zone: "B", gameCode: "ROU", game: "Roulette", patronCount: 8, minBet: 300, maxBet: 50000, avgBet: 9600, status: "HOT" },
  "T-0021": { tableName: "Table 21", zone: "A", gameCode: "POK", game: "Poker", patronCount: 4, minBet: 500, maxBet: 60000, avgBet: 7200, status: "OPEN" },
  "T-0026": { tableName: "Table 26", zone: "VIP", gameCode: "BAC", game: "Baccarat", patronCount: 5, minBet: 1000, maxBet: 180000, avgBet: 24500, status: "OPEN" },
};
for (const table of tables) Object.assign(table, tableOverrides[table.tableId] || {});
const hosts = [
  ["PR-007", "Marcus Lei", "VIP Baccarat Hosts", ["Cantonese", "English", "Mandarin"], ["Diamond", "Platinum"], ["Baccarat"], ["HighValue", "HotelCare"]],
  ["PR-012", "Ivy Choi", "Risk-Aware Hosts", ["Cantonese", "Mandarin"], ["Platinum", "Gold"], ["Baccarat", "Sic Bo"], ["RiskAware"]],
  ["PR-018", "Ken Wong", "Mass Premium Hosts", ["Mandarin", "English"], ["Gold", "Silver"], ["Roulette"], ["MassPremium"]],
  ["PR-021", "Tina Wu", "Retention Hosts", ["Mandarin", "Cantonese"], ["Gold", "Silver"], ["Poker"], ["Retention"]],
  ["PR-003", "Alex Ho", "Diamond Hosts", ["Cantonese", "English"], ["Diamond"], ["Baccarat"], ["DiamondCare"]],
  ["PR-009", "Sofia Chan", "Entertainment Hosts", ["English", "Mandarin"], ["Platinum", "Gold"], ["Blackjack"], ["Show", "Concert"]],
  ["PR-011", "Ben Wong", "Dining Hosts", ["Cantonese", "Mandarin"], ["Gold", "Silver"], ["Roulette"], ["Dining"]],
  ["PR-016", "Mia Zhang", "Travel Hosts", ["Mandarin", "English"], ["Diamond", "Platinum"], ["Baccarat"], ["Transport"]],
  ["PR-020", "Oscar Lam", "Weekend Hosts", ["Cantonese"], ["Silver", "Bronze"], ["Poker"], ["Weekend"]],
  ["PR-025", "Grace Li", "App Hosts", ["Mandarin", "English"], ["Gold", "Bronze"], ["Sic Bo"], ["AppEngagement"]],
  ["PR-026", "Hugo Tang", "VIP Overflow", ["Cantonese", "English"], ["Diamond"], ["Blackjack"], ["Overflow"]],
  ["PR-027", "Nora Ho", "Recovery Hosts", ["Mandarin"], ["Gold", "Silver"], ["Poker"], ["Recovery"]],
  ["PR-028", "Jason Ng", "Baccarat Hosts", ["Cantonese"], ["Platinum"], ["Baccarat"], ["Baccarat"]],
  ["PR-029", "Kelly Zhou", "Premium Hosts", ["Mandarin", "English"], ["Platinum", "Gold"], ["Roulette"], ["Premium"]],
  ["PR-030", "Ryan Fong", "Late Night Hosts", ["Cantonese", "Mandarin"], ["Diamond", "Platinum"], ["Sic Bo"], ["LateNight"]],
];
const offers = [
  ["OFF-SUITE-DINING-001", "套房升级 + 延迟退房 + 高级餐饮礼遇", "HotelDining", 2800, ["Baccarat"], ["Diamond", "Platinum"], 90],
  ["OFF-DINING-002", "高级餐饮券", "Dining", 1200, ["Roulette", "Baccarat"], ["Gold", "Platinum", "Diamond"], 70],
  ["OFF-SHOW-003", "VIP 演出双人票", "Entertainment", 1800, ["Blackjack"], ["Gold", "Platinum", "Diamond"], 65],
  ["OFF-CASHBACK-004", "限时现金回扣", "Cashback", 5000, ["Baccarat"], ["Diamond"], 95],
  ["OFF-HOST-CARE-005", "客户经理专属关怀", "HostCare", 300, ["Baccarat", "Poker"], ["Platinum", "Diamond"], 80],
  ["OFF-TRANSPORT-006", "尊贵车队接送", "Transport", 2200, ["Baccarat"], ["Diamond", "Platinum"], 75],
  ["OFF-POINTS-007", "积分闪兑礼遇", "Points", 600, ["Poker"], ["Silver", "Gold"], 50],
  ["OFF-SPA-008", "水疗放松礼遇", "Wellness", 1600, ["Roulette"], ["Gold", "Platinum"], 55],
  ["OFF-PRIVATE-009", "私人贵宾室体验", "PrivateRoom", 3500, ["Baccarat"], ["Diamond"], 92],
  ["OFF-LATE-010", "延迟退房礼遇", "Hotel", 800, ["Sic Bo"], ["Gold", "Platinum", "Diamond"], 60],
  ["OFF-BUFFET-011", "精选自助餐券", "Dining", 500, ["Roulette"], ["Bronze", "Silver", "Gold"], 40],
  ["OFF-CONCERT-012", "演唱会贵宾席", "Entertainment", 3000, ["Blackjack"], ["Platinum", "Diamond"], 78],
  ["OFF-CHIPS-013", "非博彩筹码服务", "Service", 0, ["Poker"], ["Diamond", "Platinum"], 72],
  ["OFF-TEA-014", "贵宾茶点礼遇", "Dining", 300, ["Sic Bo"], ["Silver", "Gold"], 35],
  ["OFF-FAMILY-015", "家庭套票礼遇", "Family", 2600, ["Roulette"], ["Gold", "Platinum"], 58],
  ["OFF-ROOM-016", "高级客房周末价", "Hotel", 1500, ["Baccarat"], ["Gold", "Platinum"], 62],
  ["OFF-MERCH-017", "纪念精品礼袋", "Gift", 450, ["Poker"], ["Bronze", "Silver"], 30],
  ["OFF-AIRPORT-018", "机场贵宾服务", "Transport", 1800, ["Baccarat"], ["Diamond"], 88],
];
const q = (s) => String(s).replaceAll("'", "''");
const oraStr = (s) => `'${q(s)}'`;
const msStr = (s) => `N'${q(s)}'`;
const pgStr = (s) => `'${q(s)}'`;
const oraTs = (i, h = 20, m = 0) => `TIMESTAMP '2026-08-24 ${String(h).padStart(2, "0")}:${String((m + i) % 60).padStart(2, "0")}:00'`;
const msTs = (i, h = 20, m = 0) => `'2026-08-24T${String(h).padStart(2, "0")}:${String((m + i) % 60).padStart(2, "0")}:00'`;
const pgTs = (i, h = 20, m = 0) => `'2026-08-24T${String(h).padStart(2, "0")}:${String((m + i) % 60).padStart(2, "0")}:00+08:00'`;
const oraArrayString = (arr) => arr.join(",");
const pgArray = (arr, type = "text") => (arr.length ? `ARRAY[${arr.map(pgStr).join(",")}]` : `ARRAY[]::${type}[]`);
const pgJson = (obj) => `'${q(JSON.stringify(obj))}'::jsonb`;
const msJson = (obj) => `N'${q(JSON.stringify(obj))}'`;

function writeOracle() {
  const lines = [];
  lines.push(`-- Oracle Gaming source full seed, 15+ rows per table`);
  lines.push(`-- Execute in DBeaver connection: orcl / schema C##GAMING`);
  lines.push(`ALTER SESSION SET CURRENT_SCHEMA = C##GAMING;`);
  lines.push(``);
  lines.push(`CREATE TABLE GAMING_PLAYER_ACCOUNT (PLAYER_ID VARCHAR2(32) PRIMARY KEY, CASINO_CARD_NO VARCHAR2(64), FULL_NAME VARCHAR2(120), PASSPORT_HASH VARCHAR2(128), MOBILE_HASH VARCHAR2(128), ACCOUNT_STATUS VARCHAR2(32), CREATED_AT TIMESTAMP);`);
  lines.push(`CREATE TABLE GAMING_PLAYER_RATINGS (RATING_ID VARCHAR2(64) PRIMARY KEY, PLAYER_ID VARCHAR2(32), ADT_AMOUNT NUMBER(18,2), THEO_WIN_AMOUNT NUMBER(18,2), LAST_VISIT_AT TIMESTAMP, PREFERRED_GAME_CODE VARCHAR2(32), RATING_TIER_CODE VARCHAR2(32), UPDATED_AT TIMESTAMP);`);
  lines.push(`CREATE TABLE GAMING_TABLE_STATE (TABLE_ID VARCHAR2(32) PRIMARY KEY, TABLE_NAME VARCHAR2(64), ZONE_CODE VARCHAR2(32), GAME_CODE VARCHAR2(32), CAPACITY NUMBER(10), PATRON_COUNT NUMBER(10), MIN_BET_HKD NUMBER(18,2), MAX_BET_HKD NUMBER(18,2), AVG_BET_HKD NUMBER(18,2), TABLE_STATUS VARCHAR2(32), REFRESHED_AT TIMESTAMP);`);
  lines.push(`CREATE TABLE GAMING_TABLE_STATE_HISTORY (HISTORY_ID VARCHAR2(64) PRIMARY KEY, TABLE_ID VARCHAR2(32), TABLE_NAME VARCHAR2(64), ZONE_CODE VARCHAR2(32), GAME_CODE VARCHAR2(32), CAPACITY NUMBER(10), PATRON_COUNT NUMBER(10), MIN_BET_HKD NUMBER(18,2), MAX_BET_HKD NUMBER(18,2), AVG_BET_HKD NUMBER(18,2), TABLE_STATUS VARCHAR2(32), REFRESHED_AT TIMESTAMP);`);
  lines.push(`CREATE TABLE GAMING_TABLE_SESSIONS (SESSION_ID VARCHAR2(64) PRIMARY KEY, PLAYER_ID VARCHAR2(32), TABLE_ID VARCHAR2(32), SEATED_AT TIMESTAMP, LAST_ACTION_AT TIMESTAMP, SESSION_BET_HKD NUMBER(18,2), PREVIOUS_BET_HKD NUMBER(18,2), CURRENT_STACK_HKD NUMBER(18,2), BEHAVIOR_TAGS VARCHAR2(200), IS_ACTIVE NUMBER(1));`);
  lines.push(`CREATE TABLE GAMING_PLAYER_ROUND_BETS (ROUND_BET_ID VARCHAR2(64) PRIMARY KEY, TABLE_ID VARCHAR2(32), ROUND_NUMBER NUMBER(18), PLAYER_ID VARCHAR2(32), BET_AMOUNT_HKD NUMBER(18,2), BEHAVIOR_TAGS VARCHAR2(200), RECORDED_AT TIMESTAMP);`);
  lines.push(`CREATE TABLE GAMING_TABLE_ROUND_COUNTERS (COUNTER_ID VARCHAR2(64) PRIMARY KEY, TABLE_ID VARCHAR2(32), BUSINESS_DATE DATE, ROUND_NUMBER NUMBER(18), UPDATED_AT TIMESTAMP);`);
  lines.push(`CREATE TABLE GAMING_TABLE_MINBET_AUDIT (AUDIT_ID VARCHAR2(64) PRIMARY KEY, TABLE_ID VARCHAR2(32), RECOMMENDATION_ID VARCHAR2(64), OLD_MIN_BET_HKD NUMBER(18,2), NEW_MIN_BET_HKD NUMBER(18,2), ACTOR_ID VARCHAR2(64), SOURCE VARCHAR2(64), AT_TIME TIMESTAMP);`);
  lines.push(`CREATE TABLE GAMING_TABLE_MINBET_RECOMMENDATIONS (REC_ID VARCHAR2(64) PRIMARY KEY, TABLE_ID VARCHAR2(32), CURRENT_MIN_BET_HKD NUMBER(18,2), RECOMMENDED_MIN_BET_HKD NUMBER(18,2), DELTA_PCT NUMBER(8,2), EXPECTED_REVENUE_UPLIFT_PCT NUMBER(8,2), CONFIDENCE NUMBER(5,2), DRIVERS_JSON CLOB, CANDIDATES_JSON CLOB, REASONS VARCHAR2(500), RATIONALE VARCHAR2(500), SKIP_REASON VARCHAR2(200), RUN_ID VARCHAR2(64), STATUS VARCHAR2(32), CREATED_AT TIMESTAMP, EXPIRES_AT TIMESTAMP);`);
  lines.push(``);
  for (const p of patrons) lines.push(`INSERT INTO GAMING_PLAYER_ACCOUNT VALUES (${oraStr(p.playerId)}, ${oraStr(p.cardNo)}, ${oraStr(p.fullName)}, ${oraStr(p.passportHash)}, ${oraStr(p.mobileHash)}, 'ACTIVE', ${oraTs(p.i, 10, 0)});`);
  for (const p of patrons) lines.push(`INSERT INTO GAMING_PLAYER_RATINGS VALUES (${oraStr(`R-${p.playerId}`)}, ${oraStr(p.playerId)}, ${p.adt}, ${p.theo}, ${oraTs(p.i, 12, 0)}, ${oraStr(p.gameCode)}, ${oraStr(p.ratingCode)}, ${oraTs(p.i, 20, 0)});`);
  for (const t of tables) lines.push(`INSERT INTO GAMING_TABLE_STATE VALUES (${oraStr(t.tableId)}, ${oraStr(t.tableName)}, ${oraStr(t.zone)}, ${oraStr(t.gameCode)}, ${t.capacity}, ${t.patronCount}, ${t.minBet}, ${t.maxBet}, ${t.avgBet}, ${oraStr(t.status)}, TIMESTAMP '2026-08-24 20:${String((Number(t.tableId.slice(-2)) + 10) % 60).padStart(2, "0")}:00');`);
  tables.forEach((t, i) => {
    [1, 2, 3].forEach((step) => {
      const count = Math.max(0, Math.min(t.capacity, t.patronCount - 3 + step));
      const avgBet = Math.max(500, Math.round(t.avgBet * (0.82 + step * 0.08)));
      const status = count >= 8 ? "BUSY" : count >= 6 ? "HOT" : count === 0 ? "CLOSED" : "OPEN";
      lines.push(`INSERT INTO GAMING_TABLE_STATE_HISTORY VALUES (${oraStr(`TSH-${t.tableId}-${step}`)}, ${oraStr(t.tableId)}, ${oraStr(t.tableName)}, ${oraStr(t.zone)}, ${oraStr(t.gameCode)}, ${t.capacity}, ${count}, ${t.minBet}, ${t.maxBet}, ${avgBet}, ${oraStr(status)}, TIMESTAMP '2026-08-24 19:${String((i + step * 10) % 60).padStart(2, "0")}:00');`);
    });
  });
  for (const p of patrons) lines.push(`INSERT INTO GAMING_TABLE_SESSIONS VALUES (${oraStr(p.sessionId)}, ${oraStr(p.playerId)}, ${oraStr(p.tableId)}, ${oraTs(p.i, 19, 0)}, ${oraTs(p.i, 20, 10)}, ${p.bet}, ${Math.round(p.bet * 0.62)}, ${p.stack}, ${oraStr(oraArrayString(p.tags))}, 1);`);
  patrons.forEach((p, i) => {
    [1, 2].forEach((r) => lines.push(`INSERT INTO GAMING_PLAYER_ROUND_BETS VALUES (${oraStr(`RB-${p.tableId}-${800 + i}-${p.playerId}-${r}`)}, ${oraStr(p.tableId)}, ${800 + i + r}, ${oraStr(p.playerId)}, ${Math.round(p.bet * (0.42 + r * 0.16))}, ${oraStr(oraArrayString(p.tags))}, ${oraTs(i + r, 20, 20)});`));
  });
  tables.forEach((t, i) => lines.push(`INSERT INTO GAMING_TABLE_ROUND_COUNTERS VALUES (${oraStr(`RC-${t.tableId}-20260824`)}, ${oraStr(t.tableId)}, DATE '2026-08-24', ${800 + i}, TIMESTAMP '2026-08-24 20:${String((i + 15) % 60).padStart(2, "0")}:00');`));
  tables.slice(0, 18).forEach((t, i) => lines.push(`INSERT INTO GAMING_TABLE_MINBET_AUDIT VALUES (${oraStr(`MBA-${t.tableId}-001`)}, ${oraStr(t.tableId)}, ${oraStr(`MBR-${t.tableId}-001`)}, ${Math.max(100, t.minBet - 200)}, ${t.minBet}, ${oraStr(`OPS-${String((i % 5) + 1).padStart(2, "0")}`)}, 'TapDataDemo', TIMESTAMP '2026-08-24 20:${String((i + 5) % 60).padStart(2, "0")}:00');`));
  tables.slice(0, 18).forEach((t, i) => {
    const drivers = { gameType: t.game, zone: t.zone, occupancyRate: +(t.patronCount / t.capacity).toFixed(2), p50Bet: t.avgBet * 0.6, p75Bet: t.avgBet * 0.9, p90Bet: t.avgBet * 1.4, lowBetShare: 0.18 + (i % 4) * 0.05, betHeadroom: 0.22 + (i % 3) * 0.08, tierMix: { Diamond: i % 5, Platinum: i % 4, Gold: i % 6, Silver: i % 3, Bronze: i % 2 } };
    const candidates = [t.minBet, t.minBet + 200, t.minBet + 500].map((minBet, j) => ({ minBet, deltaPct: 5 + j * 8, expectedRevenuePct: 2 + j * 4, estimatedRetentionPct: 97 - j * 3 }));
    lines.push(`INSERT INTO GAMING_TABLE_MINBET_RECOMMENDATIONS VALUES (${oraStr(`MBR-${t.tableId}-001`)}, ${oraStr(t.tableId)}, ${t.minBet}, ${t.minBet + 500}, ${(((t.minBet + 500 - t.minBet) / t.minBet) * 100).toFixed(2)}, ${(4 + i * 0.4).toFixed(2)}, ${(0.70 + (i % 8) * 0.03).toFixed(2)}, ${oraStr(JSON.stringify(drivers))}, ${oraStr(JSON.stringify(candidates))}, ${oraStr('Occupancy and bet headroom support a min-bet increase')}, ${oraStr('Recommended by TapData aggregate demo rule')}, NULL, ${oraStr(`RUN-MB-20260824`)}, ${oraStr(i % 6 === 0 ? 'REVIEW' : 'PROPOSED')}, TIMESTAMP '2026-08-24 20:${String((i + 30) % 60).padStart(2, "0")}:00', TIMESTAMP '2026-08-24 22:${String((i + 30) % 60).padStart(2, "0")}:00');`);
  });
  lines.push(`COMMIT;`);
  fs.writeFileSync(path.join(outDir, "oracle_c##gaming_full_seed_15plus.sql"), lines.join("\n") + "\n");
}

function writeMssql() {
  const lines = [];
  lines.push(`-- MSSQL Ops source full seed, 15+ rows per table`);
  lines.push(`-- Execute in DBeaver connection: TAPDATA / database casino_ops / schema dbo`);
  lines.push(`USE casino_ops;`);
  lines.push(`GO`);
  lines.push(`CREATE TABLE dbo.hotel_stays (stay_id NVARCHAR(64) PRIMARY KEY, guest_id NVARCHAR(64), passport_hash NVARCHAR(128), mobile_hash NVARCHAR(128), loyalty_card_no NVARCHAR(64), check_in_at DATETIME2, planned_check_out_at DATETIME2, room_type NVARCHAR(64), upgrade_eligible BIT, late_checkout_eligible BIT, stay_status NVARCHAR(32), updated_at DATETIME2);`);
  lines.push(`CREATE TABLE dbo.room_inventory (inventory_id NVARCHAR(64) PRIMARY KEY, room_type NVARCHAR(64), available_count INT, upgrade_cost_hkd DECIMAL(18,2), business_date DATE, updated_at DATETIME2);`);
  lines.push(`CREATE TABLE dbo.responsible_play_cases (case_id NVARCHAR(64) PRIMARY KEY, guest_id NVARCHAR(64), player_id NVARCHAR(64), table_id NVARCHAR(64), risk_type NVARCHAR(64), risk_score INT, status NVARCHAR(32), reason NVARCHAR(500), created_at DATETIME2, updated_at DATETIME2);`);
  lines.push(`CREATE TABLE dbo.host_assignments (assignment_id NVARCHAR(64) PRIMARY KEY, guest_id NVARCHAR(64), player_id NVARCHAR(64), host_id NVARCHAR(64), host_name NVARCHAR(120), case_id NVARCHAR(64), status NVARCHAR(32), fit_score DECIMAL(6,2), active BIT, last_contact_at DATETIME2, sla_due_at DATETIME2, assigned_at DATETIME2, accepted_at DATETIME2 NULL, completed_at DATETIME2 NULL, updated_at DATETIME2);`);
  lines.push(`CREATE TABLE dbo.pr_agent_profiles (pr_agent_id NVARCHAR(64) PRIMARY KEY, agent_name NVARCHAR(120), preferred_languages NVARCHAR(300), preferred_tiers NVARCHAR(300), preferred_games NVARCHAR(300), specialty_tags NVARCHAR(300), max_active_patrons INT, current_active_patrons INT, active BIT, last_assigned_at DATETIME2, created_at DATETIME2, updated_at DATETIME2);`);
  lines.push(`CREATE TABLE dbo.ops_alert_rules (rule_id NVARCHAR(64) PRIMARY KEY, name NVARCHAR(160), nl_description NVARCHAR(500), condition_logic NVARCHAR(32), conditions_json NVARCHAR(MAX), status NVARCHAR(32), total_triggered INT, last_triggered_at DATETIME2 NULL, created_at DATETIME2);`);
  lines.push(`CREATE TABLE dbo.ops_patron_alerts (alert_id NVARCHAR(64) PRIMARY KEY, rule_id NVARCHAR(64), rule_name NVARCHAR(160), patron_source_player_id NVARCHAR(64), guest_id NVARCHAR(64), table_id NVARCHAR(64), triggered_conditions_json NVARCHAR(MAX), patron_snapshot_json NVARCHAR(MAX), table_snapshot_json NVARCHAR(MAX), status NVARCHAR(32), triggered_at DATETIME2, llm_rationale NVARCHAR(1000));`);
  lines.push(`GO`);
  const roomTypes = ["Executive Suite", "Fine Dining Voucher", "VIP Show Package", "Premium Suite", "Late Checkout", "Airport Transfer", "Spa Package", "Private Room", "Family Package", "Concert Ticket", "Tea Service", "Buffet Voucher", "Luxury Car", "Host Care", "Weekend Room"];
  patrons.forEach((p) => lines.push(`INSERT INTO dbo.hotel_stays VALUES (${msStr(`STAY-${p.guestId}-001`)}, ${msStr(p.guestId)}, ${msStr(p.passportHash)}, ${msStr(p.mobileHash)}, ${msStr(p.cardNo)}, ${msTs(p.i, 17, 0)}, ${msTs(p.i, 11, 0)}, ${msStr(["Deluxe King", "Premium Twin", "Executive Suite", "Standard King", "Premium Suite"][p.i % 5])}, ${p.i % 3 === 0 ? 1 : 0}, ${p.i % 2 === 0 ? 1 : 0}, N'CheckedIn', ${msTs(p.i, 20, 0)});`));
  roomTypes.forEach((rt, i) => lines.push(`INSERT INTO dbo.room_inventory VALUES (${msStr(`INV-${i + 1}-20260824`)}, ${msStr(rt)}, ${3 + (i % 9)}, ${(300 + i * 220).toFixed(2)}, '2026-08-24', ${msTs(i, 20, 10)});`));
  patrons.forEach((p) => {
    const activeRisk = p.i % 7 === 1 || p.tags.includes("Aggressive");
    const riskType = activeRisk ? "ResponsiblePlayReview" : p.tags.includes("OfferFatigue") ? "OfferFatigue" : p.tags.includes("HostFollowupOverdue") ? "HostSlaOverdue" : "None";
    const score = activeRisk ? 82 + (p.i % 10) : riskType === "None" ? 15 + (p.i % 20) : 38 + (p.i % 20);
    const status = activeRisk ? "Active" : riskType === "None" ? "Closed" : "Open";
    lines.push(`INSERT INTO dbo.responsible_play_cases VALUES (${msStr(`RPC-${p.playerId}-001`)}, ${msStr(p.guestId)}, ${msStr(p.playerId)}, ${msStr(p.tableId)}, ${msStr(riskType)}, ${score}, ${msStr(status)}, ${msStr(activeRisk ? "High wager velocity and responsible play review. Incentive offers must be blocked." : riskType === "None" ? "No active risk." : "Operational review required for customer care governance.")}, ${msTs(p.i, 18, 0)}, ${msTs(p.i, 20, 20)});`);
  });
  patrons.forEach((p, i) => {
    const h = hosts[i % hosts.length];
    lines.push(`INSERT INTO dbo.host_assignments VALUES (${msStr(`HA-${p.playerId}`)}, ${msStr(p.guestId)}, ${msStr(p.playerId)}, ${msStr(h[0])}, ${msStr(h[1])}, ${msStr(`CASE-${p.playerId}`)}, ${msStr(i % 6 === 0 ? "Completed" : "Assigned")}, ${(0.62 + (i % 8) * 0.04).toFixed(2)}, 1, ${msTs(i, 18, 15)}, ${msTs(i, i % 5 === 0 ? 19 : 22, 30)}, ${msTs(i, 20, 0)}, ${i % 6 === 0 ? msTs(i, 20, 10) : "NULL"}, ${i % 6 === 0 ? msTs(i, 20, 20) : "NULL"}, ${msTs(i, 20, 40)});`);
  });
  hosts.forEach((h, i) => lines.push(`INSERT INTO dbo.pr_agent_profiles VALUES (${msStr(h[0])}, ${msStr(h[1])}, ${msStr(h[3].join(","))}, ${msStr(h[4].join(","))}, ${msStr(h[5].join(","))}, ${msStr(h[6].join(","))}, ${8 + (i % 7)}, ${3 + (i % 8)}, 1, ${msTs(i, 20, 0)}, ${msTs(i, 10, 0)}, ${msTs(i, 20, 0)});`));
  const rules = Array.from({ length: 15 }, (_, i) => {
    const types = ["CONSECUTIVE_ROUNDS_BET_THRESHOLD", "ACTIVE_RISK_CASE", "HOST_SLA_OVERDUE", "OFFER_FATIGUE", "TABLE_OCCUPANCY_PRESSURE"];
    const type = types[i % types.length];
    return { id: `RULE-SEED-${String(i + 1).padStart(3, "0")}`, name: ["連續高額下注", "責任博彩複核", "客戶經理 SLA 超時", "優惠疲勞", "桌台擁擠預警"][i % 5], type, threshold: 10000 + i * 1000, rounds: 3 + (i % 3) };
  });
  rules.forEach((r, i) => lines.push(`INSERT INTO dbo.ops_alert_rules VALUES (${msStr(r.id)}, ${msStr(r.name)}, ${msStr(`Rule ${r.name} for governed AI alerting`)}, N'ALL', ${msJson([{ type: r.type, confidence: +(0.72 + (i % 8) * 0.03).toFixed(2), params: { threshold: r.threshold, rounds: r.rounds } }])}, N'Active', ${i * 2}, ${i % 3 === 0 ? msTs(i, 20, 30) : "NULL"}, ${msTs(i, 10, 0)});`));
  patrons.slice(0, 20).forEach((p, i) => {
    const r = rules[i % rules.length];
    const snapshot = { maskedName: p.maskedName, tier: p.tier, adt: p.adt, behaviorTags: p.tags, riskFlags: p.i % 7 === 1 ? ["ResponsiblePlayReview"] : [], preferredGames: [p.game] };
    const t = tables.find((x) => x.tableId === p.tableId);
    const condition = [{ type: r.type, evidence: { conditionType: r.type, rounds: r.rounds, threshold: r.threshold, consecutiveRounds: r.rounds, minBet: Math.round(p.bet * 0.3), bets: [{ round: 1, amount: Math.round(p.bet * 0.32) }, { round: 2, amount: Math.round(p.bet * 0.36) }, { round: 3, amount: Math.round(p.bet * 0.40) }] } }];
    lines.push(`INSERT INTO dbo.ops_patron_alerts VALUES (${msStr(`ALERT-${p.playerId}-001`)}, ${msStr(r.id)}, ${msStr(r.name)}, ${msStr(p.playerId)}, ${msStr(p.guestId)}, ${msStr(p.tableId)}, ${msJson(condition)}, ${msJson(snapshot)}, ${msJson({ tableName: t.tableName, gameType: t.game, zone: t.zone })}, ${msStr(i % 5 === 0 ? "Closed" : "New")}, ${msTs(i, 20, 30)}, ${msStr("AI detected a governed care or risk signal. Review recommended before customer touch.")});`);
  });
  fs.writeFileSync(path.join(outDir, "mssql_casino_ops_full_seed_15plus.sql"), lines.join("\n") + "\n");
}

function writePostgres() {
  const lines = [];
  lines.push(`-- PostgreSQL Loyalty/CRM/AI source full seed, 15+ rows per table`);
  lines.push(`-- Execute in DBeaver connection: postgres / schema casino_loyalty`);
  lines.push(`CREATE SCHEMA IF NOT EXISTS casino_loyalty;`);
  lines.push(`SET search_path TO casino_loyalty;`);
  lines.push(`CREATE TABLE crm_identity_links (master_player_id TEXT PRIMARY KEY, gaming_player_id TEXT, hotel_guest_id TEXT, pos_member_no TEXT, crm_customer_id TEXT, casino_card_no TEXT, passport_hash TEXT, mobile_hash TEXT, identity_confidence NUMERIC(5,2), identity_status TEXT, updated_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE crm_patron_profiles (customer_id TEXT PRIMARY KEY, master_player_id TEXT, name TEXT, masked_name TEXT, tier TEXT, region TEXT, adt NUMERIC(18,2), points_balance INT, preferred_games TEXT[], preferred_benefits TEXT[], risk_flags TEXT[], preference_embedding NUMERIC[], last_active_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE crm_offer_responses (response_id TEXT PRIMARY KEY, customer_id TEXT, offer_category TEXT, channel TEXT, outcome TEXT, responded_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE pos_fnb_checks (check_id TEXT PRIMARY KEY, member_no TEXT, outlet_name TEXT, category TEXT, amount_hkd NUMERIC(18,2), preference_tag TEXT, check_time TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE app_activity_events (event_id TEXT PRIMARY KEY, customer_id TEXT, activity_type TEXT, source TEXT, amount NUMERIC(18,2), points_delta INT, metadata JSONB, activity_embedding NUMERIC[], event_time TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE offer_catalog (offer_id TEXT PRIMARY KEY, title TEXT, description TEXT, offer_type TEXT, estimated_cost NUMERIC(18,2), target_game_types TEXT[], eligibility_rules JSONB, priority INT, status TEXT, offer_embedding NUMERIC[], created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE campaign_contact_history (contact_id TEXT PRIMARY KEY, customer_id TEXT, campaign_name TEXT, channel TEXT, outcome TEXT, contacted_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE marketing_campaign_runs (campaign_id TEXT PRIMARY KEY, name TEXT, goal TEXT, segment_criteria JSONB, included_offer_ids TEXT[], target_patron_ids TEXT[], metrics JSONB, status TEXT, start_at TIMESTAMPTZ, end_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE patron_interaction_history_src (interaction_id TEXT PRIMARY KEY, customer_id TEXT, type TEXT, detail JSONB, total_value_hkd NUMERIC(18,2), patron_tier_at_time TEXT, patron_adt_at_time NUMERIC(18,2), interaction_embedding NUMERIC[], recorded_by TEXT, occurred_at TIMESTAMPTZ, recorded_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE ai_chat_sessions_src (chat_session_id TEXT PRIMARY KEY, channel TEXT, marketing_user_id TEXT, patron_context_ids TEXT[], state TEXT, started_at TIMESTAMPTZ, last_message_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE ai_chat_messages_src (message_id TEXT PRIMARY KEY, chat_session_id TEXT, role TEXT, content TEXT, model TEXT, agent_name TEXT, references_json JSONB, created_at TIMESTAMPTZ);`);
  lines.push(`CREATE TABLE ai_patron_analysis_reports_src (report_id TEXT PRIMARY KEY, patron_id TEXT, profile_summary JSONB, behavior_pattern JSONB, risk_assessment JSONB, interaction_history JSONB, recommendations JSONB, suggested_pr_id TEXT, suggested_pr_name TEXT, triggered_by_alert_id TEXT, model_used TEXT, generated_at TIMESTAMPTZ, status TEXT);`);
  lines.push(`CREATE TABLE ai_offer_recommendations_src (recommendation_id TEXT PRIMARY KEY, patron_id TEXT, offer_id TEXT, confidence NUMERIC(5,2), relevance_score NUMERIC(5,2), reason_summary TEXT, next_best_action TEXT, generated_by TEXT, generated_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, status TEXT);`);
  lines.push(`CREATE TABLE ai_offer_approval_audit_src (audit_id TEXT PRIMARY KEY, offer_id TEXT, actor_id TEXT, decision TEXT, from_status TEXT, to_status TEXT, rationale TEXT, decided_at TIMESTAMPTZ);`);
  patrons.forEach((p) => lines.push(`INSERT INTO crm_identity_links VALUES (${pgStr(p.patronId)}, ${pgStr(p.playerId)}, ${pgStr(p.guestId)}, ${pgStr(p.memberNo)}, ${pgStr(p.customerId)}, ${pgStr(p.cardNo)}, ${pgStr(p.passportHash)}, ${pgStr(p.mobileHash)}, ${(0.90 + (p.i % 9) * 0.01).toFixed(2)}, 'VERIFIED', ${pgTs(p.i, 20, 0)});`));
  patrons.forEach((p) => lines.push(`INSERT INTO crm_patron_profiles VALUES (${pgStr(p.customerId)}, ${pgStr(p.patronId)}, ${pgStr(p.fullName)}, ${pgStr(p.maskedName)}, ${pgStr(p.tier)}, ${pgStr(p.region)}, ${p.adt}, ${p.points}, ${pgArray([p.game])}, ${pgArray(p.benefits)}, ${pgArray(p.i % 7 === 1 ? ["ResponsiblePlayReview"] : p.tags.includes("OfferFatigue") ? ["OfferFatigue"] : [])}, ARRAY[${[0.11 + p.i / 100, 0.22, 0.33].map((n) => n.toFixed(3)).join(",")}], ${pgTs(p.i, 20, 0)}, ${pgTs(p.i, 10, 0)}, ${pgTs(p.i, 20, 5)});`));
  patrons.forEach((p) => lines.push(`INSERT INTO crm_offer_responses VALUES (${pgStr(`OR-${p.customerId}-001`)}, ${pgStr(p.customerId)}, ${pgStr(["Hotel", "Dining", "Cashback", "Show", "HostCare"][p.i % 5])}, ${pgStr(["WhatsApp", "SMS", "AppPush"][p.i % 3])}, ${pgStr(p.i % 4 === 0 ? "Accepted" : p.i % 4 === 1 ? "Ignored" : "Viewed")}, ${pgTs(p.i, 18, 0)});`));
  patrons.forEach((p) => lines.push(`INSERT INTO pos_fnb_checks VALUES (${pgStr(`FNB-${p.playerId}-001`)}, ${pgStr(p.memberNo)}, ${pgStr(["Robuchon Macau", "Pearl Dragon", "VIP Lounge", "Noodle Bar", "Crystal Jade"][p.i % 5])}, ${pgStr(["FineDining", "ChineseDining", "Lounge", "CasualDining"][p.i % 4])}, ${(280 + p.i * 185).toFixed(2)}, ${pgStr(["FineDiningInterest", "Dining", "HostCare", "CasualDining"][p.i % 4])}, ${pgTs(p.i, 19, 0)});`));
  patrons.forEach((p) => lines.push(`INSERT INTO app_activity_events VALUES (${pgStr(`APP-${p.customerId}-001`)}, ${pgStr(p.customerId)}, ${pgStr(["APP_VIEW", "APP_DISMISS", "APP_CLICK"][p.i % 3])}, ${pgStr("mobile_app")}, ${p.i % 3 === 0 ? 0 : (100 + p.i * 20)}, ${p.i % 4 === 0 ? 200 : 0}, ${pgJson({ channel: "AppPush", isVip: ["Diamond", "Platinum"].includes(p.tier), venue: ["Suite Upgrade", "Premium Dining", "Cashback Offer", "VIP Host Service"][p.i % 4] })}, ARRAY[${[0.21, 0.32 + p.i / 100, 0.43].map((n) => n.toFixed(3)).join(",")}], ${pgTs(p.i, 19, 20)});`));
  offers.forEach((o, i) => lines.push(`INSERT INTO offer_catalog VALUES (${pgStr(o[0])}, ${pgStr(o[1])}, ${pgStr(`${o[1]} for governed casino loyalty demo`)}, ${pgStr(o[2])}, ${o[3]}, ${pgArray(o[4])}, ${pgJson({ eligibleTiers: o[5], blockedWhenActiveRisk: true, requiresApproval: i % 3 === 0, validHours: 2 + (i % 6) })}, ${o[6]}, 'Active', ARRAY[${[0.15 + i / 100, 0.25, 0.35].map((n) => n.toFixed(3)).join(",")}], ${pgTs(i, 12, 0)}, ${pgTs(i, 20, 0)});`));
  patrons.forEach((p) => lines.push(`INSERT INTO campaign_contact_history VALUES (${pgStr(`CH-${p.customerId}-001`)}, ${pgStr(p.customerId)}, ${pgStr(["Diamond Return Care", "Dining Coupon", "Points Booster", "Risk Suppression", "Host Care"][p.i % 5])}, ${pgStr(["WhatsApp", "SMS", "AppPush"][p.i % 3])}, ${pgStr(p.i % 5 === 0 ? "Accepted" : p.i % 5 === 1 ? "Ignored" : "Sent")}, ${pgTs(p.i, 18, 30)});`));
  Array.from({ length: 15 }, (_, i) => lines.push(`INSERT INTO marketing_campaign_runs VALUES (${pgStr(`CR-20260824-${String(i + 1).padStart(3, "0")}`)}, ${pgStr(["Diamond Return Care", "Risk Suppression Guardrail", "Offer Fatigue Suppression", "Weekend Dining", "Host SLA Recovery"][i % 5])}, ${pgStr("Increase governed customer care conversion")}, ${pgJson({ tier: tiers[i % tiers.length], activeSession: i % 2 === 0, noActiveRisk: i % 3 !== 0 })}, ${pgArray([offers[i % offers.length][0], offers[(i + 1) % offers.length][0]])}, ${pgArray(patrons.slice(i % 5, (i % 5) + 5).map((p) => p.patronId))}, ${pgJson({ sent: 10 + i, accepted: i % 6, redemptionValue: 1200 + i * 180 })}, ${pgStr(i % 4 === 0 ? "Completed" : "Running")}, ${pgTs(i, 10, 0)}, ${i % 4 === 0 ? pgTs(i, 12, 0) : "NULL"});`));
  patrons.forEach((p) => lines.push(`INSERT INTO patron_interaction_history_src VALUES (${pgStr(`INT-${p.customerId}-001`)}, ${pgStr(p.customerId)}, ${pgStr(["HOST_CALL", "APP_REQUEST", "RISK_REVIEW", "OFFER_RESPONSE"][p.i % 4])}, ${pgJson({ transferType: p.i % 2 === 0 ? "HotelCare" : "Marketing", vehicleClass: p.i % 3 === 0 ? "LuxuryVan" : "Sedan", venue: "Macau" })}, ${(500 + p.i * 220).toFixed(2)}, ${pgStr(p.tier)}, ${p.adt}, ARRAY[${[0.18, 0.28 + p.i / 100, 0.38].map((n) => n.toFixed(3)).join(",")}], ${pgStr(p.hostId)}, ${pgTs(p.i, 19, 40)}, ${pgTs(p.i, 20, 0)});`));
  Array.from({ length: 15 }, (_, i) => { const p = patrons[i]; lines.push(`INSERT INTO ai_chat_sessions_src VALUES (${pgStr(`CHAT-S-${String(i + 1).padStart(3, "0")}`)}, 'AI_PANEL', ${pgStr(`HOST-${i + 1}`)}, ${pgArray([p.patronId])}, 'Open', ${pgTs(i, 20, 10)}, ${pgTs(i, 20, 15)});`); });
  Array.from({ length: 30 }, (_, i) => { const p = patrons[i % patrons.length]; const sid = `CHAT-S-${String((i % 15) + 1).padStart(3, "0")}`; lines.push(`INSERT INTO ai_chat_messages_src VALUES (${pgStr(`CHAT-M-${String(i + 1).padStart(3, "0")}`)}, ${pgStr(sid)}, ${pgStr(i % 2 === 0 ? "user" : "assistant")}, ${pgStr(i % 2 === 0 ? `请分析 ${p.patronId} 当前是否适合推荐。` : `${p.patronId} 当前信号已结合实时 Session、风险和活动记录生成建议。`)}, 'gpt-5.4-mini', 'loyalty_strategist_agent', ${pgJson([{ collection: "patron_realtime_decision_signals", patronId: p.patronId }])}, ${pgTs(i, 20, 20)});`); });
  patrons.forEach((p) => lines.push(`INSERT INTO ai_patron_analysis_reports_src VALUES (${pgStr(`RPT-${p.patronId}-001`)}, ${pgStr(p.patronId)}, ${pgJson({ tier: p.tier, region: p.region, adt: p.adt })}, ${pgJson({ tags: p.tags, preferredGames: [p.game] })}, ${pgJson({ riskLevel: p.i % 7 === 1 ? "High" : "Normal", reasons: p.i % 7 === 1 ? ["ResponsiblePlayReview"] : [] })}, ${pgJson([{ type: "APP_VIEW", at: "2026-08-24T20:00:00+08:00" }])}, ${pgJson([{ title: p.i % 7 === 1 ? "Block offer" : "Next best care", actionType: p.i % 7 === 1 ? "RISK_ESCALATION" : "VIP_CARE_OFFER", priority: p.i % 5, urgency: p.i % 3, estimatedValue: p.bet, rationale: "Generated from TapData target API schema" }])}, ${pgStr(p.hostId)}, ${pgStr(hosts.find((h) => h[0] === p.hostId)?.[1] || "Host")}, ${pgStr(`ALERT-${p.playerId}-001`)}, 'gpt-5.4-mini', ${pgTs(p.i, 20, 35)}, 'Ready');`));
  patrons.forEach((p, i) => lines.push(`INSERT INTO ai_offer_recommendations_src VALUES (${pgStr(`REC-${p.patronId}-001`)}, ${pgStr(p.patronId)}, ${p.i % 7 === 1 ? "NULL" : pgStr(offers[i % offers.length][0])}, ${(0.62 + (i % 8) * 0.04).toFixed(2)}, ${(0.58 + (i % 9) * 0.04).toFixed(2)}, ${pgStr(p.i % 7 === 1 ? "Active risk blocks incentive offer" : "Matched tier, game preference, current session and recent intent")}, ${pgStr(p.i % 7 === 1 ? "拦截优惠，通知风险管理员" : offers[i % offers.length][1])}, ${pgStr(p.i % 7 === 1 ? "GovernanceRule" : "TapDataAggregate+AI")}, ${pgTs(i, 20, 40)}, ${pgTs(i, 22, 40)}, ${pgStr(p.i % 7 === 1 ? "Blocked" : "Proposed")});`));
  patrons.forEach((p, i) => lines.push(`INSERT INTO ai_offer_approval_audit_src VALUES (${pgStr(`AUD-${p.patronId}-001`)}, ${p.i % 7 === 1 ? "NULL" : pgStr(offers[i % offers.length][0])}, ${pgStr(i % 5 === 0 ? "ADM-01" : "AI")}, ${pgStr(p.i % 7 === 1 ? "Blocked" : "Generated")}, ${pgStr("Draft")}, ${pgStr(p.i % 7 === 1 ? "BlockedByGovernance" : "PendingApproval")}, ${pgStr(p.i % 7 === 1 ? "Active risk case blocks recommendation" : "Generated for approval workflow")}, ${pgTs(i, 20, 50)});`));
  fs.writeFileSync(path.join(outDir, "postgres_casino_loyalty_full_seed_15plus.sql"), lines.join("\n") + "\n");
}

function writeReadme() {
  const md = `# Full 15+ Source Seed Package

这套脚本是基于真实 TapData API 目标表字段校验后重新生成的三源端初始化脚本。

每个源端表至少 15 条数据，适合在 DBeaver 里对空库/空 schema 初始化。

## 文件

| 文件 | 执行位置 |
|---|---|
| \`oracle_c##gaming_full_seed_15plus.sql\` | Oracle 连接 \`orcl\`，Schema \`C##GAMING\` |
| \`mssql_casino_ops_full_seed_15plus.sql\` | SQL Server 数据库 \`casino_ops\`，Schema \`dbo\` |
| \`postgres_casino_loyalty_full_seed_15plus.sql\` | PostgreSQL 数据库 \`postgres\`，Schema \`casino_loyalty\` |

## 重要说明

1. 这些脚本默认目标库里没有同名表。
2. 如果已经建过同名表，请先确认是否要删除旧表，避免 CREATE TABLE 报错。
3. TapData 目标端真实 API 字段以 \`TapData真实目标Schema校验报告.md\` 为准。
4. 重点修正：
   - \`table_round_history\` 源端使用 Oracle \`GAMING_PLAYER_ROUND_BETS\`，对应真实目标的客户每轮下注记录。
   - \`patron_alerts\` 源端使用 MSSQL \`ops_patron_alerts\`，包含 triggeredConditions / patronSnapshot / tableSnapshot / llmRationale。
   - \`patron_realtime_decision_signals\` 应输出 Session 主体 + interactions[] + recentActivities[] + offerRecommendations[]。

## DBeaver 执行顺序

1. Oracle 执行 \`oracle_c##gaming_full_seed_15plus.sql\`
2. MSSQL 执行 \`mssql_casino_ops_full_seed_15plus.sql\`
3. PostgreSQL 执行 \`postgres_casino_loyalty_full_seed_15plus.sql\`
4. 在 TapData 新建/刷新 CDC 与 Join 任务
5. 发布目标 MongoDB 表 API
6. 回 AI 面板验证
`;
  fs.writeFileSync(path.join(outDir, "README.md"), md);
}

writeOracle();
writeMssql();
writePostgres();
writeReadme();

console.log(outDir);
