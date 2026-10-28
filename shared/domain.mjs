export const DEFAULT_SETTINGS = Object.freeze({
  name: "",
  theme: "dark",
  accent: "#ee0000",
  font: "system",
  fontSize: 15,
  lineHeight: 1.65,
  rememberWindow: true,
  onboarded: false,
});
export const PROVIDER = Object.freeze({
  model: "claude-sonnet-4-6",
  region: "global",
  maxTokens: 3072,
});
export const SOURCE_URL = "";
export const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
];

export function validateSettings(input) {
  const v = { ...DEFAULT_SETTINGS, ...input };
  if (typeof v.name !== "string" || v.name.trim().length > 80)
    throw new Error("Name must be 80 characters or fewer.");
  if (!["dark", "light", "system"].includes(v.theme))
    throw new Error("Choose a valid theme.");
  if (!["#ee0000", "#c9190b", "#0066cc", "#009596"].includes(v.accent))
    throw new Error("Choose an available accent.");
  if (!["system", "sans", "mono"].includes(v.font))
    throw new Error("Choose an available font.");
  if (!Number.isInteger(v.fontSize) || v.fontSize < 13 || v.fontSize > 20)
    throw new Error("Text size must be between 13 and 20.");
  if (![1.45, 1.65, 1.85].includes(v.lineHeight))
    throw new Error("Choose an available line spacing.");
  return {
    name: v.name.trim(),
    theme: v.theme,
    accent: v.accent,
    font: v.font,
    fontSize: v.fontSize,
    lineHeight: v.lineHeight,
    rememberWindow: Boolean(v.rememberWindow),
    onboarded: Boolean(v.onboarded),
  };
}

export function validateMessages(messages) {
  if (
    !Array.isArray(messages) ||
    !messages.length ||
    messages.length > 23 ||
    messages.length % 2 !== 1
  )
    throw new Error(
      "Start a new conversation; the context limit is 12 questions.",
    );
  let total = 0;
  const clean = messages.map((m, i) => {
    if (
      !m ||
      m.role !== (i % 2 === 0 ? "user" : "assistant") ||
      typeof m.content !== "string" ||
      !m.content.trim()
    )
      throw new Error("Invalid conversation.");
    total += m.content.length;
    return { role: m.role, content: m.content };
  });
  if (total > 40000)
    throw new Error(
      "Conversation is too large. Start a new conversation or shorten the message.",
    );
  return clean;
}

export function parseSpec(text) {
  if (typeof text !== "string" || text.length > 16 * 1024 * 1024)
    throw new Error("API specification must be JSON smaller than 16 MB.");
  let spec;
  try {
    spec = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      "This is not valid JSON. Import the OpenAPI JSON, not a login page.",
    );
  }
  if (
    !spec ||
    typeof spec !== "object" ||
    Array.isArray(spec) ||
    !(spec.swagger === "2.0" || /^3\./.test(spec.openapi || "")) ||
    !spec.paths ||
    typeof spec.paths !== "object" ||
    Array.isArray(spec.paths)
  )
    throw new Error(
      "Expected an OpenAPI 3.x or Swagger 2.0 document with paths.",
    );
  const textField = (value, fallback = "") => {
    if (value === undefined) return fallback;
    if (typeof value !== "string")
      throw new Error(
        "The specification contains a non-text title, summary, tag, or version.",
      );
    return value;
  };
  const operations = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!path.startsWith("/") || !item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      if (!item[method] || typeof item[method] !== "object") continue;
      const op = item[method];
      if (
        op.tags !== undefined &&
        (!Array.isArray(op.tags) ||
          op.tags.some((tag) => typeof tag !== "string"))
      )
        throw new Error("API tags must be an array of strings.");
      operations.push({
        id: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        summary: textField(op.summary ?? op.operationId),
        description: textField(op.description),
        group: textField(op.tags?.[0], "Other"),
        deprecated: Boolean(op.deprecated),
        operation: op,
        pathParameters: item.parameters || [],
      });
    }
  }
  if (!operations.length)
    throw new Error("No API operations found in this specification.");
  const schemas = spec.components?.schemas || spec.definitions || {};
  if (typeof schemas !== "object" || Array.isArray(schemas))
    throw new Error("The schema collection must be an object.");
  return {
    spec,
    operations,
    schemas,
    title: textField(spec.info?.title, "Case Management API"),
    version: textField(spec.info?.version, "Unspecified"),
    format: spec.openapi || spec.swagger,
  };
}

export function resolveRef(spec, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .reduce((obj, part) => {
      const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
      return obj && Object.hasOwn(obj, key) ? obj[key] : undefined;
    }, spec);
}

export function safeLink(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port;
  } catch { return false; }
}
