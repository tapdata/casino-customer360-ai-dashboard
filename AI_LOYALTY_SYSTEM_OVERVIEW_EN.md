# AI Loyalty Engine — System Overview

## 1. Purpose

AI Loyalty Engine is a casino customer intelligence and operations workspace. It connects live customer activity, table sessions, loyalty value, risk signals, and offers into one governed decision flow.

The system is designed to answer four operational questions:

1. What is happening on the casino floor right now?
2. Which customers need attention, and why?
3. What is the next best action for a customer or table?
4. Can the action be safely approved, delivered, and audited?

The product is an AI-assisted decision system. It helps operators understand evidence and prepare actions; it does not replace human approval for governed customer outreach.

## 2. End-to-end data story

```text
Source systems / MongoDB
          ↓
TapData CDC, merge, cleansing and aggregation
          ↓
TapData Enterprise MDM
          ↓
Published TapData APIs
          ↓
Server-side AI Loyalty Engine routes
          ↓
Operations panel, AI Chat, approval and audit
```

The browser does not connect directly to MongoDB or business databases. The Next.js server reads approved TapData APIs, keeps credentials on the server, and returns only the data needed by the panel.

## 3. Main user experience

### Live Operations Overview

The overview shows the current operating picture:

- active tables and table occupancy;
- active patrons and current sessions;
- risk patrons and unresolved risk cases;
- table turnover and high-pressure areas;
- AI-generated operational priorities.

### Table Heatmap

The table heatmap aggregates live sessions into a casino-floor view. Operators can inspect:

- table, zone and game type;
- occupancy and capacity;
- current session wager;
- VIP presence;
- risk signals and operating state;
- nearby opportunities or anomalies.

Each table can open an AI analysis focused on capacity, service resources, risk and the next 30 minutes.

### Customer 360

Customer 360 combines the customer profile with live behavior:

- loyalty tier and ADT;
- region and preferred games;
- points balance and recent activity;
- current table session;
- session wager and stack estimate;
- behavior tags;
- active risk cases;
- recommendation and host context.

The view helps a host move from a raw signal to a customer-specific conversation.

### AI Chat

AI Chat accepts business questions such as:

```text
Is TEST-S2-P1 currently suitable for a hotel offer?
Analyze table T-0014 and identify the main operating risks.
Summarize the unresolved high-risk cases and the required owners.
```

The AI follows a controlled server-side workflow:

1. Identify the user’s intent;
2. Select an approved read-only tool;
3. Query the relevant published TapData API;
4. Filter and limit the returned evidence;
5. Separate data facts, rule conclusions, AI inference, and next actions;
6. Cite the source collections used in the response.

The model is not given MongoDB credentials and cannot issue arbitrary database queries.

### Scenario Studio

Scenario Studio provides reusable stories for demonstrations and training:

- VIP return and host follow-up;
- table pressure and capacity opportunity;
- risk escalation and responsible-play review;
- offer fatigue or missing-benefit opportunity;
- data-quality anomaly and recommendation quarantine.

Each scenario describes the source change, the TapData checkpoint, the aggregate signal, the AI question, and the governed action.

### Data Simulator

The Data Simulator creates a local browser-only session. It is useful for rehearsing a presentation without writing to MongoDB. The automatic source feeder is different: it writes approved updates to the MongoDB source so that TapData CDC can carry them through the real pipeline.

## 4. AI and governance model

The system separates evidence, business rules, AI reasoning and delivery:

```text
Evidence → Rules → AI explanation → Governance → Approval → Delivery record
```

Examples of governed behavior:

- An active risk case blocks gaming incentives and routes the case to an administrator;
- A missing customer profile requires host verification before a high-cost offer;
- A healthy customer can receive a recommendation, but a supervisor approval is still required before delivery;
- A data-quality anomaly is quarantined so it does not drive an incorrect recommendation.

The demo records approval, rejection, send and risk-alert actions in the audit flow. An actual production messaging connector can be attached to the final delivery step.

## 5. Data foundation

The main published collections used by the panel include:

| Collection | Role |
| --- | --- |
| `patron_profiles` | Customer identity, tier, region, ADT, preferences and points |
| `patron_table_sessions` | Current table, active state, wager, stack and behavior tags |
| `patron_risk_cases` | Responsible-play and operational risk cases |
| `patron_realtime_decision_signals` | TapData aggregate signals for fast AI decisions |
| `offer_recommendations` | Candidate offers, confidence, rationale and status |
| `offer_catalog` | Available benefits and offer definitions |
| `table_state_snapshots` | Current table status, capacity and occupancy |
| `patron_interaction_history` | Prior host and customer interactions |
| `ai_chat_sessions` / `ai_chat_messages` | AI conversation evidence and history |

The external demo restores 23 anonymized MongoDB collections into `tapdata_casino_marketing`. The TapData Enterprise environment supplies the existing `MDM` connection and publishes the API layer.

## 6. Real-time demonstration flow

The current source feeder updates one existing active customer approximately every 15 seconds. It changes session amount, stack estimate, ADT, points and timestamps without creating new customers or deleting collections.

The resulting flow is:

```text
MongoDB source update
  → TapData CDC task
  → MDM record update
  → published API refresh
  → panel snapshot refresh
  → AI explanation or recommendation
```

The panel keeps a last complete snapshot so that a temporary TapData delay does not blank the dashboard. A response marked `x-patrons-cache: stale` means the visible data is the last known complete snapshot and is not a fresh upstream response.

## 7. Demonstration decision model

The one-minute VIP upgrade story uses current-session cumulative wager to make a visible progression. It is a presentation rule, not a production loyalty policy:

| Starting tier | Current-session wager | Demonstration result |
| --- | --- | --- |
| Bronze / Silver | below HKD 300,000 | Keep tier and provide light-touch service |
| Bronze / Silver | at least HKD 300,000 | Gold review and approved hotel benefit |
| Gold / Platinum | at least HKD 700,000 | Next approved benefit set |
| Any tier | at least HKD 1,200,000 | Diamond eligibility review |

`sessionBetAmount` is the cumulative wager for the current table session. It is not lifetime wagering. A production policy should combine rolling turnover, ADT, visit frequency, responsible-play controls and approval rules.

## 8. Security and operating boundaries

- TapData, MongoDB and AI credentials remain server-side;
- the browser receives panel data, not database credentials;
- AI tools are allowlisted and read-only;
- customer identity in the demo is anonymized;
- source restore refuses to overwrite a non-empty database;
- existing same-name TapData tasks/APIs are reused instead of duplicated;
- risk signals can block incentives and require administrator review;
- `.env.local`, `.env.external`, private exports, runtime state and secrets must not be committed to Git.

The demo seed and templates are public project assets; production customer data, credentials and licenses must be provided separately through an approved secure channel.

## 9. Deployment summary

For a colleague with an existing TapData Enterprise environment:

```bash
git clone -b codex/docker-demo-kit \
  https://github.com/tapdata/casino-customer360-ai-dashboard.git
cd casino-customer360-ai-dashboard
bash run-demo.sh
```

The first-run wizard asks for TapData credentials, MongoDB connection details, the AI key, the panel host and the panel port. Ordinary local defaults can be accepted with Enter. The deployment guide is available in [CUSTOMER_QUICKSTART_EN.md](CUSTOMER_QUICKSTART_EN.md).

## 10. What success looks like

A successful demo has all of the following:

1. The source MongoDB contains the anonymized demo collections;
2. TapData CDC is running and the MDM/API layer is populated;
3. The panel displays live or clearly identified cached customer data;
4. The source feeder produces visible updates;
5. AI Chat returns evidence-backed answers;
6. Risk and approval controls are visible before outreach;
7. Actions have an audit record.

