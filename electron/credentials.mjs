import { createPrivateKey } from "node:crypto";

export function normalizeWebWhitespace(text) {
  let insideString = false;
  let escaped = false;
  const normalized = [];
  // Only normalize copied page spacing between JSON tokens, never key material.
  for (const character of text.replace(/^\uFEFF/, "")) {
    if (insideString) {
      normalized.push(character);
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') insideString = false;
    } else if (character === '"') {
      insideString = true;
      normalized.push(character);
    } else {
      normalized.push(
        /[\u00a0\u2007\u202f]/u.test(character) ? " " : character,
      );
    }
  }
  return normalized.join("");
}

function rejectLinkMarkup(value, field) {
  if (typeof value === "string" && /^\s*\[.*\]\(.+\)\s*$/s.test(value)) {
    throw new Error(
      `The credential ${field} contains a formatted link instead of plain text. Import the original JSON download, not text copied from a formatted message.`,
    );
  }
}

export function parseCredential(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 256 * 1024)
    throw new Error("Credential JSON must be smaller than 256 KB.");
  let parsed;
  try {
    parsed = JSON.parse(normalizeWebWhitespace(text));
  } catch {
    if (text.includes("\\_")) {
      throw new Error(
        "The credential contains Markdown escapes instead of valid JSON. Import the original JSON download, not text copied from a formatted message.",
      );
    }
    throw new Error(
      "Cannot read the credential JSON. Import the original JSON download issued to you. An API key alone or a formatted message is not a credential JSON file.",
    );
  }
  const key = parsed?.service_account_key_data || parsed;
  if (key?.type !== "service_account")
    throw new Error(
      "Import your Google Vertex service-account JSON, or its wrapper file.",
    );
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(key.project_id || ""))
    throw new Error("The credential has an invalid Google project ID.");
  rejectLinkMarkup(key.client_email, "client_email");
  rejectLinkMarkup(key.token_uri, "token_uri");
  if (
    typeof key.client_email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(key.client_email)
  )
    throw new Error("The credential has an invalid service-account email.");
  if (
    ![
      "https://oauth2.googleapis.com/token",
      "https://accounts.google.com/token",
    ].includes(key.token_uri)
  )
    throw new Error(
      "The credential token endpoint is not an approved Google endpoint.",
    );
  if (
    typeof key.private_key !== "string" ||
    !key.private_key.includes("-----BEGIN PRIVATE KEY-----")
  )
    throw new Error("A service-account private key is missing.");
  try {
    const pk = createPrivateKey(key.private_key);
    if (pk.asymmetricKeyType !== "rsa") throw new Error();
  } catch {
    throw new Error("The credential private key is invalid.");
  }
  return {
    type: "service_account",
    project_id: key.project_id,
    client_email: key.client_email,
    private_key: key.private_key,
    private_key_id: String(key.private_key_id || ""),
    token_uri: "https://oauth2.googleapis.com/token",
  };
}
