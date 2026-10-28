import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  validateMessages,
  parseSpec,
  resolveRef,
  safeLink,
} from "../shared/domain.mjs";
import {
  parseCredential,
  normalizeWebWhitespace,
} from "../electron/credentials.mjs";
import { archiveSpec, loadLibrary } from "../electron/library.mjs";
import { requestClaude, providerError } from "../electron/provider.mjs";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

const sample = {
  openapi: "3.0.3",
  info: { title: "Test-only API", version: "1" },
  paths: {
    "/v3/cases/{caseNumber}": {
      parameters: [
        {
          name: "caseNumber",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      get: {
        tags: ["Cases"],
        summary: "Read case",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Case" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Case: {
        type: "object",
        properties: {
          number: { type: "string" },
          parent: { $ref: "#/components/schemas/Case" },
        },
      },
    },
  },
};
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const credential = {
  type: "service_account",
  project_id: "unit-test-project",
  client_email: "test@unit-test-project.iam.gserviceaccount.com",
  private_key: privateKey,
  private_key_id: "test",
  token_uri: "https://oauth2.googleapis.com/token",
};

test("settings validate ranges and discard arbitrary keys", () => {
  assert.equal(
    validateSettings({ ...DEFAULT_SETTINGS, foo: "secret" }).foo,
    undefined,
  );
  assert.equal(
    validateSettings({ ...DEFAULT_SETTINGS, name: "  Alex  " }).name,
    "Alex",
  );
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, fontSize: 99 }));
  assert.throws(() =>
    validateSettings({ ...DEFAULT_SETTINGS, accent: "url(http://evil)" }),
  );
});
test("messages alternate and end with user, with strict limits", () => {
  assert.deepEqual(
    validateMessages([{ role: "user", content: "hello", secret: "discard" }]),
    [{ role: "user", content: "hello" }],
  );
  assert.throws(() =>
    validateMessages([{ role: "assistant", content: "hello" }]),
  );
  assert.throws(() =>
    validateMessages([{ role: "user", content: "a".repeat(40001) }]),
  );
  assert.throws(() => validateMessages([]));
});
test("credentials accept direct and wrapped but never retain outer API key", () => {
  const key = parseCredential(
    JSON.stringify({
      api_key: "discard",
      service_account_key_data: credential,
    }),
  );
  assert.equal(key.api_key, undefined);
  assert.equal(key.project_id, credential.project_id);
  assert.equal(
    parseCredential(JSON.stringify(credential)).private_key,
    privateKey,
  );
});
test("credentials reject hostile token URLs, malformed keys and non-service accounts", () => {
  for (const changes of [
    { token_uri: "https://evil.example/token" },
    { private_key: "-----BEGIN PRIVATE KEY----- bad" },
    { type: "authorized_user" },
    { project_id: "a/b" },
    { client_email: "x@evil.example" },
  ])
    assert.throws(() =>
      parseCredential(JSON.stringify({ ...credential, ...changes })),
    );
  assert.throws(() => parseCredential("x".repeat(300000)));
});
test("copied webpage indentation imports without modifying credential values", () => {
  for (const space of ["\u00a0", "\u2007", "\u202f"]) {
    const text =
      "\uFEFF" +
      JSON.stringify({ service_account_key_data: credential }, null, 2).replace(
        /\n +/g,
        (match) => "\n" + space.repeat(match.length - 1),
      );
    const parsed = parseCredential(text);
    assert.equal(parsed.private_key, privateKey);
    assert.equal(parsed.client_email, credential.client_email);
  }
});
test("whitespace normalization preserves quoted values, escaped quotes, and backslashes", () => {
  const text =
    '{\u00a0"note": "keep\u00a0quoted\\\" value\\\\tail",\u202f"key": "a\\nb"}';
  assert.equal(
    normalizeWebWhitespace(text),
    '{ "note": "keep\u00a0quoted\\\" value\\\\tail", "key": "a\\nb"}',
  );
});
test("rich text corruption reports an actionable error without disclosing credential contents", () => {
  assert.throws(
    () => parseCredential('{"service\\_account\\_key\\_data":{}}'),
    /Markdown escapes/,
  );
  for (const field of ["client_email", "token_uri"]) {
    const messageCredential = {
      ...credential,
      [field]: "[sensitive-test-value](https://example.invalid)",
    };
    assert.throws(
      () => parseCredential(JSON.stringify(messageCredential)),
      (error) =>
        error.message.includes("formatted link") &&
        !error.message.includes("sensitive-test-value"),
    );
  }
});
test("OpenAPI preserves path parameters, nested definitions and circular refs", () => {
  const parsed = parseSpec(JSON.stringify(sample));
  assert.equal(parsed.operations.length, 1);
  assert.equal(parsed.operations[0].pathParameters[0].name, "caseNumber");
  assert.deepEqual(
    resolveRef(parsed.spec, "#/components/schemas/Case"),
    sample.components.schemas.Case,
  );
  assert.equal(
    resolveRef(parsed.spec, "https://example.org/schema"),
    undefined,
  );
});
test("Swagger2 and escaped local reference names work", () => {
  const old = {
    swagger: "2.0",
    paths: { "/cases": { get: { responses: {} } } },
    definitions: { "a/b~c": { type: "string" } },
  };
  assert.equal(parseSpec(JSON.stringify(old)).format, "2.0");
  assert.deepEqual(resolveRef(old, "#/definitions/a~1b~0c"), {
    type: "string",
  });
});
test("login pages and credential JSON are not API specs", () => {
  for (const content of [
    "<html>Login</html>",
    JSON.stringify(credential),
    "{}",
    "null",
  ])
    assert.throws(() => parseSpec(content));
});
test("malformed imported display fields cannot reach React", () => {
  assert.throws(() =>
    parseSpec(
      JSON.stringify({ ...sample, info: { title: { untrusted: "object" } } }),
    ),
  );
  assert.throws(() =>
    parseSpec(
      JSON.stringify({
        ...sample,
        paths: { "/test": { get: { summary: { bad: true } } } },
      }),
    ),
  );
  assert.equal(resolveRef(sample, 42), undefined);
});
test("archive keeps exact original bytes, derived index and first manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "work-team-test-"));
  try {
    const raw = Buffer.from(
      "\uFEFF" + JSON.stringify(sample, null, 2) + "\r\n",
    );
    const first = await archiveSpec(root, raw, "first.json");
    const second = await archiveSpec(root, raw, "second.json");
    assert.equal(first.importedAt, second.importedAt);
    assert.equal(second.originalName, "first.json");
    assert.deepEqual(
      await fs.readFile(path.join(root, "raw", first.id, "openapi.json")),
      raw,
    );
    assert.equal((await loadLibrary(root)).operations.length, 1);
    await fs.appendFile(path.join(root, "raw", first.id, "openapi.json"), " ");
    await assert.rejects(() => loadLibrary(root), /checksum/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("external links are HTTPS and explicitly approved", () => {
  assert.equal(safeLink("https://example.org/solutions/1"), true);
  for (const url of [
    "javascript:alert(1)",
    "file:///C:/secrets",
    "http://example.org",
    "https://user:pass@example.org",
  ])
    assert.equal(safeLink(url), false);
});
test("provider uses explicit credentials, pinned endpoint and no retries; returns only text and usage", async () => {
  let options, payload, requestOptions;
  class Auth {
    constructor(opts) {
      this.opts = opts;
    }
  }
  class Client {
    constructor(opts) {
      options = opts;
      this.messages = {
        create: async (data, opts) => {
          payload = data;
          requestOptions = opts;
          return {
            model: "claude-test",
            content: [{ type: "text", text: "Test-only answer" }],
            usage: { input_tokens: 3, output_tokens: 4 },
            stop_reason: "end_turn",
          };
        },
      };
    }
  }
  const controller = new AbortController();
  const response = await requestClaude(
    credential,
    [{ role: "user", content: "test" }],
    controller.signal,
    { Client, Auth },
  );
  assert.equal(options.baseURL, "https://aiplatform.googleapis.com/v1");
  assert.equal(options.maxRetries, 0);
  assert.equal(options.googleAuth.opts.credentials, credential);
  assert.equal(payload.model, "claude-sonnet-4-6");
  assert.equal(requestOptions.signal, controller.signal);
  assert.equal(response.text, "Test-only answer");
  assert.deepEqual(response.usage, { input: 3, output: 4 });
});
test("provider errors do not disclose provider payloads or tokens", () => {
  assert.ok(
    !providerError({
      status: 403,
      message: "private-key-super-secret",
    }).includes("super-secret"),
  );
  assert.match(providerError({ status: 429 }), /quota/);
  assert.match(providerError({ name: "AbortError" }), /cancelled/);
  assert.match(providerError(new AnthropicVertex.APIUserAbortError()), /cancelled/);
});
