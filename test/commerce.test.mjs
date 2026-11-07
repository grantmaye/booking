import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB, seed, book, list, get, put } from "../db.mjs";
import {
  createOrder,
  settle,
  refundLocal,
  stockLevel,
  moveStock,
  cancelOrder,
  receivePurchase,
} from "../lib/commerce.mjs";
import { handleStripeEvent } from "../lib/payments.mjs";
import { enqueue, runOutbox, queueCampaign } from "../lib/messaging.mjs";
import {
  newMFA,
  checkMFA,
  issueToken,
  takeToken,
  rateLimit,
} from "../lib/security.mjs";
import * as OTPAuth from "otpauth";
function fixture() {
  const db = openDB(":memory:");
  seed(db);
  const a = book(
    db,
    {
      locationId: "south-end",
      staffId: "marcus",
      serviceId: "cut",
      clientId: "client-0",
      start: "2026-11-10T15:00:00Z",
    },
    { now: new Date("2026-11-09T12:00:00Z") },
  );
  return { db, a };
}
test("order creation is idempotent and reserves retail stock once", () => {
  const { db, a } = fixture(),
    p = list(db, "products")[0];
  const input = {
    appointmentId: a.id,
    items: [{ productId: p.id, quantity: 2 }],
  };
  const o = createOrder(db, input, "request-one");
  assert.equal(createOrder(db, input, "request-one").id, o.id);
  assert.equal(stockLevel(db, p.id, "south-end"), p.stock - 2);
  assert.throws(
    () => createOrder(db, { ...input, tip: 100 }, "request-one"),
    /different order/,
  );
  db.close();
});
test("cash + gift tender settles exactly once and refunds balances and stock", () => {
  const { db, a } = fixture(),
    p = list(db, "products")[0];
  put(
    db,
    "giftcards",
    { name: "Test", code: "GIFTCARD123", balance: 3000 },
    "gift",
  );
  const o = createOrder(
    db,
    {
      appointmentId: a.id,
      items: [{ productId: p.id, quantity: 1 }],
      tip: 500,
    },
    "mixed-tender",
  );
  settle(db, o.id, [
    { method: "giftcard", amount: 3000, code: "GIFTCARD123" },
    { method: "cash", amount: o.total - 3000 },
  ]);
  assert.equal(get(db, "giftcards", "gift").balance, 0);
  settle(db, o.id, [{ method: "cash", amount: o.total }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tenders").get().n, 2);
  refundLocal(db, o.id, "Customer return");
  assert.equal(get(db, "giftcards", "gift").balance, 3000);
  assert.equal(stockLevel(db, p.id, "south-end"), p.stock);
  assert.equal(get(db, "clients", "client-0").points, 0);
  assert.throws(() => refundLocal(db, o.id, "Again"), /once/);
  db.close();
});
test("failed mixed payment rolls back gift redemption", () => {
  const { db, a } = fixture();
  put(
    db,
    "giftcards",
    { name: "Test", code: "GIFT12345", balance: 2000 },
    "gift",
  );
  const o = createOrder(db, { appointmentId: a.id }, "failed-gift");
  assert.throws(
    () =>
      settle(db, o.id, [
        { method: "giftcard", code: "GIFT12345", amount: 2000 },
        { method: "giftcard", code: "INVALID", amount: 2500 },
      ]),
    /insufficient/,
  );
  assert.equal(get(db, "giftcards", "gift").balance, 2000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tenders").get().n, 0);
  db.close();
});
test("tax and promotion totals are calculated server side", () => {
  const { db, a } = fixture();
  const l = get(db, "locations", "south-end");
  put(db, "locations", { ...l, taxBasisPoints: 750 }, l.id);
  put(db, "promotions", {
    name: "Ten",
    code: "TEN",
    type: "percent",
    value: 10,
    active: true,
    uses: 0,
    maxUses: 2,
  });
  const o = createOrder(
    db,
    { appointmentId: a.id, promoCode: "TEN", tip: 500 },
    "tax-test",
  );
  assert.equal(o.discount, 450);
  assert.equal(o.tax, 304);
  assert.equal(o.total, 4854);
  db.close();
});
test("membership credit and loyalty redemption enforce ownership and balances", () => {
  const { db, a } = fixture();
  const plan = list(db, "memberships")[0];
  db.prepare("INSERT INTO subscriptions_v2 VALUES(?,?,?,?,?,?,?,?)").run(
    "sub",
    "client-0",
    plan.id,
    null,
    "active",
    2,
    null,
    new Date().toISOString(),
  );
  const o = createOrder(
    db,
    { appointmentId: a.id, subscriptionId: "sub" },
    "member-test",
  );
  assert.equal(o.total, 0);
  settle(db, o.id, []);
  assert.equal(
    db.prepare("SELECT credits FROM subscriptions_v2").get().credits,
    1,
  );
  refundLocal(db, o.id, "Undo");
  assert.equal(
    db.prepare("SELECT credits FROM subscriptions_v2").get().credits,
    2,
  );
  db.close();
});
test("pending order cancellation restores inventory and permits a replacement order", () => {
  const { db, a } = fixture(),
    p = list(db, "products")[0];
  const o = createOrder(
    db,
    { appointmentId: a.id, items: [{ productId: p.id, quantity: 1 }] },
    "cancel-test",
  );
  cancelOrder(db, o.id);
  assert.equal(stockLevel(db, p.id, "south-end"), p.stock);
  createOrder(db, { appointmentId: a.id }, "replacement");
  db.close();
});
test("stock transfer cannot oversell and purchase receipt is not repeatable", () => {
  const { db } = fixture(),
    p = list(db, "products")[0];
  assert.throws(
    () => moveStock(db, p.id, "south-end", -1000, "bad"),
    /Insufficient/,
  );
  put(
    db,
    "purchaseOrders",
    {
      name: "PO",
      locationId: "noda",
      status: "ordered",
      items: [{ productId: p.id, quantity: 10 }],
    },
    "po",
  );
  receivePurchase(db, "po");
  assert.equal(stockLevel(db, p.id, "noda"), 10);
  assert.throws(() => receivePurchase(db, "po"), /cannot/);
  db.close();
});
test("card payment requires verified provider and signed event processing is idempotent", async () => {
  const { db, a } = fixture();
  const o = createOrder(db, { appointmentId: a.id }, "stripe-order");
  db.prepare("UPDATE orders SET stripe_session=? WHERE id=?").run(
    "cs_test",
    o.id,
  );
  assert.throws(
    () => settle(db, o.id, [{ method: "card", amount: o.total }]),
    /signed webhook/,
  );
  const event = {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test",
        payment_status: "paid",
        amount_total: 4500,
        currency: "usd",
        payment_intent: "pi_test",
      },
    },
  };
  await handleStripeEvent(db, event, {});
  assert.equal((await handleStripeEvent(db, event, {})).duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments").get().n, 1);
  db.close();
});
test("unpaid or mismatched Stripe events do not fulfill", async () => {
  const { db, a } = fixture();
  const o = createOrder(db, { appointmentId: a.id }, "stripe-unpaid");
  db.prepare("UPDATE orders SET stripe_session=? WHERE id=?").run(
    "cs_test",
    o.id,
  );
  await handleStripeEvent(
    db,
    {
      id: "evt_unpaid",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "unpaid" } },
    },
    {},
  );
  assert.equal(db.prepare("SELECT status FROM orders").get().status, "pending");
  await assert.rejects(
    handleStripeEvent(
      db,
      {
        id: "evt_wrong",
        type: "checkout.session.async_payment_succeeded",
        data: {
          object: {
            id: "cs_test",
            payment_status: "paid",
            amount_total: 1,
            currency: "usd",
          },
        },
      },
      {},
    ),
    /mismatch/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments").get().n, 0);
  db.close();
});
test("outbox retries failed delivery, suppresses opted-out marketing, deduplicates enqueue", async () => {
  const { db } = fixture();
  enqueue(db, {
    to: "qa@example.com",
    subject: "Test",
    body: "test",
    dedupe: "one",
  });
  enqueue(db, {
    to: "qa@example.com",
    subject: "Test",
    body: "test",
    dedupe: "one",
  });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox").get().n, 1);
  await runOutbox(db, {
    send: async () => {
      throw Error("Provider down.");
    },
  });
  assert.equal(db.prepare("SELECT status FROM outbox").get().status, "retry");
  await runOutbox(db, {
    now: Date.now() + 60000,
    send: async () => "provider-id",
  });
  assert.equal(db.prepare("SELECT status FROM outbox").get().status, "sent");
  enqueue(db, {
    to: "qa@example.com",
    subject: "Marketing",
    body: "offer",
    kind: "marketing",
    clientId: "client-0",
  });
  await runOutbox(db, {
    send: async () => {
      throw Error("Should not send");
    },
  });
  assert.equal(
    db.prepare("SELECT status FROM outbox WHERE kind='marketing'").get().status,
    "suppressed",
  );
  db.close();
});
test("MFA codes validate, recovery tokens are single-use, durable rate limit blocks", () => {
  const { db } = fixture();
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    "user",
    "test@example.com",
    "Test",
    "unused",
    "owner",
  );
  const m = newMFA("test@example.com");
  const code = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(m.secret),
    digits: 6,
    period: 30,
  }).generate();
  assert.equal(checkMFA(m.secret, code), true);
  assert.equal(checkMFA(m.secret, "nope"), false);
  const raw = issueToken(db, "user", "reset");
  assert.equal(takeToken(db, raw, "reset"), "user");
  assert.throws(() => takeToken(db, raw, "reset"), /expired/);
  rateLimit(db, "test", 1);
  assert.throws(() => rateLimit(db, "test", 1), /Too many/);
  db.close();
});
test("multi-service reservation sums duration and location prices; resource conflicts block", () => {
  const { db } = fixture();
  put(
    db,
    "resources",
    { name: "Room", locationId: "south-end", active: true },
    "room",
  );
  const input = {
    locationId: "south-end",
    staffId: "alex",
    serviceId: "cut",
    serviceIds: ["cut", "beard"],
    resourceId: "room",
    clientId: "client-1",
    start: "2026-11-10T16:00:00Z",
  };
  const a = book(db, input, { now: new Date("2026-11-09T12:00:00Z") });
  assert.equal(a.price, 7500);
  assert.equal(a.end, "2026-11-10T17:15:00.000Z");
  assert.throws(
    () =>
      book(
        db,
        { ...input, staffId: "jordan" },
        { now: new Date("2026-11-09T12:00:00Z") },
      ),
    /chair or room/,
  );
  db.close();
});

import { matchWaitlist, claimWaitlist } from "../lib/waitlist.mjs";
test("waitlist holds a slot, claim is single use, and expired offers release capacity", () => {
  const { db } = fixture();
  let date;
  for (let i = 2; i < 8; i++) {
    date = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
    if (new Date(date + "T12:00:00Z").getUTCDay() !== 0) break;
  }
  put(
    db,
    "waitlist",
    {
      name: "Waiting",
      email: "wait@example.com",
      locationId: "south-end",
      serviceId: "cut",
      staffId: "alex",
      date,
      status: "waiting",
    },
    "waiting",
  );
  assert.equal(matchWaitlist(db, { enabled: true }), 1);
  const message = db
    .prepare("SELECT body FROM outbox WHERE dedupe='waitlist:waiting'")
    .get();
  const raw = message.body.split("#")[1];
  const result = claimWaitlist(db, raw);
  assert.equal(result.manageToken.length, 48);
  assert.throws(() => claimWaitlist(db, raw), /expired/);
  assert.equal(get(db, "waitlist", "waiting").status, "booked");
  put(
    db,
    "waitlist",
    {
      name: "Expired",
      email: "expired@example.com",
      locationId: "south-end",
      serviceId: "cut",
      staffId: "jordan",
      date,
      status: "waiting",
    },
    "expiring",
  );
  const clock = Date.now();
  assert.equal(matchWaitlist(db, { enabled: true, now: clock }), 1);
  const held = get(db, "waitlist", "expiring");
  assert.ok(get(db, "blocks", held.holdId));
  matchWaitlist(db, { enabled: false, now: clock + 16 * 60000 });
  assert.equal(get(db, "blocks", held.holdId), undefined);
  assert.equal(get(db, "waitlist", "expiring").status, "expired");
  db.close();
});

import { emailWebhook } from "../lib/delivery-webhooks.mjs";
import { Webhook } from "svix";
test("email callbacks verify signatures and suppress bounced marketing recipients", () => {
  const { db } = fixture();
  const c = get(db, "clients", "client-0");
  put(db, "clients", { ...c, marketingConsent: true }, c.id);
  const message = enqueue(db, {
    to: c.email,
    subject: "Test",
    body: "Hello",
    clientId: c.id,
  });
  db.prepare(
    "UPDATE outbox SET provider_id='provider-test',status='sent' WHERE id=?",
  ).run(message);
  const secret = "whsec_" + Buffer.alloc(32, 7).toString("base64"),
    raw = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "provider-test" },
    }),
    timestamp = new Date();
  const signature = new Webhook(secret).sign("msg_test", timestamp, raw);
  const headers = {
    "svix-id": "msg_test",
    "svix-timestamp": String(Math.floor(+timestamp / 1000)),
    "svix-signature": signature,
  };
  assert.throws(() =>
    emailWebhook(db, raw, { ...headers, "svix-signature": "v1,wrong" }, secret),
  );
  emailWebhook(db, raw, headers, secret);
  assert.equal(get(db, "clients", c.id).marketingConsent, false);
  assert.equal(
    db.prepare("SELECT status FROM outbox WHERE id=?").get(message).status,
    "bounced",
  );
  assert.equal(emailWebhook(db, raw, headers, secret).duplicate, true);
  db.close();
});

import { bookSeries } from "../db.mjs";
import { extendRecurrences } from "../lib/recurrence.mjs";
import { seal, unseal } from "../lib/security.mjs";
test("rolling recurrence extends the booking horizon without duplicates", () => {
  const db = openDB(":memory:");
  seed(db);
  bookSeries(
    db,
    {
      locationId: "south-end",
      staffId: "marcus",
      serviceId: "cut",
      clientId: "client-0",
      start: "2026-11-10T15:00:00Z",
      repeatCount: 1,
      repeatWeeks: 1,
      repeatForever: true,
    },
    { now: new Date("2026-11-09T12:00:00Z") },
  );
  const count = extendRecurrences(db, {
    now: new Date("2026-11-09T12:00:00Z"),
  });
  assert.ok(count > 1);
  assert.equal(
    extendRecurrences(db, { now: new Date("2026-11-09T12:00:00Z") }),
    0,
  );
  assert.equal(list(db, "recurrences").length, 1);
  db.close();
});
test("authenticator secrets can be encrypted at rest", () => {
  const prior = process.env.APP_SECRET;
  process.env.APP_SECRET = "a".repeat(64);
  try {
    const value = seal("TEST-SECRET");
    assert.ok(value.startsWith("enc:"));
    assert.ok(!value.includes("TEST-SECRET"));
    assert.equal(unseal(value), "TEST-SECRET");
  } finally {
    if (prior === undefined) delete process.env.APP_SECRET;
    else process.env.APP_SECRET = prior;
  }
});

import { issueGift } from "../lib/commerce.mjs";
test("gift cash issuance has a liability ledger and only unused cards can be refunded", () => {
  const { db, a } = fixture();
  const card = issueGift(db, {
    name: "Gift",
    code: "CASHGIFT123",
    balance: 5000,
  });
  const issue = db.prepare("SELECT * FROM orders WHERE kind='giftcard'").get();
  assert.equal(issue.status, "paid");
  assert.equal(
    db.prepare("SELECT amount FROM tenders WHERE order_id=?").get(issue.id)
      .amount,
    5000,
  );
  const sale = createOrder(db, { appointmentId: a.id }, "gift-funded-visit");
  settle(db, sale.id, [
    { method: "giftcard", code: card.code, amount: sale.total },
  ]);
  assert.throws(() => refundLocal(db, issue.id, "Unused card"), /redeemed/);
  refundLocal(db, sale.id, "Visit refunded");
  refundLocal(db, issue.id, "Unused card");
  assert.equal(get(db, "giftcards", card.id).balance, 0);
  db.close();
});
test("pending card session rejects cash; payment failure releases reserved stock exactly once", async () => {
  const { db } = fixture(),
    p = list(db, "products")[0];
  const o = createOrder(
    db,
    { locationId: "south-end", items: [{ productId: p.id, quantity: 1 }] },
    "async-stock-order",
  );
  db.prepare("UPDATE orders SET stripe_session='cs_failure' WHERE id=?").run(
    o.id,
  );
  assert.throws(
    () => settle(db, o.id, [{ method: "cash", amount: o.total }]),
    /in progress/,
  );
  const e = {
    id: "evt_async_failure",
    type: "checkout.session.async_payment_failed",
    data: { object: { id: "cs_failure" } },
  };
  await handleStripeEvent(db, e, {});
  await handleStripeEvent(db, e, {});
  assert.equal(stockLevel(db, p.id, "south-end"), p.stock);
  assert.equal(
    db.prepare("SELECT status FROM orders WHERE id=?").get(o.id).status,
    "cancelled",
  );
  db.close();
});
import Stripe from "stripe";
test("Stripe raw payload signature rejects tampering before event handling", () => {
  const stripe = new Stripe("sk_test_signature_only"),
    secret = "whsec_local_test";
  const raw = JSON.stringify({
    id: "evt_signed",
    type: "checkout.session.completed",
    data: { object: { id: "cs_signed", payment_status: "paid" } },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret,
  });
  assert.equal(
    stripe.webhooks.constructEvent(raw, header, secret).id,
    "evt_signed",
  );
  assert.throws(() =>
    stripe.webhooks.constructEvent(
      raw.replace("paid", "unpaid"),
      header,
      secret,
    ),
  );
});

import { createDeposit } from "../lib/commerce.mjs";
test("deposits apply once to checkout and refunds restore the prepaid balance", () => {
  const { db, a } = fixture();
  const deposit = createDeposit(db, a.id, 2000, "deposit-idempotency");
  assert.equal(
    createDeposit(db, a.id, 2000, "deposit-idempotency").id,
    deposit.id,
  );
  assert.throws(
    () => createOrder(db, { appointmentId: a.id }, "pending-deposit-final"),
    /deposit order/,
  );
  settle(db, deposit.id, [{ method: "cash", amount: 2000 }]);
  assert.equal(get(db, "clients", a.client_id).points, 0);
  assert.equal(
    db.prepare("SELECT status FROM appointments WHERE id=?").get(a.id).status,
    "confirmed",
  );
  const final = createOrder(db, { appointmentId: a.id }, "deposit-final-sale");
  assert.equal(final.total, a.price - 2000);
  assert.throws(
    () => refundLocal(db, deposit.id, "Refund deposit"),
    /final checkout/,
  );
  settle(db, final.id, [{ method: "cash", amount: final.total }]);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM tenders WHERE method='deposit'").get().n,
    1,
  );
  assert.throws(
    () => refundLocal(db, deposit.id, "Refund deposit"),
    /final checkout/,
  );
  refundLocal(db, final.id, "Refund visit");
  refundLocal(db, deposit.id, "Refund deposit");
  assert.equal(
    db.prepare("SELECT status FROM orders WHERE id=?").get(deposit.id).status,
    "refunded",
  );
  db.close();
});

import { checkoutLink, requestRefund } from "../lib/payments.mjs";
test("checkout creation reserves payment ownership before awaiting Stripe", async () => {
  const { db, a } = fixture(),
    o = createOrder(db, { appointmentId: a.id }, "provider-creation-race");
  const gate = Promise.withResolvers();
  let parameters;
  const pending = checkoutLink(db, o.id, {
    checkout: {
      sessions: {
        create: async (p) => {
          parameters = p;
          return gate.promise;
        },
      },
    },
  });
  assert.throws(
    () => settle(db, o.id, [{ method: "cash", amount: o.total }]),
    /in progress/,
  );
  gate.resolve({ id: "cs_created", url: "https://checkout.stripe.com/test" });
  await pending;
  assert.equal(
    db.prepare("SELECT stripe_session FROM orders WHERE id=?").get(o.id)
      .stripe_session,
    "cs_created",
  );
  assert.equal(parameters.line_items[0].price_data.unit_amount, o.total);
  db.close();
});
test("an applied card deposit cannot reach the provider refund API", async () => {
  const { db, a } = fixture(),
    d = createDeposit(db, a.id, 2000, "protected-card-deposit");
  settle(db, d.id, [{ method: "card", amount: 2000 }], {
    providerVerified: true,
    paymentIntent: "pi_deposit",
  });
  createOrder(db, { appointmentId: a.id }, "protected-final-order");
  let called = false;
  await assert.rejects(
    requestRefund(db, d.id, "Refund", {
      refunds: {
        create: async () => {
          called = true;
          return { status: "succeeded", id: "re_test" };
        },
      },
    }),
    /final checkout/,
  );
  assert.equal(called, false);
  db.close();
});

test("a paid webhook arriving before Checkout creation returns is reconciled", async () => {
  const { db, a } = fixture(),
    o = createOrder(db, { appointmentId: a.id }, "webhook-before-response");
  const provider = {
    checkout: {
      sessions: {
        create: async () => {
          await handleStripeEvent(
            db,
            {
              id: "evt_early",
              type: "checkout.session.completed",
              data: {
                object: {
                  id: "cs_early",
                  metadata: { chairside_order_id: o.id },
                  payment_status: "paid",
                  amount_total: o.total,
                  currency: "usd",
                  payment_intent: "pi_early",
                },
              },
            },
            {},
          );
          return { id: "cs_early", url: "https://checkout.stripe.com/test" };
        },
      },
    },
  };
  await checkoutLink(db, o.id, provider);
  assert.equal(
    db.prepare("SELECT status FROM orders WHERE id=?").get(o.id).status,
    "paid",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM tenders WHERE order_id=?").get(o.id).n,
    1,
  );
  db.close();
});
