export const USAGE_PERIODS = {
  month: "This month",
  "14days": "Last 14 days",
  "30days": "Last 30 days",
  previous: "Previous month",
  custom: "Custom dates",
};
export const newUsage = () => ({
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  revision: 0,
  events: [],
});
export function validateUsage(s) {
  if (
    !s ||
    s.schemaVersion !== 1 ||
    !Number.isFinite(Date.parse(s.startedAt)) ||
    !Number.isSafeInteger(s.revision) ||
    !Array.isArray(s.events) ||
    s.events.length > 150000
  )
    throw new Error("Usage history could not be read or is full.");
  const ids = new Set();
  for (const e of s.events) {
    if (
      !e ||
      typeof e.id !== "string" ||
      ids.has(e.id) ||
      !Number.isFinite(Date.parse(e.at)) ||
      !["chat", "module", "connection"].includes(e.kind) ||
      !["pending", "reported", "unknown"].includes(e.status)
    )
      throw new Error("Invalid usage record.");
    ids.add(e.id);
    if (e.status === "reported")
      for (const k of ["input", "output", "cacheRead", "cacheWrite"])
        if (!Number.isSafeInteger(e[k]) || e[k] < 0)
          throw new Error("Invalid token count.");
  }
  return s;
}
export function changeUsage(state, action) {
  const next = structuredClone(state);
  if (action.type === "begin") {
    if (next.events.some((e) => e.id === action.id)) return state;
    next.events.push({
      id: action.id,
      at: action.at,
      kind: action.kind,
      status: "pending",
    });
  } else if (action.type === "finish") {
    const event = next.events.find((e) => e.id === action.id);
    if (!event) throw new Error("Unknown usage request.");
    if (event.status === "reported") return state;
    const u = action.usage;
    if (u && Number.isSafeInteger(u.input) && Number.isSafeInteger(u.output)) {
      Object.assign(event, {
        status: "reported",
        input: u.input,
        output: u.output,
        cacheRead: u.cacheRead || 0,
        cacheWrite: u.cacheWrite || 0,
      });
    } else event.status = "unknown";
  } else if (action.type === "recover") {
    next.events.forEach((e) => {
      if (e.status === "pending") e.status = "unknown";
    });
  } else throw new Error("Unknown usage action.");
  next.revision++;
  return validateUsage(next);
}
function localDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [y, m, d] = value.split("-").map(Number),
    date = new Date(y, m - 1, d);
  return date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
    ? date
    : null;
}
export function usageRange(settings, now = new Date()) {
  let start,
    end = new Date(now);
  if (settings.usagePeriod === "month")
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (settings.usagePeriod === "previous") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (["14days", "30days"].includes(settings.usagePeriod)) {
    start = new Date(now);
    start.setDate(
      start.getDate() - (settings.usagePeriod === "14days" ? 14 : 30),
    );
  } else {
    start = localDate(settings.usageFrom);
    end = localDate(settings.usageTo);
    if (end) end.setDate(end.getDate() + 1);
  }
  if (!start || !end || start >= end) return null;
  return { start, end };
}
export function summarizeUsage(state, settings, now = new Date()) {
  const range = usageRange(settings, now);
  if (!range || !state) return null;
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    requests: 0,
    unknown: 0,
    pending: 0,
  };
  const groups = Object.fromEntries(
    ["chat", "module", "connection"].map((k) => [k, { ...totals }]),
  );
  for (const e of state.events) {
    const at = new Date(e.at);
    if (at < range.start || at >= range.end) continue;
    for (const t of [totals, groups[e.kind]]) {
      if (e.status === "reported") {
        t.requests++;
        for (const k of ["input", "output", "cacheRead", "cacheWrite"])
          t[k] += e[k];
      } else t[e.status]++;
    }
  }
  return {
    ...totals,
    total: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
    groups,
    ...range,
    partial: new Date(state.startedAt) > range.start,
  };
}
