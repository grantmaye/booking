import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB, seed, put, get, list, book } from "../db.mjs";
import { audience } from "../lib/audience.mjs";
import {
  marketingReport,
  marketingRoute,
  integrations,
} from "../lib/marketing.mjs";
import { queueCampaign, runOutbox, unsubscribe } from "../lib/messaging.mjs";
import { sign } from "../lib/security.mjs";
import { Webhook } from "svix";
import { emailWebhook } from "../lib/delivery-webhooks.mjs";
function fixture() {
  const db = openDB(":memory:");
  seed(db);
  const c = get(db, "clients", "client-0");
  put(db, "clients", { ...c, marketingConsent: true }, c.id);
  return db;
}
function campaign(db, segment = "all") {
  return put(db, "campaigns", {
    name: "Test campaign",
    subject: "A studio update",
    body: "Come visit.",
    segment,
    status: "draft",
  });
}
const owner = { id: "test-owner", role: "owner" };
async function route(db, path, method, data, user = owner) {
  let result;
  await marketingRoute({
    db,
    url: new URL(path, "https://example.com"),
    req: { method },
    body: async () => data,
    user,
    send: (_, d) => {
      result = d;
    },
  });
  return result;
}
test("audience requires consent, validates segments and deduplicates email", () => {
  const db = fixture();
  for (const c of list(db, "clients"))
    put(db, "clients", { ...c, marketingConsent: false }, c.id);
  put(
    db,
    "clients",
    { name: "A", email: "a@example.com", marketingConsent: true },
    "one",
  );
  put(
    db,
    "clients",
    { name: "Duplicate", email: "A@example.com", marketingConsent: true },
    "two",
  );
  put(
    db,
    "clients",
    { name: "No", email: "no@example.com", marketingConsent: false },
    "no",
  );
  assert.equal(audience(db).length, 1);
  assert.equal(audience(db, "new").length, 1);
  assert.equal(audience(db, "lapsed").length, 0);
  assert.throws(() => audience(db, "unknown"));
  db.close();
});
test("scheduled campaign waits, snapshots recipients, and rechecks consent before delivery", async () => {
  const db = fixture();
  process.env.APP_SECRET = "test-marketing-secret-long-enough";
  process.env.PUBLIC_ORIGIN = "https://studio.example.com";
  const c = campaign(db),
    at = Date.now() + 86400000,
    expected = audience(db).length;
  assert.ok(expected > 0);
  assert.equal(queueCampaign(db, c.id, { available: at }).queued, expected);
  assert.throws(() => queueCampaign(db, c.id), /again/);
  let sent = 0;
  await runOutbox(db, {
    now: at - 1,
    send: async () => {
      sent++;
      return "provider";
    },
  });
  assert.equal(sent, 0);
  for (const person of list(db, "clients"))
    put(db, "clients", { ...person, marketingConsent: false }, person.id);
  await runOutbox(db, {
    now: at + 1,
    send: async () => {
      sent++;
      return "provider";
    },
  });
  assert.equal(sent, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM outbox WHERE status='suppressed'").get()
      .n,
    expected,
  );
  assert.match(
    db.prepare("SELECT body FROM outbox LIMIT 1").get().body,
    /utm_campaign=/,
  );
  db.close();
});
test("future campaign starts its retry window at first delivery, not draft creation", async () => {
  const db = fixture(),
    c = campaign(db);
  process.env.APP_SECRET = "test-marketing-secret-long-enough";
  process.env.PUBLIC_ORIGIN = "https://studio.example.com";
  const at = Date.now() + 7 * 86400000;
  queueCampaign(db, c.id, { available: at });
  await runOutbox(db, {
    now: at,
    send: async () => {
      throw Error("Temporary provider outage");
    },
  });
  assert.equal(
    db.prepare("SELECT status FROM outbox LIMIT 1").get().status,
    "retry",
  );
  db.close();
});
test("attribution counts real appointments with safe source labels and rejects reversed ranges", () => {
  const db = fixture();
  const a = book(
    db,
    {
      locationId: "south-end",
      staffId: "marcus",
      serviceId: "cut",
      clientId: "client-0",
      start: "2026-11-10T15:00:00Z",
      attribution: {
        source: "instagram",
        medium: "social",
        campaign: "november",
      },
    },
    { now: new Date("2026-11-09T12:00:00Z") },
  );
  const r = marketingReport(db, "2026-11-10", "2026-11-10");
  assert.equal(r.bookings, 1);
  assert.equal(r.sources[0].source, "instagram");
  assert.equal(r.bookedValue, a.price);
  assert.throws(() => marketingReport(db, "2026-12-01", "2026-11-01"));
  db.close();
});
test("signed delivery engagement deduplicates recipients without replacing delivery state", () => {
  const db = fixture();
  process.env.APP_SECRET = "test-marketing-secret-long-enough";
  process.env.PUBLIC_ORIGIN = "https://studio.example.com";
  const c = campaign(db);
  queueCampaign(db, c.id);
  const m = db.prepare("SELECT * FROM outbox LIMIT 1").get();
  db.prepare(
    "UPDATE outbox SET provider_id='email_123',status='sent' WHERE id=?",
  ).run(m.id);
  const secret = "whsec_" + Buffer.alloc(32, 8).toString("base64"),
    stamp = new Date();
  for (const [id, type] of [
    ["msg_delivered", "email.delivered"],
    ["msg_open", "email.opened"],
    ["msg_open2", "email.opened"],
    ["msg_click", "email.clicked"],
  ]) {
    const raw = JSON.stringify({ type, data: { email_id: "email_123" } }),
      headers = {
        "svix-id": id,
        "svix-timestamp": String(Math.floor(+stamp / 1000)),
        "svix-signature": new Webhook(secret).sign(id, stamp, raw),
      };
    emailWebhook(db, raw, headers, secret);
    emailWebhook(db, raw, headers, secret);
  }
  const r = marketingReport(db, "2026-01-01", "2026-12-31").campaigns.find(
    (x) => x.id === c.id,
  );
  assert.equal(r.metrics.delivered, 1);
  assert.equal(r.metrics.opened, 1);
  assert.equal(r.metrics.clicked, 1);
  assert.equal(
    db.prepare("SELECT status FROM outbox WHERE id=?").get(m.id).status,
    "delivered",
  );
  db.close();
});
test("marketing and integration changes enforce manager/owner boundaries and never expose secrets", async () => {
  const db = fixture();
  await assert.rejects(
    route(db, "/api/marketing", "GET", null, { role: "staff" }),
    /permission/,
  );
  await assert.rejects(
    route(
      db,
      "/api/integrations",
      "PATCH",
      { ga4Id: "G-ABC1234567" },
      { role: "manager" },
    ),
    /permission/,
  );
  await assert.rejects(
    route(db, "/api/integrations", "PATCH", { ga4Id: "https://evil.example" }),
    /valid/,
  );
  await route(db, "/api/integrations", "PATCH", { ga4Id: "G-ABC1234567" });
  assert.equal(
    (await route(db, "/api/public/analytics-config", "GET", null, null)).ga4Id,
    "G-ABC1234567",
  );
  process.env.RESEND_API_KEY = "private_test_marker";
  assert.ok(!JSON.stringify(integrations(db)).includes("private_test_marker"));
  delete process.env.RESEND_API_KEY;
  const c = await route(db, "/api/marketing/campaigns", "POST", {
    name: "Draft",
    subject: "Hello",
    body: "Hello there",
    segment: "all",
  });
  await route(db, "/api/marketing/campaigns", "POST", {
    ...c,
    subject: "Edited",
  });
  assert.equal(get(db, "campaigns", c.id).subject, "Edited");
  await assert.rejects(
    route(db, "/api/marketing/schedule", "POST", { id: c.id }),
    /Configure/,
  );
  db.close();
});
test("campaign cancellation stops pending sends and unsubscribe covers duplicate profiles", async () => {
  const db = fixture();
  process.env.APP_SECRET = "test-marketing-secret-long-enough";
  process.env.PUBLIC_ORIGIN = "https://studio.example.com";
  const c = campaign(db);
  queueCampaign(db, c.id);
  const n = await route(db, "/api/marketing/cancel", "POST", { id: c.id });
  assert.ok(n.suppressed > 0);
  assert.equal(get(db, "campaigns", c.id).status, "cancelled");
  const p = list(db, "clients").find((c) => c.marketingConsent);
  put(db, "clients", { ...p, name: "Duplicate" }, "dupe");
  unsubscribe(db, p.id, sign("unsubscribe:" + p.id));
  assert.equal(get(db, "clients", "dupe").marketingConsent, false);
  db.close();
});
