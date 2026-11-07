import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  normalizeOrigin,
  request,
  dateKey,
  money,
} from "../src/lib/api.ts";
test("release connections require HTTPS and reject paths, credentials and query strings", () => {
  assert.equal(
    normalizeOrigin(" https://studio.example/ ", false),
    "https://studio.example",
  );
  for (const url of [
    "http://studio.example",
    "https://me:secret@studio.example",
    "https://studio.example/book",
    "https://studio.example?token=secret",
    "https://studio.example#token",
    "file:///etc/passwd",
  ])
    assert.throws(() => normalizeOrigin(url, false));
  assert.equal(
    normalizeOrigin("http://10.0.2.2:3002", true),
    "http://10.0.2.2:3002",
  );
});
test("API sends credentials only as bearer headers, blocks redirects, and never uses cookies", async (t) => {
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(input, "https://studio.example/api/portal/book");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer private-token",
      );
      assert.equal(
        (init?.headers as Record<string, string>)["Idempotency-Key"],
        "order-key",
      );
      assert.equal(init?.body, JSON.stringify({ start: "appointment-time" }));
      return new Response(JSON.stringify({ id: "visit" }), { status: 201 });
    },
  );
  assert.deepEqual(
    await request(
      "https://studio.example",
      "private-token",
      "/portal/book",
      "POST",
      { start: "appointment-time" },
      "order-key",
    ),
    { id: "visit" },
  );
  assert.equal(mock.mock.callCount(), 1);
});
test("authentication failures preserve their status for session invalidation", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: "Sign in to continue." }), {
        status: 401,
      }),
  );
  await assert.rejects(
    request("https://studio.example", "expired", "/account"),
    (e) =>
      e instanceof ApiError &&
      e.status === 401 &&
      e.message === "Sign in to continue.",
  );
});
test("network failures and non-JSON servers give actionable errors", async (t) => {
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>not an API</html>"),
  );
  await assert.rejects(
    request("https://studio.example", null, "/health"),
    /Chairside response/,
  );
  mock.mock.mockImplementation(async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    request("https://studio.example", null, "/health"),
    /Cannot reach your studio/,
  );
});
test("studio dates honor timezones and money uses integer cents", () => {
  assert.equal(
    dateKey(new Date("2026-11-07T02:00:00Z"), "America/New_York"),
    "2026-11-06",
  );
  assert.equal(money(4500), "$45.00");
});
