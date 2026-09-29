const DEFAULT_EXACT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BURST_TTL_MS = 10000;
const DEFAULT_MAX_ENTRIES = 250;

const normalize = (value) => String(value ?? "").trim().toLowerCase();

const read = (payload, ...names) => {
  for (const name of names) {
    if (payload?.[name] !== undefined && payload?.[name] !== null) return payload[name];
  }
  return "";
};

export const getAcademicEventKeys = (payload = {}) => {
  const eventId = normalize(read(payload, "EventId", "eventId", "TransactionId", "transactionId"));
  const entityId = normalize(read(
    payload,
    "EntityId", "entityId", "RecordId", "recordId", "SectionId", "sectionId", "FacultySectionId", "facultySectionId"
  ));
  const reason = normalize(read(payload, "Reason", "reason"));
  const department = normalize(read(payload, "Department", "department"));
  const actor = normalize(read(payload, "Actor", "actor"));
  const changedAt = normalize(read(payload, "ChangedAt", "changedAt", "OccurredAt", "occurredAt"));

  if (eventId) return { exact: `id|${eventId}`, burst: `id|${eventId}` };

  const stable = `${reason}|${entityId}|${department}|${actor}`;
  return {
    exact: `event|${stable}|${changedAt}`,
    burst: `burst|${stable}`,
  };
};

const prune = (cache, currentTime, maxEntries) => {
  for (const [key, expiresAt] of cache) {
    if (expiresAt <= currentTime) cache.delete(key);
  }
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
};

export const createAcademicEventGuard = ({
  exactTtlMs = DEFAULT_EXACT_TTL_MS,
  burstTtlMs = DEFAULT_BURST_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = () => Date.now(),
} = {}) => {
  const exactEvents = new Map();
  const burstEvents = new Map();

  return (payload) => {
    const currentTime = now();
    prune(exactEvents, currentTime, maxEntries);
    prune(burstEvents, currentTime, maxEntries);

    const { exact, burst } = getAcademicEventKeys(payload);
    if (exactEvents.has(exact) || burstEvents.has(burst)) return false;

    exactEvents.set(exact, currentTime + exactTtlMs);
    burstEvents.set(burst, currentTime + burstTtlMs);
    prune(exactEvents, currentTime, maxEntries);
    prune(burstEvents, currentTime, maxEntries);
    return true;
  };
};
