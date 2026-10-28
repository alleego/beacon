import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createProviderFetch } from "../electron/network.mjs";
import { requestClaude } from "../electron/provider.mjs";
import { caseOperationAccess } from "../shared/case-policy.mjs";
import { parseSpec, safeLink, SOURCE_URL } from "../shared/domain.mjs";

const project = "readonly-test-project";
const oauth = "https://oauth2.googleapis.com/token";
const vertex = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/anthropic/models/claude-sonnet-4-6:rawPredict`;

test("all case methods and unreviewed GETs are denied before network access", async () => {
  let calls = 0;
  const fetch = createProviderFetch(project, async () => {
    calls++;
  });
  for (const method of [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "TRACE",
    "post",
  ]) {
    for (const url of [
      "https://example.org/api/cases/123/comments",
      "https://api.example.net/services/data/v1/sobjects/Case/123",
      "https://example.org/api/sftp/token/reset",
    ]) {
      await assert.rejects(fetch(url, { method }), /read-only/);
    }
  }
  await assert.rejects(
    fetch(
      new Request("https://example.org/api/cases", {
        method: "POST",
      }),
    ),
    /read-only/,
  );
  assert.equal(calls, 0);
});

test("only exact OAuth and configured Vertex POST destinations pass; redirects cannot escape", async () => {
  const calls = [];
  const fetch = createProviderFetch(project, async (input, init) => {
    calls.push({ input, init });
    return new Response("{}", { status: 200 });
  });
  const controller = new AbortController();
  await fetch(new URL(oauth), {
    method: "POST",
    body: "test",
    signal: controller.signal,
    redirect: "follow",
  });
  await fetch(new Request(vertex, { method: "POST", body: "{}" }));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(calls[0].init.signal, controller.signal);
  for (const url of [
    oauth + "?redirect=https://example.org",
    oauth + "#fragment",
    oauth.replace(
      "oauth2.googleapis.com",
      "oauth2.googleapis.com.evil.example",
    ),
    oauth.replace("https:", "http:"),
    oauth.replace("https://", "https://user:pass@"),
    vertex.replace(project, "different-project"),
    vertex.replace(":rawPredict", ":streamRawPredict"),
    "https://aiplatform.googleapis.com/v1/projects",
  ])
    await assert.rejects(fetch(url, { method: "POST" }), /read-only/);
  await assert.rejects(fetch(oauth), /read-only/);
  await assert.rejects(
    fetch(new Request(vertex, { method: "POST" }), { method: "DELETE" }),
    /read-only/,
  );
  assert.equal(calls.length, 2);
  const redirect = createProviderFetch(
    project,
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://example.org" },
      }),
  );
  await assert.rejects(redirect(oauth, { method: "POST" }), /redirect blocked/);
});

test("actual Google Auth and Anthropic SDKs both use the restricted transport", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const calls = [];
  const transport = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    const data =
      url === oauth
        ? {
            access_token: "synthetic-test-token",
            token_type: "Bearer",
            expires_in: 3600,
          }
        : {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text: "Synthetic answer" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          };
    assert.ok([oauth, vertex].includes(url));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const response = await requestClaude(
    {
      type: "service_account",
      project_id: project,
      client_email: `test@${project}.iam.gserviceaccount.com`,
      private_key: privateKey,
      token_uri: oauth,
    },
    [{ role: "user", content: "Synthetic test only" }],
    new AbortController().signal,
    { transport },
  );
  assert.equal(response.text, "Synthetic answer");
  assert.deepEqual(calls, [oauth, vertex]);
});

test("full API originals retain write definitions, but GETs never self-authorize", () => {
  const raw = {
    openapi: "3.0.3",
    paths: {
      "/cases": {
        get: { summary: "Read cases" },
        post: { summary: "Create case", "x-read-only": true },
      },
      "/sftp/token/reset": { get: { summary: "Reset token" } },
      "/whatever": { get: { operationId: "createToken" } },
    },
  };
  const parsed = parseSpec(JSON.stringify(raw));
  assert.deepEqual(parsed.spec, raw);
  assert.equal(parsed.operations.length, 4);
  assert.equal(caseOperationAccess(parsed.operations[0]).group, "get");
  assert.match(caseOperationAccess(parsed.operations[0]).label, /not reviewed/);
  for (const op of parsed.operations.slice(1))
    assert.equal(caseOperationAccess(op).group, "blocked");
});

test("external links require HTTPS and no embedded credentials or nonstandard ports", () => {
  for (const url of ["https://example.org/docs", "https://cloud.google.com/vertex-ai/docs"]) assert.equal(safeLink(url), true);
  for (const url of ["", "javascript:alert(1)", "file:///private", "http://example.org", "https://user:pass@example.org", "https://example.org:8443/path"]) assert.equal(safeLink(url), false);
});
