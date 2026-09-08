export const LIVE_PATRONS_CACHE_KEY = "mogo-live-patrons-snapshot-v1";
const MAX_SNAPSHOT_AGE_MS = 10 * 60 * 1000;

type CachedSnapshot<T, C> = {
  data: T[];
  sourceCounts?: C | null;
  fetchedAt?: string;
  savedAt: number;
};

export function readLivePatronSnapshot<T, C>() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LIVE_PATRONS_CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as CachedSnapshot<T, C>;
    if (!Array.isArray(snapshot.data) || !snapshot.data.length || !Number.isFinite(snapshot.savedAt)) return null;
    if (Date.now() - snapshot.savedAt > MAX_SNAPSHOT_AGE_MS) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function writeLivePatronSnapshot<T, C>(data: T[], sourceCounts?: C | null, fetchedAt?: string) {
  if (typeof window === "undefined" || !data.length) return;
  try {
    window.localStorage.setItem(LIVE_PATRONS_CACHE_KEY, JSON.stringify({ data, sourceCounts: sourceCounts || null, fetchedAt, savedAt: Date.now() }));
  } catch {
    // A full snapshot is an optional perceived-performance optimization.
  }
}
