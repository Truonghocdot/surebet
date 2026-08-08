export const DEFAULT_MINIMUM_VISIBLE_MS = 20_000;

export type MinimumVisibleEntry<T extends { id: string }> = {
  item: T;
  firstVisibleAt: number;
};

export function reconcileMinimumVisibleItems<T extends { id: string }>(
  previous: readonly MinimumVisibleEntry<T>[],
  incoming: readonly T[],
  now: number,
  minimumVisibleMs = DEFAULT_MINIMUM_VISIBLE_MS
) {
  const incomingByID = new Map(incoming.map((item) => [item.id, item]));
  const previousIDs = new Set(previous.map((entry) => entry.item.id));
  const newEntries = incoming
    .filter((item) => !previousIDs.has(item.id))
    .map((item) => ({ item, firstVisibleAt: now }));
  const existingEntries = previous.flatMap((entry) => {
    const current = incomingByID.get(entry.item.id);
    if (current) {
      return [{ ...entry, item: current }];
    }
    return now - entry.firstVisibleAt < minimumVisibleMs ? [entry] : [];
  });

  return [...newEntries, ...existingEntries];
}

export function nextMinimumVisibleExpiry<T extends { id: string }>(
  entries: readonly MinimumVisibleEntry<T>[],
  incoming: readonly T[],
  now: number,
  minimumVisibleMs = DEFAULT_MINIMUM_VISIBLE_MS
) {
  const incomingIDs = new Set(incoming.map((item) => item.id));
  let nextExpiry: number | null = null;

  for (const entry of entries) {
    if (incomingIDs.has(entry.item.id)) {
      continue;
    }
    const expiry = entry.firstVisibleAt + minimumVisibleMs;
    if (nextExpiry === null || expiry < nextExpiry) {
      nextExpiry = expiry;
    }
  }

  if (nextExpiry === null) {
    return null;
  }
  return nextExpiry > now ? nextExpiry : now;
}
