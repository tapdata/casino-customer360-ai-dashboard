export const demoPatrons = [
  { patronId: "TEST-S1-P1", maskedName: "T***AP", tier: "Gold", region: "International", adt: 8500, pointsBalance: 45000, preferredGames: ["Poker", "Baccarat"], riskFlags: ["HighVariance"], lastActiveAt: "2026-08-18T22:44:10.000Z", lastHotelBenefitAt: "2026-07-05T09:00:00.000Z" },
  { patronId: "TEST-S2-P1", maskedName: "T***GM", tier: "Platinum", region: "Guangdong", adt: 15200, pointsBalance: 72000, preferredGames: ["Baccarat", "Poker"], riskFlags: [], lastActiveAt: "2026-08-18T22:47:08.000Z", lastHotelBenefitAt: "2026-06-21T12:00:00.000Z" },
  { patronId: "TEST-S3-P1", maskedName: "T***DT", tier: "Bronze", region: "Taiwan", adt: 3000, pointsBalance: 5000, preferredGames: ["Blackjack"], riskFlags: ["HighVariance"], lastActiveAt: "2026-08-18T22:39:16.000Z", lastHotelBenefitAt: null },
  { patronId: "P-000053", maskedName: "L***53", tier: "Silver", region: "Taiwan", adt: 22976, pointsBalance: 114899, preferredGames: ["Roulette", "Baccarat"], riskFlags: [], lastActiveAt: "2026-08-18T22:46:03.000Z", lastHotelBenefitAt: "2026-08-09T11:00:00.000Z" },
  { patronId: "P-000212", maskedName: "C***12", tier: "Diamond", region: "Guangdong", adt: 17426, pointsBalance: 84344, preferredGames: ["Roulette", "Poker"], riskFlags: ["PromoSensitive"], lastActiveAt: "2026-08-18T22:45:22.000Z", lastHotelBenefitAt: "2026-05-12T15:00:00.000Z" },
  { patronId: "P-000104", maskedName: "M***04", tier: "Platinum", region: "Macau", adt: 24079, pointsBalance: 90114, preferredGames: ["Baccarat"], riskFlags: [], lastActiveAt: "2026-08-18T22:43:58.000Z", lastHotelBenefitAt: null },
  { patronId: "P-000088", maskedName: "H***88", tier: "Diamond", region: "HongKong", adt: 28398, pointsBalance: 102400, preferredGames: ["Baccarat", "Poker"], riskFlags: [], lastActiveAt: "2026-08-18T22:42:11.000Z", lastHotelBenefitAt: "2026-04-18T12:00:00.000Z" },
  { patronId: "P-000124", maskedName: "A***24", tier: "Platinum", region: "OtherGBA", adt: 18455, pointsBalance: 67880, preferredGames: ["Blackjack", "Baccarat"], riskFlags: ["FrequentCashout"], lastActiveAt: "2026-08-18T22:38:42.000Z", lastHotelBenefitAt: "2026-07-30T12:00:00.000Z" },
];

export const demoSessions = [
  { patronId: "TEST-S1-P1", tableId: "T-0001", seatedAt: "2026-08-18T21:58:00.000Z", lastActionAt: "2026-08-18T22:44:10.000Z", sessionBetAmount: 5000, previousBetAmount: 3100, currentStackEstimate: 9513, behaviorTags: ["Aggressive", "HighVariance"], isActive: true },
  { patronId: "TEST-S2-P1", tableId: "T-0001", seatedAt: "2026-08-18T21:50:00.000Z", lastActionAt: "2026-08-18T22:47:08.000Z", sessionBetAmount: 23520, previousBetAmount: 14000, currentStackEstimate: 23546, behaviorTags: ["Conservative", "PromoSeeker"], isActive: true },
  { patronId: "TEST-S3-P1", tableId: "T-0012", seatedAt: "2026-08-18T22:02:00.000Z", lastActionAt: "2026-08-18T22:39:16.000Z", sessionBetAmount: 18000, previousBetAmount: 9200, currentStackEstimate: 40710, behaviorTags: ["Aggressive", "HighVariance"], isActive: true },
  { patronId: "P-000053", tableId: "T-0010", seatedAt: "2026-08-18T21:35:00.000Z", lastActionAt: "2026-08-18T22:46:03.000Z", sessionBetAmount: 31010, previousBetAmount: 27100, currentStackEstimate: 52329, behaviorTags: ["Conservative"], isActive: true },
  { patronId: "P-000212", tableId: "T-0010", seatedAt: "2026-08-18T21:47:00.000Z", lastActionAt: "2026-08-18T22:45:22.000Z", sessionBetAmount: 25064, previousBetAmount: 22140, currentStackEstimate: 28167, behaviorTags: ["PromoSeeker"], isActive: true },
  { patronId: "P-000104", tableId: "T-0026", seatedAt: "2026-08-18T22:05:00.000Z", lastActionAt: "2026-08-18T22:43:58.000Z", sessionBetAmount: 26500, previousBetAmount: 18720, currentStackEstimate: 55912, behaviorTags: ["Conservative"], isActive: true },
  { patronId: "P-000088", tableId: "T-0026", seatedAt: "2026-08-18T21:52:00.000Z", lastActionAt: "2026-08-18T22:42:11.000Z", sessionBetAmount: 34280, previousBetAmount: 28420, currentStackEstimate: 68100, behaviorTags: ["LateNight"], isActive: true },
  { patronId: "P-000124", tableId: "T-0012", seatedAt: "2026-08-18T21:45:00.000Z", lastActionAt: "2026-08-18T22:38:42.000Z", sessionBetAmount: 22120, previousBetAmount: 15200, currentStackEstimate: 33080, behaviorTags: ["FrequentCashout"], isActive: true },
];

export const demoTableStates = [
  { tableId: "T-0001", zone: "VIP", gameType: "Baccarat", patronCount: 7, capacity: 9, occupancyRate: 0.78, avgBetAmount: 18008, minBet: 1000, status: "Busy", refreshedAt: "2026-08-18T22:47:08.000Z" },
  { tableId: "T-0010", zone: "A", gameType: "Roulette", patronCount: 4, capacity: 9, occupancyRate: 0.44, avgBetAmount: 18087, minBet: 500, status: "Open", refreshedAt: "2026-08-18T22:46:59.000Z" },
  { tableId: "T-0012", zone: "C", gameType: "Blackjack", patronCount: 9, capacity: 9, occupancyRate: 1, avgBetAmount: 24860, minBet: 1000, status: "Busy", refreshedAt: "2026-08-18T22:46:48.000Z" },
  { tableId: "T-0014", zone: "B", gameType: "Blackjack", patronCount: 133, capacity: 9, occupancyRate: 1, avgBetAmount: 0, minBet: 500, status: "DataAnomaly", refreshedAt: "2026-08-18T22:46:31.000Z" },
  { tableId: "T-0018", zone: "VIP", gameType: "Poker", patronCount: 6, capacity: 9, occupancyRate: 0.67, avgBetAmount: 22640, minBet: 1000, status: "Open", refreshedAt: "2026-08-18T22:46:10.000Z" },
  { tableId: "T-0022", zone: "C", gameType: "Roulette", patronCount: 9, capacity: 9, occupancyRate: 1, avgBetAmount: 16720, minBet: 300, status: "Busy", refreshedAt: "2026-08-18T22:45:52.000Z" },
  { tableId: "T-0026", zone: "VIP", gameType: "Baccarat", patronCount: 7, capacity: 9, occupancyRate: 0.78, avgBetAmount: 26480, minBet: 300, status: "Opportunity", refreshedAt: "2026-08-18T22:45:39.000Z" },
  { tableId: "T-0030", zone: "B", gameType: "Blackjack", patronCount: 0, capacity: 9, occupancyRate: 0, avgBetAmount: 0, minBet: 300, status: "Closed", refreshedAt: "2026-08-18T22:44:58.000Z" },
];

export const demoOffers = [
  { offerId: "OFFER-0001", name: "Luxury Suite + Late Checkout", category: "Hotel", cost: 2400, status: "Active", eligibleTiers: ["Platinum", "Diamond"] },
  { offerId: "OFFER-0002", name: "Premium Dining Experience", category: "Dining", cost: 1200, status: "Active", eligibleTiers: ["Gold", "Platinum", "Diamond"] },
  { offerId: "OFFER-0003", name: "VIP Show Package", category: "Entertainment", cost: 2800, status: "Active", eligibleTiers: ["Platinum", "Diamond"] },
  { offerId: "OFFER-0004", name: "Cashback Benefit", category: "Cashback", cost: 5000, status: "Active", eligibleTiers: ["Diamond"] },
];

export const demoAlerts = [
  { alertId: "ALT-1001", patronId: "TEST-S3-P1", tableId: "T-0012", severity: "High", status: "AwaitingAdmin", signal: "Session wager reached 6× ADT with Aggressive and HighVariance tags.", createdAt: "2026-08-18T22:39:30.000Z" },
  { alertId: "ALT-1002", patronId: null, tableId: "T-0014", severity: "Critical", status: "Open", signal: "Patron count exceeds configured table capacity.", createdAt: "2026-08-18T22:41:12.000Z" },
  { alertId: "ALT-1003", patronId: "TEST-S2-P1", tableId: "T-0001", severity: "Medium", status: "InReview", signal: "Session behavior conflicts with the latest AI analysis report.", createdAt: "2026-08-18T22:43:06.000Z" },
  { alertId: "ALT-1004", patronId: "P-000124", tableId: "T-0012", severity: "High", status: "AwaitingAdmin", signal: "Frequent cashout behavior requires review before a cash-equivalent offer.", createdAt: "2026-08-18T22:44:20.000Z" },
];

export const demoInteractions = [
  { patronId: "TEST-S2-P1", channel: "HostCall", outcome: "NoAnswer", createdAt: "2026-07-06T14:20:00.000Z" },
  { patronId: "TEST-S1-P1", channel: "WhatsApp", outcome: "Read", createdAt: "2026-07-07T12:00:00.000Z" },
  { patronId: "P-000212", channel: "HostCall", outcome: "Accepted", createdAt: "2026-08-01T09:30:00.000Z" },
];
