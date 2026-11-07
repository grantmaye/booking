import Stripe from "stripe";
import { id, get, put, transaction } from "../db.mjs";
import { settle, refundLocal, cancelOrder } from "./commerce.mjs";
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw Object.assign(Error("Stripe is not configured."), { status: 503 });
  return new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
}
function origin() {
  if (
    !process.env.PUBLIC_ORIGIN?.startsWith("https://") &&
    process.env.NODE_ENV === "production"
  )
    throw Error("A public HTTPS origin is required.");
  return process.env.PUBLIC_ORIGIN || "http://127.0.0.1:3000";
}
export async function checkoutLink(db, orderId, client = stripeClient()) {
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if (!order || order.status !== "pending")
    throw Error("Order cannot be paid.");
  const details = JSON.parse(order.details);
  if (details.subscriptionId || details.loyaltyPoints || details.promotionId)
    throw Error(
      "Membership, promotion and loyalty redemptions must be checked out at the studio.",
    );
  if (order.stripe_session && !order.stripe_session.startsWith("creating:")) {
    const previous = await client.checkout.sessions.retrieve(
      order.stripe_session,
    );
    if (previous.status === "open") return { url: previous.url };
    throw Error(
      "Checkout session is no longer open. Reconcile the payment before retrying.",
    );
  }
  const request = transaction(db, () => {
    const prior = get(db, "checkoutRequests", orderId);
    db.prepare(
      "UPDATE orders SET stripe_session=? WHERE id=? AND (stripe_session IS NULL OR stripe_session LIKE 'creating:%') AND status='pending'",
    ).run("creating:" + orderId, orderId);
    return (
      prior ||
      put(
        db,
        "checkoutRequests",
        { expiresAt: Math.floor(Date.now() / 1000) + 1800 },
        orderId,
      )
    );
  });
  const session = await client.checkout.sessions.create(
    {
      mode: "payment",
      metadata: { chairside_order_id: orderId },
      integration_identifier: "chairside-booking-abcdwxyz",
      expires_at: request.expiresAt,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: order.total,
            product_data: { name: "Chairside visit · " + orderId.slice(0, 8) },
          },
          quantity: 1,
        },
      ],
      success_url: origin() + "/portal?payment=received",
      cancel_url: origin() + "/portal?payment=cancelled",
    },
    { idempotencyKey: "order-" + orderId },
  );
  db.prepare("UPDATE orders SET stripe_session=? WHERE id=?").run(
    session.id,
    orderId,
  );
  return { url: session.url };
}
export async function membershipLink(
  db,
  clientId,
  planId,
  client = stripeClient(),
) {
  const plan = get(db, "memberships", planId),
    person = get(db, "clients", clientId);
  if (!plan?.active || !person) throw Error("Invalid membership.");
  if (!plan.stripePriceId)
    throw Error("Configure this plan’s Stripe Price ID.");
  const key = id();
  db.prepare("INSERT INTO subscriptions_v2 VALUES(?,?,?,?,?,?,?,?)").run(
    key,
    clientId,
    planId,
    null,
    "pending",
    0,
    null,
    new Date().toISOString(),
  );
  const session = await client.checkout.sessions.create(
    {
      mode: "subscription",
      client_reference_id: key,
      integration_identifier: "chairside-members-abcdwxyz",
      customer_email: person.email,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: origin() + "/portal?membership=received",
      cancel_url: origin() + "/portal",
    },
    { idempotencyKey: "membership-" + key },
  );
  put(
    db,
    "subscriptionSessions",
    { subscriptionId: key, sessionId: session.id },
    session.id,
  );
  return { url: session.url };
}
export async function handleStripeEvent(db, event, client = stripeClient()) {
  if (db.prepare("SELECT id FROM webhook_events WHERE id=?").get(event.id))
    return { duplicate: true };
  const object = event.data.object;
  let resolved = object;
  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed"
  ) {
    const sub =
      object.parent?.subscription_details?.subscription || object.subscription;
    if (sub)
      resolved = {
        invoice: object,
        subscription: await client.subscriptions.retrieve(
          typeof sub === "string" ? sub : sub.id,
        ),
      };
  }
  return transaction(db, () => {
    if (db.prepare("SELECT id FROM webhook_events WHERE id=?").get(event.id))
      return { duplicate: true };
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type) &&
      object.payment_status === "paid"
    ) {
      let order = db
        .prepare("SELECT * FROM orders WHERE stripe_session=?")
        .get(object.id);
      if (!order && object.metadata?.chairside_order_id) {
        const candidate = db
          .prepare(
            "SELECT * FROM orders WHERE id=? AND (stripe_session IS NULL OR stripe_session LIKE 'creating:%') AND status='pending'",
          )
          .get(object.metadata.chairside_order_id);
        if (candidate) {
          db.prepare("UPDATE orders SET stripe_session=? WHERE id=?").run(
            object.id,
            candidate.id,
          );
          order = candidate;
        }
      }
      if (order) {
        if (object.amount_total !== order.total || object.currency !== "usd")
          throw Error("Payment amount mismatch.");
        settle(db, order.id, [{ method: "card", amount: order.total }], {
          providerVerified: true,
          paymentIntent:
            typeof object.payment_intent === "string"
              ? object.payment_intent
              : object.payment_intent?.id,
        });
      }
      let mapping = get(db, "subscriptionSessions", object.id);
      if (
        !mapping &&
        object.client_reference_id &&
        db
          .prepare(
            "SELECT id FROM subscriptions_v2 WHERE id=? AND stripe_id IS NULL",
          )
          .get(object.client_reference_id)
      )
        mapping = { subscriptionId: object.client_reference_id };
      if (mapping)
        db.prepare(
          "UPDATE subscriptions_v2 SET stripe_id=?,status=? WHERE id=?",
        ).run(
          typeof object.subscription === "string"
            ? object.subscription
            : object.subscription?.id,
          "active",
          mapping.subscriptionId,
        );
    }
    if (event.type === "checkout.session.expired") {
      const order = db
        .prepare(
          "SELECT * FROM orders WHERE stripe_session=? AND status='pending'",
        )
        .get(object.id);
      if (order) {
        db.prepare("UPDATE orders SET stripe_session=NULL WHERE id=?").run(
          order.id,
        );
        cancelOrder(db, order.id);
      }
    }
    if (event.type === "checkout.session.async_payment_failed") {
      const order = db
        .prepare(
          "SELECT * FROM orders WHERE stripe_session=? AND status='pending'",
        )
        .get(object.id);
      if (order) {
        db.prepare("UPDATE orders SET stripe_session=NULL WHERE id=?").run(
          order.id,
        );
        cancelOrder(db, order.id);
      }
    }
    if (event.type === "invoice.paid" && resolved.subscription) {
      const sub = db
        .prepare("SELECT * FROM subscriptions_v2 WHERE stripe_id=?")
        .get(resolved.subscription.id);
      if (sub && !get(db, "membershipInvoices", resolved.invoice.id)) {
        put(
          db,
          "membershipInvoices",
          { subscriptionId: sub.id },
          resolved.invoice.id,
        );
        const plan = get(db, "memberships", sub.plan_id);
        db.prepare(
          "UPDATE subscriptions_v2 SET status='active',credits=?,period_end=? WHERE id=?",
        ).run(
          plan.credits,
          new Date(
            (resolved.subscription.items?.data?.[0]?.current_period_end ||
              resolved.invoice.period_end) * 1000,
          ).toISOString(),
          sub.id,
        );
      } else if (!sub)
        throw Error("Membership checkout mapping not ready; retry this event.");
    }
    if (event.type === "invoice.payment_failed" && resolved.subscription)
      db.prepare(
        "UPDATE subscriptions_v2 SET status='past_due' WHERE stripe_id=?",
      ).run(resolved.subscription.id);
    if (
      [
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)
    )
      db.prepare("UPDATE subscriptions_v2 SET status=? WHERE stripe_id=?").run(
        event.type.endsWith("deleted") ? "cancelled" : object.status,
        object.id,
      );
    if (event.type === "charge.refunded" && object.refunded) {
      const order = db
        .prepare("SELECT id FROM orders WHERE stripe_payment=?")
        .get(
          typeof object.payment_intent === "string"
            ? object.payment_intent
            : object.payment_intent?.id,
        );
      if (
        order &&
        db.prepare("SELECT status FROM orders WHERE id=?").get(order.id)
          .status === "paid"
      )
        refundLocal(db, order.id, "Stripe refund", {
          providerVerified: true,
          providerId: object.refunds?.data?.[0]?.id || object.id,
        });
    }
    if (
      ["charge.dispute.created", "radar.early_fraud_warning.created"].includes(
        event.type,
      )
    )
      put(db, "riskAlerts", {
        name: event.type,
        providerId: object.id,
        status: "review",
        created: new Date().toISOString(),
      });
    db.prepare("INSERT INTO webhook_events VALUES(?,?,?)").run(
      event.id,
      event.type,
      new Date().toISOString(),
    );
    return { received: true };
  });
}
export async function requestRefund(
  db,
  orderId,
  reason,
  client = stripeClient(),
) {
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if (!order || order.status !== "paid" || !order.stripe_payment)
    throw Error("No refundable card payment found.");
  if (!reason?.trim()) throw Error("Enter a reason.");
  transaction(db, () => {
    if (
      order.kind === "deposit" &&
      (db
        .prepare(
          "SELECT id FROM ledger WHERE kind='deposit-applied' AND entity_id=?",
        )
        .get(orderId) ||
        db
          .prepare(
            "SELECT id FROM orders WHERE appointment_id=json_extract(?, '$.depositAppointmentId') AND status='pending'",
          )
          .get(order.details))
    )
      throw Error(
        "Cancel or refund final checkout before refunding this deposit.",
      );
    put(db, "refundLocks", { created: new Date().toISOString() }, orderId);
  });
  const result = await client.refunds.create(
    { payment_intent: order.stripe_payment },
    { idempotencyKey: "refund-" + orderId },
  );
  if (result.status === "succeeded")
    return refundLocal(db, orderId, reason, {
      providerVerified: true,
      providerId: result.id,
    });
  return { status: result.status, id: result.id };
}
