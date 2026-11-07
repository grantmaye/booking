import { id, get, list, put, transaction } from "../db.mjs";
import { createHash } from "node:crypto";
const now = () => new Date().toISOString();
export function integer(n, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw Error("Invalid amount or quantity.");
  return n;
}
export function stockLevel(db, productId, locationId) {
  if (!get(db, "products", productId) || !get(db, "locations", locationId))
    throw Error("Invalid product or location.");
  const first = list(db, "locations")[0]?.id;
  db.prepare("INSERT OR IGNORE INTO stock VALUES(?,?,?)").run(
    productId,
    locationId,
    locationId === first ? get(db, "products", productId).stock : 0,
  );
  return db
    .prepare("SELECT quantity FROM stock WHERE product_id=? AND location_id=?")
    .get(productId, locationId).quantity;
}
export function moveStock(
  db,
  productId,
  locationId,
  delta,
  reason,
  reference = null,
) {
  integer(Math.abs(delta));
  const old = stockLevel(db, productId, locationId);
  if (old + delta < 0) throw Error("Insufficient inventory.");
  db.prepare(
    "UPDATE stock SET quantity=quantity+? WHERE product_id=? AND location_id=?",
  ).run(delta, productId, locationId);
  db.prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)").run(
    id(),
    productId,
    locationId,
    delta,
    reason,
    reference,
    now(),
  );
  const p = get(db, "products", productId);
  put(
    db,
    "products",
    {
      ...p,
      stock: db
        .prepare("SELECT SUM(quantity) n FROM stock WHERE product_id=?")
        .get(productId).n,
    },
    productId,
  );
}
export function quote(db, input) {
  const a = input.appointmentId
    ? db
        .prepare("SELECT * FROM appointments WHERE id=?")
        .get(input.appointmentId)
    : null;
  if (
    input.appointmentId &&
    (!a || !["confirmed", "checked-in"].includes(a.status))
  )
    throw Error("Appointment cannot be checked out.");
  const locationId = a?.location_id || input.locationId;
  if (!get(db, "locations", locationId)) throw Error("Choose a location.");
  const items = [];
  if (a)
    items.push({
      kind: "service",
      id: a.service_id,
      name: get(db, "services", a.service_id)?.name || "Service",
      quantity: 1,
      unitPrice: a.price,
    });
  for (const item of input.items || []) {
    const p = get(db, "products", item.productId);
    integer(item.quantity, 1, 1000);
    if (!p || stockLevel(db, p.id, locationId) < item.quantity)
      throw Error("Insufficient inventory.");
    items.push({
      kind: "product",
      id: p.id,
      name: p.name,
      quantity: item.quantity,
      unitPrice: p.price,
    });
  }
  if (!items.length || items.length > 30)
    throw Error("Choose services or products.");
  const subtotal = items.reduce((n, i) => n + i.quantity * i.unitPrice, 0);
  let discount = 0;
  let promotion = null;
  if (input.promoCode) {
    promotion = list(db, "promotions").find(
      (p) => p.code === input.promoCode.toUpperCase() && p.active,
    );
    if (
      !promotion ||
      (promotion.expires && Date.parse(promotion.expires) < Date.now()) ||
      (promotion.maxUses && promotion.uses >= promotion.maxUses)
    )
      throw Error("Promotion is invalid or expired.");
    discount =
      promotion.type === "percent"
        ? Math.round((subtotal * promotion.value) / 100)
        : promotion.value;
  }
  let membership = null;
  if (input.subscriptionId) {
    membership = db
      .prepare("SELECT * FROM subscriptions_v2 WHERE id=?")
      .get(input.subscriptionId);
    const plan = membership && get(db, "memberships", membership.plan_id);
    if (
      !a ||
      membership?.client_id !== a.client_id ||
      membership.status !== "active" ||
      membership.credits < 1 ||
      !plan ||
      (plan.serviceIds?.length && !plan.serviceIds.includes(a.service_id))
    )
      throw Error("Membership cannot cover this visit.");
    discount += a.price;
  }
  const clientId = a?.client_id || input.clientId || null;
  let loyalty = integer(Number(input.loyaltyPoints || 0));
  if (loyalty) {
    const c = get(db, "clients", clientId);
    if (!c || c.points < loyalty) throw Error("Insufficient loyalty points.");
    discount += loyalty;
  }
  discount = Math.min(subtotal, discount);
  const settings = get(db, "settings", "business");
  const taxRate = Number(
    get(db, "locations", locationId).taxBasisPoints ??
      settings.taxBasisPoints ??
      0,
  );
  integer(taxRate, 0, 5000);
  const tax = Math.round(((subtotal - discount) * taxRate) / 10000),
    tip = integer(Number(input.tip || 0), 0, 100000);
  const deposits = a
    ? db
        .prepare(
          "SELECT * FROM orders WHERE kind='deposit' AND status='paid' AND json_extract(details,'$.depositAppointmentId')=? AND id NOT IN (SELECT entity_id FROM ledger WHERE kind='deposit-applied')",
        )
        .all(a.id)
    : [];
  if (
    a &&
    db
      .prepare(
        "SELECT id FROM orders WHERE kind='deposit' AND status='pending' AND json_extract(details,'$.depositAppointmentId')=?",
      )
      .get(a.id)
  )
    throw Error("Finish or cancel the deposit order before final checkout.");
  if (deposits.some((o) => get(db, "refundLocks", o.id)))
    throw Error(
      "A deposit refund is being reconciled. Finish it before checkout.",
    );
  const depositTotal = deposits.reduce((n, o) => n + o.total, 0);
  if (depositTotal > subtotal - discount + tax + tip)
    throw Error("Refund excess deposits before applying this discount.");
  return {
    deposits: deposits.map((o) => ({ id: o.id, amount: o.total })),
    depositTotal,
    appointmentId: a?.id || null,
    clientId,
    locationId,
    items,
    subtotal,
    discount,
    tax,
    tip,
    total: subtotal - discount + tax + tip - depositTotal,
    promotionId: promotion?.id || null,
    subscriptionId: membership?.id || null,
    loyaltyPoints: loyalty,
  };
}
export function createOrder(db, input, key) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key || ""))
    throw Error("An idempotency key is required.");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return transaction(db, () => {
    const prior = db
      .prepare("SELECT * FROM idempotency WHERE key=?")
      .get("order:" + key);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw Error("Idempotency key was already used for a different order.");
      return db
        .prepare("SELECT * FROM orders WHERE id=?")
        .get(JSON.parse(prior.response).id);
    }
    const q = quote(db, input),
      orderId = id();
    for (const item of q.items)
      if (item.kind === "product")
        moveStock(
          db,
          item.id,
          q.locationId,
          -item.quantity,
          "reserved",
          orderId,
        );
    db.prepare(
      "INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      orderId,
      q.appointmentId,
      q.clientId,
      q.locationId,
      "sale",
      q.subtotal,
      q.discount,
      q.tax,
      q.tip,
      q.total,
      "pending",
      JSON.stringify(q),
      null,
      null,
      null,
      now(),
    );
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    db.prepare("INSERT INTO idempotency VALUES(?,?,?,?,?)").run(
      "order:" + key,
      "order",
      fingerprint,
      JSON.stringify({ id: orderId }),
      Date.now(),
    );
    return order;
  });
}
export function settle(
  db,
  orderId,
  tenders,
  { providerVerified = false, paymentIntent = null } = {},
) {
  return transaction(db, () => {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if (!order) throw Error("Order not found.");
    if (order.status === "paid") return order;
    if (order.status !== "pending") throw Error("Order is not payable.");
    if (order.stripe_session && !providerVerified)
      throw Error(
        "An online payment is in progress. Wait for the signed webhook to confirm completion or expiration.",
      );
    const q = JSON.parse(order.details);
    if (
      !Array.isArray(tenders) ||
      tenders.length > 10 ||
      tenders.reduce((n, t) => n + integer(t.amount), 0) !== order.total
    )
      throw Error("Tender amounts must exactly match the total.");
    if (
      order.appointment_id &&
      db
        .prepare("SELECT status FROM appointments WHERE id=?")
        .get(order.appointment_id).status === "completed"
    )
      throw Error("Appointment is already paid.");
    for (const t of tenders) {
      if (t.method === "card" && !providerVerified)
        throw Error("Card payments must be confirmed by the signed webhook.");
      if (!["cash", "card", "giftcard"].includes(t.method))
        throw Error("Invalid tender.");
      if (t.method === "giftcard") {
        const card = list(db, "giftcards").find(
          (c) => c.code === String(t.code || "").toUpperCase(),
        );
        if (!card || card.balance < t.amount)
          throw Error("Gift card balance is insufficient.");
        put(
          db,
          "giftcards",
          { ...card, balance: card.balance - t.amount },
          card.id,
        );
        db.prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?)").run(
          id(),
          "giftcard",
          card.id,
          -t.amount,
          orderId,
          now(),
        );
        t.reference = card.id;
      }
      db.prepare("INSERT INTO tenders VALUES(?,?,?,?,?,?)").run(
        id(),
        orderId,
        t.method,
        t.amount,
        t.reference || paymentIntent,
        now(),
      );
    }
    for (const deposit of q.deposits || []) {
      if (
        get(db, "refundLocks", deposit.id) ||
        db
          .prepare(
            "SELECT id FROM ledger WHERE kind='deposit-applied' AND entity_id=?",
          )
          .get(deposit.id) ||
        db.prepare("SELECT status FROM orders WHERE id=?").get(deposit.id)
          ?.status !== "paid"
      )
        throw Error("Deposit is no longer available.");
      db.prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?)").run(
        id(),
        "deposit-applied",
        deposit.id,
        deposit.amount,
        orderId,
        now(),
      );
      db.prepare("INSERT INTO tenders VALUES(?,?,?,?,?,?)").run(
        id(),
        orderId,
        "deposit",
        deposit.amount,
        deposit.id,
        now(),
      );
    }
    if (q.subscriptionId) {
      const updated = db
        .prepare(
          "UPDATE subscriptions_v2 SET credits=credits-1 WHERE id=? AND status='active' AND credits>0",
        )
        .run(q.subscriptionId);
      if (!updated.changes)
        throw Error("Membership credits are no longer available.");
    }
    if (q.promotionId) {
      const p = get(db, "promotions", q.promotionId);
      if (!p?.active || (p.maxUses && p.uses >= p.maxUses))
        throw Error("Promotion is no longer available.");
      put(db, "promotions", { ...p, uses: (p.uses || 0) + 1 }, p.id);
    }
    // Product stock was reserved when the order was created.
    if (q.clientId && order.kind !== "deposit") {
      const c = get(db, "clients", q.clientId);
      if (c.points < q.loyaltyPoints)
        throw Error("Loyalty balance has changed.");
      const earned = Math.floor((order.subtotal - order.discount) / 100);
      put(
        db,
        "clients",
        { ...c, points: c.points - q.loyaltyPoints + earned },
        c.id,
      );
      db.prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?)").run(
        id(),
        "loyalty",
        c.id,
        earned - q.loyaltyPoints,
        orderId,
        now(),
      );
    }
    if (order.appointment_id) {
      db.prepare("INSERT INTO payments VALUES(?,?,?,?,?,?,?)").run(
        id(),
        order.appointment_id,
        order.subtotal - order.discount + order.tax,
        order.tip,
        order.total,
        tenders.map((t) => t.method).join("+"),
        now(),
      );
      if (!providerVerified)
        db.prepare("UPDATE appointments SET status='completed' WHERE id=?").run(
          order.appointment_id,
        );
    }
    db.prepare(
      "UPDATE orders SET status='paid',stripe_payment=? WHERE id=?",
    ).run(paymentIntent, orderId);
    return db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  });
}
export function refundLocal(
  db,
  orderId,
  reason,
  { providerVerified = false, providerId = null } = {},
) {
  return transaction(db, () => {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if (!order || order.status !== "paid")
      throw Error("Only paid orders can be refunded once.");
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
    const tenders = db
      .prepare("SELECT * FROM tenders WHERE order_id=?")
      .all(orderId);
    if (tenders.some((t) => t.method === "card") && !providerVerified)
      throw Error("Card refund requires provider confirmation.");
    if (!reason?.trim()) throw Error("A refund reason is required.");
    if (order.kind === "giftcard") {
      const item = JSON.parse(order.details).items[0],
        card = get(db, "giftcards", item.id);
      if (!card || card.balance !== order.total)
        throw Error("A redeemed gift card cannot be refunded as an issuance.");
      put(db, "giftcards", { ...card, balance: 0 }, card.id);
      db.prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?)").run(
        id(),
        "giftcard",
        card.id,
        -order.total,
        "refund:" + orderId,
        now(),
      );
    }
    const refundId = id();
    db.prepare("INSERT INTO refunds VALUES(?,?,?,?,?,?,?)").run(
      refundId,
      orderId,
      order.total,
      reason,
      "succeeded",
      providerId,
      now(),
    );
    for (const t of tenders)
      if (t.method === "giftcard") {
        const card = get(db, "giftcards", t.reference);
        put(
          db,
          "giftcards",
          { ...card, balance: card.balance + t.amount },
          card.id,
        );
        db.prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?)").run(
          id(),
          "giftcard",
          card.id,
          t.amount,
          "refund:" + orderId,
          now(),
        );
      }
    const q = JSON.parse(order.details);
    db.prepare(
      "DELETE FROM ledger WHERE kind='deposit-applied' AND reference=?",
    ).run(orderId);
    for (const item of q.items)
      if (item.kind === "product")
        moveStock(
          db,
          item.id,
          order.location_id,
          item.quantity,
          "return",
          orderId,
        );
    if (q.subscriptionId)
      db.prepare(
        "UPDATE subscriptions_v2 SET credits=credits+1 WHERE id=?",
      ).run(q.subscriptionId);
    if (q.clientId) {
      const c = get(db, "clients", q.clientId);
      const entry = db
        .prepare(
          "SELECT delta FROM ledger WHERE kind='loyalty' AND entity_id=? AND reference=?",
        )
        .get(c.id, orderId);
      put(
        db,
        "clients",
        { ...c, points: Math.max(0, c.points - (entry?.delta || 0)) },
        c.id,
      );
    }
    db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(orderId);
    db.prepare("DELETE FROM records WHERE kind='refundLocks' AND id=?").run(
      orderId,
    );
    return { id: refundId, status: "refunded" };
  });
}
export function receivePurchase(db, poId) {
  return transaction(db, () => {
    const p = get(db, "purchaseOrders", poId);
    if (!p || p.status === "received")
      throw Error("Purchase order cannot be received.");
    for (const item of p.items) {
      integer(item.quantity, 1);
      moveStock(
        db,
        item.productId,
        p.locationId,
        item.quantity,
        "purchase receipt",
        poId,
      );
    }
    return put(
      db,
      "purchaseOrders",
      { ...p, status: "received", received: now() },
      p.id,
    );
  });
}

export function cancelOrder(db, orderId) {
  return transaction(db, () => {
    const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if (!order || order.status !== "pending" || order.stripe_session)
      throw Error(
        "Only pending orders without a payment session can be cancelled.",
      );
    for (const item of JSON.parse(order.details).items)
      if (item.kind === "product")
        moveStock(
          db,
          item.id,
          order.location_id,
          item.quantity,
          "reservation released",
          order.id,
        );
    db.prepare(
      "UPDATE orders SET status='cancelled',appointment_id=NULL WHERE id=?",
    ).run(order.id);
    return { ok: true };
  });
}

// Gift-card cash receipts are liabilities, kept separate from earned service revenue.
export function issueGift(db, input) {
  return transaction(db, () => {
    integer(input.balance, 100, 100000);
    const code = String(input.code || "").toUpperCase();
    if (!/^[A-Z0-9-]{8,40}$/.test(code) || !input.name?.trim())
      throw Error("Enter a recipient and an 8–40 character gift code.");
    const locationId = input.locationId || list(db, "locations")[0]?.id;
    if (!get(db, "locations", locationId)) throw Error("Choose a location.");
    const card = put(db, "giftcards", {
      name: input.name.trim(),
      code,
      balance: input.balance,
    });
    const orderId = id(),
      details = {
        items: [
          {
            kind: "giftcard",
            id: card.id,
            name: "Gift card · " + card.name,
            quantity: 1,
            unitPrice: input.balance,
          },
        ],
      };
    db.prepare(
      "INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      orderId,
      null,
      null,
      locationId,
      "giftcard",
      input.balance,
      0,
      0,
      0,
      input.balance,
      "paid",
      JSON.stringify(details),
      null,
      null,
      null,
      now(),
    );
    db.prepare("INSERT INTO tenders VALUES(?,?,?,?,?,?)").run(
      id(),
      orderId,
      "cash",
      input.balance,
      null,
      now(),
    );
    db.prepare("INSERT INTO ledger VALUES(?,?,?,?,?,?)").run(
      id(),
      "giftcard",
      card.id,
      input.balance,
      orderId,
      now(),
    );
    return card;
  });
}

export function createDeposit(db, appointmentId, amount, key) {
  return transaction(db, () => {
    integer(amount, 100, 100000);
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key || ""))
      throw Error("An idempotency key is required.");
    const orderId = "deposit-" + key,
      prior = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if (prior) {
      if (
        prior.total !== amount ||
        JSON.parse(prior.details).depositAppointmentId !== appointmentId
      )
        throw Error("Idempotency key reused.");
      return prior;
    }
    const a = db
      .prepare("SELECT * FROM appointments WHERE id=?")
      .get(appointmentId);
    if (!a || a.status !== "confirmed")
      throw Error("Choose a confirmed appointment.");
    if (db.prepare("SELECT id FROM orders WHERE appointment_id=?").get(a.id))
      throw Error("Checkout already exists.");
    const existing = db
      .prepare(
        "SELECT COALESCE(SUM(total),0) total FROM orders WHERE kind='deposit' AND status IN ('paid','pending') AND json_extract(details,'$.depositAppointmentId')=?",
      )
      .get(a.id).total;
    if (existing + amount > a.price)
      throw Error("Deposits cannot exceed the service price.");
    const details = {
      depositAppointmentId: a.id,
      clientId: a.client_id,
      loyaltyPoints: 0,
      items: [
        {
          kind: "deposit",
          name: "Appointment deposit",
          quantity: 1,
          unitPrice: amount,
        },
      ],
    };
    db.prepare(
      "INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      orderId,
      null,
      a.client_id,
      a.location_id,
      "deposit",
      amount,
      0,
      0,
      0,
      amount,
      "pending",
      JSON.stringify(details),
      null,
      null,
      null,
      now(),
    );
    return db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  });
}
