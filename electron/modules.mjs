import { createHash } from "node:crypto";

export function parseCartridge(bytes) {
  if (bytes.length > 1024 * 1024) throw new Error("Module exceeds 1 MB.");
  const m = JSON.parse(bytes.toString("utf8"));
  const str = (v, n) => typeof v === "string" && v.length > 0 && v.length <= n;
  if (m.format !== "beacon-module" || m.apiVersion !== 1 ||
      !/^[a-z][a-z0-9-]{2,63}$/.test(m.id) ||
      !str(m.name, 80) || !/^\d+\.\d+\.\d+$/.test(m.version) ||
      !str(m.description, 1000) || !str(m.system, 12000) ||
      !str(m.worker, 200000) || !/^\/[a-zA-Z0-9_./-]+$/.test(m.python) ||
      !Array.isArray(m.topics) || !m.topics.length || m.topics.length > 8 ||
      m.topics.some(t => !/^[a-z][a-z0-9-]{0,40}$/.test(t.id) || !str(t.name, 80) || !str(t.prompt, 4000)) ||
      new Set(m.topics.map(t => t.id)).size !== m.topics.length ||
      m.capability !== "ssh-python-worker")
    throw new Error("Invalid or incompatible cartridge.");
  // Targets are identifiers, never shell syntax or file paths.
  return { ...m, hash: createHash("sha256").update(bytes).digest("hex") };
}

export function validateConnection(c) {
  const host = v => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/.test(v);
  if (!c || !host(c.host) || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(c.user))
    throw new Error("Enter a host and your own SSH username.");
  if (c.relay && !host(c.relay)) throw new Error("Invalid relay SSH host or alias.");
  if (c.config && (typeof c.config !== "string" || c.config.length > 1000 || /[\r\n\0]/.test(c.config)))
    throw new Error("Invalid local SSH configuration path.");
  return { host: c.host, user: c.user, relay: c.relay || "", config: c.config || "" };
}

export function workflowTools(modules) {
  if (!modules.length) return [];
  return [{
    name: "start_investigation",
    description: "Start an investigation only when requested in the current user message. Available modules: " +
      modules.map(m => `${m.id}: ${m.description}`).join("\n"),
    input_schema: { type: "object", properties: {
      moduleId: { type: "string", enum: modules.map(m => m.id) },
      target: { type: "string", description: "Exact target identifier supplied by the user; preserve leading zeros." },
      depth: { type: "string", enum: ["quick", "deep"] },
    }, required: ["moduleId", "target", "depth"], additionalProperties: false },
  }];
}
