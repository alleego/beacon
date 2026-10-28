import { PROVIDER } from "../shared/domain.mjs";

// The only live integrations are OAuth and Claude. No case endpoint is enabled,
// including GET, until the actual API contract has been reviewed for side effects.
export function createProviderFetch(projectId, transport = globalThis.fetch) {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new Error("Invalid provider project.");
  }
  const permitted = new Set([
    "https://oauth2.googleapis.com/token",
    `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${PROVIDER.region}/publishers/anthropic/models/${PROVIDER.model}:rawPredict`,
  ]);
  return async (input, init = {}) => {
    const isRequest = input instanceof Request;
    const address = isRequest ? input.url : input;
    const method = init.method ?? (isRequest ? input.method : "GET");
    let url;
    try {
      if (typeof address !== "string" && !(address instanceof URL))
        throw new Error();
      url = new URL(address);
    } catch {
      throw new Error("Network request blocked by the read-only case policy.");
    }
    if (
      typeof method !== "string" ||
      method.toUpperCase() !== "POST" ||
      !permitted.has(url.href)
    ) {
      throw new Error("Network request blocked by the read-only case policy.");
    }
    const response = await transport(input, { ...init, redirect: "error" });
    if (
      response.redirected ||
      (response.status >= 300 && response.status < 400)
    ) {
      throw new Error("Network redirect blocked by the read-only case policy.");
    }
    return response;
  };
}
