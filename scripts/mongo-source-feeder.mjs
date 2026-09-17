import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SOURCE_DATABASE = 'tapdata_casino_marketing';
export function feederConfig(env = process.env) {
  const integer = (name, fallback, min, max) => {
    if (!env[name]) return fallback;
    const n = Number(env[name]);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
    return n;
  };
  if (env.SOURCE_MONGO_DB && env.SOURCE_MONGO_DB !== SOURCE_DATABASE) throw new Error('Source database must be tapdata_casino_marketing');
  return {
    database: SOURCE_DATABASE,
    writeEnabled: env.FEEDER_WRITE_ENABLED === 'true',
    intervalMs: integer('FEEDER_INTERVAL_MS', 15000, 1000, 3600000),
    updates: integer('FEEDER_SESSION_UPDATES_PER_TICK', 1, 1, 25),
    increment: integer('FEEDER_BET_INCREMENT', 500, 1, 10000),
    durationHours: integer('FEEDER_DURATION_HOURS', 0, 0, 8760),
  };
}

export function buildChanges(session, profile, increment, stamp) {
  for (const value of [session.sessionBetAmount, session.currentStackEstimate, profile.adt, profile.pointsBalance]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Source numeric fields are invalid');
  }
  const adtIncrement = Math.round(increment * 0.25);
  const pointsIncrement = Math.round(increment * 1.5);
  return {
    session: {
      $inc: { sessionBetAmount: increment, currentStackEstimate: Math.round(increment / 2) },
      $set: { previousBetAmount: session.sessionBetAmount, lastActionAt: stamp, updatedAt: stamp },
    },
    profile: {
      $inc: { adt: adtIncrement, pointsBalance: pointsIncrement },
      $set: { lastActiveAt: stamp, updatedAt: stamp },
    },
    snapshot: { $set: {
      'patronSnapshot.adt': profile.adt + adtIncrement,
      'patronSnapshot.pointsBalance': profile.pointsBalance + pointsIncrement,
      'patronSnapshot.updatedAt': stamp,
      'patronSnapshot.lastActiveAt': stamp,
    } },
  };
}

export async function runTick(client, config) {
  if (!config.writeEnabled) throw new Error('Writes are disabled; explicit FEEDER_WRITE_ENABLED=true is required after approval');
  const { Double } = await import('mongodb');
  const db = client.db(SOURCE_DATABASE);
  const sessions = db.collection('patron_table_sessions');
  const profiles = db.collection('patron_profiles');
  const candidates = await sessions.aggregate([
    { $match: { isActive: 1, playerId: { $type: 'string' } } },
    { $sample: { size: config.updates } },
    { $project: { _id: 1 } },
  ]).toArray();
  let updated = 0;
  for (const candidate of candidates) {
    const transaction = client.startSession();
    try {
      const changed = await transaction.withTransaction(async () => {
        const session = await sessions.findOne({ _id: candidate._id, isActive: 1 }, { session: transaction });
        if (!session) return false;
        const matches = await profiles.find({ playerId: session.playerId }, { session: transaction }).limit(2).toArray();
        if (matches.length !== 1) throw new Error('Source session must have exactly one matching profile');
        const profile = matches[0];
        const changes = buildChanges(session, profile, config.increment, new Date());
        changes.session.$set.previousBetAmount = new Double(changes.session.$set.previousBetAmount);
        changes.snapshot.$set['patronSnapshot.adt'] = new Double(changes.snapshot.$set['patronSnapshot.adt']);
        await sessions.updateOne({ _id: session._id }, changes.session, { session: transaction });
        await profiles.updateOne({ _id: profile._id }, changes.profile, { session: transaction });
        await sessions.updateMany({ playerId: session.playerId, patronSnapshot: { $type: 'object' } }, changes.snapshot, { session: transaction });
        return true;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      if (changed) updated++;
    } finally { await transaction.endSession(); }
  }
  return { updated, database: SOURCE_DATABASE };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some(arg => !['--once', '--dry-run'].includes(arg))) throw new Error('Unknown feeder option');
  const config = feederConfig();
  if (args.has('--dry-run')) {
    console.log(JSON.stringify({ ...config, mode: 'offline-plan', collections: ['patron_profiles', 'patron_table_sessions'], createsCustomers: false, changesActiveStatus: false }));
    return;
  }
  if (!config.writeEnabled) throw new Error('Writes are disabled; obtain approval before setting FEEDER_WRITE_ENABLED=true');
  const uri = process.env.SOURCE_MONGO_URI;
  if (!uri) throw new Error('SOURCE_MONGO_URI is required');
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
  let stopped = false;
  let wake;
  const stop = () => { stopped = true; wake?.(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const deadline = config.durationHours ? Date.now() + config.durationHours * 3600000 : Infinity;
  try {
    await client.connect();
    do {
      if (stopped) break;
      console.log(JSON.stringify(await runTick(client, config)));
      if (args.has('--once') || Date.now() >= deadline || stopped) break;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, Math.min(config.intervalMs, Math.max(0, deadline - Date.now())));
        wake = () => { clearTimeout(timer); resolve(); };
      });
    } while (!stopped && Date.now() < deadline);
  } finally { await client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(() => { console.error('[feeder] stopped: verify write approval, source configuration, replica set and schema; no credential details are logged'); process.exitCode = 1; });
}
