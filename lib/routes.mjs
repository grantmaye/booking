import { createDeposit } from "./commerce.mjs";
import { emailWebhook } from "./delivery-webhooks.mjs";
import { waitlistOffer, claimWaitlist } from "./waitlist.mjs";
import {
  id,
  get,
  list,
  put,
  transaction,
  book,
  validateSlot,
  passwordHash,
  passwordMatches,
  localParts,
  zonedInstant,
} from "../db.mjs";
import {
  access,
  requireRole,
  canAppointment,
  issueToken,
  takeToken,
  checkMFA,
  newMFA,
  rateLimit,
  token,
  seal,
} from "./security.mjs";
import {
  enqueue,
  bookingMessages,
  queueCampaign,
  unsubscribe,
  runOutbox,
} from "./messaging.mjs";
import {
  quote,
  createOrder,
  settle,
  refundLocal,
  stockLevel,
  moveStock,
  receivePurchase,
  integer,
  cancelOrder,
} from "./commerce.mjs";
import {
  stripeClient,
  checkoutLink,
  membershipLink,
  handleStripeEvent,
  requestRefund,
} from "./payments.mjs";
const managers = ["owner", "manager"],
  operators = ["owner", "manager", "receptionist"];
const cleanAppointment = ({ token, ...a }) => a;
export function scopedData(db, user, data) {
  if (["owner", "manager"].includes(user.role)) return data;
  if (user.role === "customer")
    throw Object.assign(Error("Use the customer portal."), { status: 403 });
  if (user.role === "staff") {
    const grant = access(db, user);
    data.appointments = data.appointments.filter(
      (a) => a.staff_id === grant.staff_id,
    );
    const clients = new Set(data.appointments.map((a) => a.client_id));
    data.clients = data.clients.filter((c) => clients.has(c.id));
    data.staff = data.staff.filter((s) => s.id === grant.staff_id);
    data.payments = data.payments.filter((p) =>
      data.appointments.some((a) => a.id === p.appointment_id),
    );
    data.sales = [];
    data.giftcards = [];
    data.subscriptions = [];
    data.memberships = [];
    data.campaigns = [];
    data.rent = [];
    data.audit = [];
    data.waitlist = [];
    data.notifications = [];
  }
  return data;
}
export function legacyGuard(db, user, path, method) {
  if (!user) return;
  if (user.role === "customer")
    throw Object.assign(Error("Use the customer portal."), { status: 403 });
  if (
    user.role === "staff" &&
    !(path === "/api/data" && method === "GET") &&
    !/^\/api\/appointments(?:\/[^/]+)?$/.test(path)
  )
    requireRole(user, operators);
  if (path.startsWith("/api/records/") && !operators.includes(user.role))
    requireRole(user, operators);
  if (
    path.startsWith("/api/records/") &&
    [
      "settings",
      "staff",
      "locations",
      "memberships",
      "giftcards",
      "subscriptions",
      "campaigns",
      "rent",
    ].includes(path.split("/")[3])
  )
    requireRole(user, managers);
}
export function checkAppointmentScope(db, user, input) {
  if (user.role === "staff" && input.staffId !== access(db, user).staff_id)
    requireRole(user, operators);
}
function profile(db, user) {
  const a = access(db, user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    staffId: a.staff_id,
    clientId: a.client_id,
    mfaEnabled: Boolean(a.mfa_secret),
  };
}
function validEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^\S+@\S+\.\S+$/.test(email)
  );
}
function validPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 200
  )
    throw Error("Use a password of 12–200 characters.");
}
function appointmentPolicy(db, a) {
  const pending = db
    .prepare(
      "SELECT id FROM orders WHERE (appointment_id=? OR json_extract(details,'$.depositAppointmentId')=?) AND (status='paid' OR (status='pending' AND stripe_session IS NOT NULL))",
    )
    .get(a.id, a.id);
  if (pending)
    throw Error(
      "This visit has a payment attached. Contact the studio to arrange a change or refund.",
    );
  const settings = get(db, "settings", "business");
  if (
    !["confirmed", "checked-in"].includes(a.status) ||
    Date.parse(a.start) - Date.now() < settings.cancelHours * 3600000
  )
    throw Error("Contact the studio to change this appointment.");
}
export function reschedule(db, a, start) {
  return transaction(db, () => {
    if (
      db
        .prepare(
          "SELECT id FROM orders WHERE appointment_id=? AND status='pending' AND stripe_session IS NOT NULL",
        )
        .get(a.id)
    )
      throw Error("A payment is in progress.");
    const meta = db
      .prepare("SELECT * FROM appointment_meta WHERE appointment_id=?")
      .get(a.id);
    const slot = validateSlot(
      db,
      {
        locationId: a.location_id,
        staffId: a.staff_id,
        serviceId: a.service_id,
        serviceIds: meta ? JSON.parse(meta.service_ids) : [a.service_id],
        resourceId: meta?.resource_id,
        start,
      },
      a.id,
    );
    db.prepare("UPDATE appointments SET start=?,end=? WHERE id=?").run(
      slot.start,
      slot.end,
      a.id,
    );
    db.prepare(
      "UPDATE outbox SET status='suppressed' WHERE kind=? AND status IN ('pending','retry')",
    ).run("reminder:" + a.id);
    const updated = db
      .prepare("SELECT * FROM appointments WHERE id=?")
      .get(a.id);
    bookingMessages(db, updated);
    return updated;
  });
}
export async function extendedRoute({ db, req, res, url, user, body, send }) {
  const path = url.pathname,
    method = req.method;
  const answer = (data) => {
    send(200, data);
    return true;
  };
  const data = () => body(req);
  const need = (roles) => requireRole(user, roles);
  const origin = process.env.PUBLIC_ORIGIN || "http://127.0.0.1:3000";
  if (path === "/api/health" && method === "GET") {
    db.prepare("SELECT 1").get();
    return answer({ status: "ok", version: "2.0.0" });
  }
  if (path === "/api/webhooks/email" && method === "POST") {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1000000) throw Error("Webhook too large.");
    }
    return answer(emailWebhook(db, raw, req.headers));
  }
  if (path === "/api/webhooks/stripe" && method === "POST") {
    if (!process.env.STRIPE_WEBHOOK_SECRET)
      throw Object.assign(Error("Webhook is not configured."), { status: 503 });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1000000) throw Error("Webhook too large.");
    }
    const stripe = stripeClient();
    const event = stripe.webhooks.constructEvent(
      raw,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    return answer(await handleStripeEvent(db, event, stripe));
  }
  if (path === "/api/public/register" && method === "POST") {
    rateLimit(db, "register:" + req.socket.remoteAddress, 5);
    const d = await data();
    validPassword(d.password);
    if (!validEmail(d.email) || !d.name?.trim())
      throw Error("Enter your name and a valid email.");
    if (!process.env.RESEND_API_KEY)
      throw Object.assign(
        Error(
          "Account registration requires email delivery. Ask the studio for an invitation.",
        ),
        { status: 503 },
      );
    transaction(db, () => {
      if (
        db
          .prepare("SELECT id FROM users WHERE email=?")
          .get(d.email.toLowerCase())
      )
        return;
      const key = id(),
        client = put(db, "clients", {
          name: d.name.trim(),
          email: d.email.toLowerCase(),
          phone: "",
          points: 0,
          notes: "",
          marketingConsent: false,
        });
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
        key,
        d.email.toLowerCase(),
        d.name.trim(),
        passwordHash(d.password),
        "customer",
      );
      db.prepare(
        "INSERT INTO user_access(user_id,client_id,verified) VALUES(?,?,0)",
      ).run(key, client.id);
      const t = issueToken(db, key, "verify");
      enqueue(db, {
        to: d.email,
        subject: "Verify your Chairside account",
        body: origin + "/account?action=verify#" + t,
        dedupe: "verify:" + key,
      });
    });
    return answer({ message: "Check your email to verify your account." });
  }
  if (path === "/api/public/verify" && method === "POST") {
    const d = await data();
    transaction(db, () => {
      const key = takeToken(db, d.token, "verify");
      db.prepare("UPDATE user_access SET verified=1 WHERE user_id=?").run(key);
    });
    return answer({ ok: true });
  }
  if (path === "/api/public/recover" && method === "POST") {
    rateLimit(db, "recover:" + req.socket.remoteAddress, 5);
    const d = await data();
    const person = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(String(d.email || "").toLowerCase());
    if (person && process.env.RESEND_API_KEY) {
      const t = issueToken(db, person.id, "reset", 30);
      enqueue(db, {
        to: person.email,
        subject: "Reset your Chairside password",
        body: origin + "/account?action=reset#" + t,
      });
    }
    return answer({
      message:
        "If the account exists and email is configured, a reset link has been sent.",
    });
  }
  if (path === "/api/public/reset" && method === "POST") {
    rateLimit(db, "reset:" + req.socket.remoteAddress, 10);
    const d = await data();
    validPassword(d.password);
    transaction(db, () => {
      const key = takeToken(db, d.token, d.invitation ? "invite" : "reset");
      const grant = db
        .prepare("SELECT * FROM user_access WHERE user_id=?")
        .get(key);
      if (grant?.mfa_secret && !checkMFA(grant.mfa_secret, d.code))
        throw Error("A valid authenticator code is required.");
      db.prepare("UPDATE users SET password=? WHERE id=?").run(
        passwordHash(d.password),
        key,
      );
      db.prepare("UPDATE user_access SET verified=1 WHERE user_id=?").run(key);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(key);
    });
    return answer({ ok: true });
  }
  if (path === "/api/public/unsubscribe" && method === "POST") {
    const d = await data();
    return answer(unsubscribe(db, d.clientId, d.signature));
  }
  if (path === "/api/public/waitlist/offer" && method === "POST") {
    rateLimit(db, "claim:" + req.socket.remoteAddress, 20);
    const d = await data();
    if (d.claim) return answer(claimWaitlist(db, d.token));
    const w = waitlistOffer(db, d.token);
    return answer({
      start: w.start,
      expires: w.expires,
      service: get(db, "services", w.serviceId)?.name,
      staff: get(db, "staff", w.staffId)?.name,
    });
  }
  if (path === "/api/public/waitlist" && method === "POST") {
    rateLimit(db, "waitlist:" + req.socket.remoteAddress, 5);
    const d = await data();
    if (
      !d.name?.trim() ||
      !validEmail(d.email) ||
      !get(db, "locations", d.locationId) ||
      !get(db, "services", d.serviceId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d.date)
    )
      throw Error("Enter a valid waitlist request.");
    put(db, "waitlist", {
      name: d.name.trim(),
      email: d.email.toLowerCase(),
      locationId: d.locationId,
      serviceId: d.serviceId,
      staffId: d.staffId || "",
      date: d.date,
      status: "waiting",
      notes: "",
      created: new Date().toISOString(),
    });
    return answer({ ok: true });
  }
  if (path === "/api/public/group" && method === "POST") {
    rateLimit(db, "group:" + req.socket.remoteAddress, 5);
    const d = await data();
    if (!Array.isArray(d.visits) || d.visits.length < 1 || d.visits.length > 8)
      throw Error("Choose 1–8 visits.");
    const groupId = id();
    const booked = transaction(db, () =>
      d.visits.map((v) => {
        const a = book(db, { ...v, groupId }, { publicBooking: true });
        bookingMessages(db, a);
        return { id: a.id, manageToken: a.token, start: a.start };
      }),
    );
    return answer(booked);
  }
  if (path.startsWith("/api/public/appointment/") && method === "POST") {
    const d = await data();
    req.parsedBody = d;
    const a = db
      .prepare("SELECT * FROM appointments WHERE token=?")
      .get(path.split("/").pop());
    if (!a) throw Error("Appointment not found.");
    appointmentPolicy(db, a);
    if (d.action === "reschedule")
      return answer(cleanAppointment(reschedule(db, a, d.start)));
    if (d.action !== "cancel") throw Error("Invalid action.");
    db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(
      a.id,
    );
    return answer({ ok: true });
  }

  if (path === "/api/public/brand" && method === "GET")
    return answer({
      brand: get(db, "branding", "brand") || {},
      portfolio: list(db, "portfolio"),
      locations: list(db, "locations").map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
      })),
      memberships: list(db, "memberships")
        .filter((p) => p.active)
        .map(({ stripePriceId, ...p }) => p),
    });
  if (path.startsWith("/api/images/") && method === "GET") {
    const image = db
      .prepare("SELECT * FROM uploads WHERE id=?")
      .get(path.split("/").pop());
    if (
      !image ||
      (!image.public &&
        (!user ||
          (image.owner !== user.id &&
            !["owner", "manager"].includes(user.role))))
    )
      throw Object.assign(Error("Not found."), { status: 404 });
    res.writeHead(200, {
      "Content-Type": image.mime,
      "Cache-Control": image.public
        ? "public, max-age=3600"
        : "private, no-store",
    });
    res.end(image.data);
    return true;
  }
  if (!user) return false;
  if (path === "/api/account" && method === "GET")
    return answer(profile(db, user));
  if (path === "/api/account/mfa" && method === "POST") {
    const d = await data(),
      person = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
    if (!passwordMatches(d.password || "", person.password))
      throw Error("Password is incorrect.");
    const grant = access(db, user);
    if (d.action === "setup") {
      if (grant.mfa_secret) throw Error("MFA is already enabled.");
      const mfa = newMFA(user.email);
      db.prepare(
        "INSERT INTO user_access(user_id,mfa_pending) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET mfa_pending=excluded.mfa_pending",
      ).run(user.id, seal(mfa.secret));
      return answer(mfa);
    }
    if (d.action === "enable") {
      if (!grant.mfa_pending || !checkMFA(grant.mfa_pending, d.code))
        throw Error("Authenticator code is incorrect.");
      db.prepare(
        "UPDATE user_access SET mfa_secret=mfa_pending,mfa_pending=NULL WHERE user_id=?",
      ).run(user.id);
    } else if (d.action === "disable") {
      if (!grant.mfa_secret || !checkMFA(grant.mfa_secret, d.code))
        throw Error("Authenticator code is incorrect.");
      db.prepare("UPDATE user_access SET mfa_secret=NULL WHERE user_id=?").run(
        user.id,
      );
    } else throw Error("Unknown MFA action.");
    return answer({ ok: true });
  }
  if (path === "/api/team/invite" && method === "POST") {
    need(managers);
    const d = await data();
    if (
      !validEmail(d.email) ||
      !d.name?.trim() ||
      !["manager", "receptionist", "staff", "customer"].includes(d.role)
    )
      throw Error("Invalid invitation.");
    if (user.role === "manager" && d.role === "manager") need(["owner"]);
    if (d.role === "staff" && !get(db, "staff", d.staffId))
      throw Error("Choose a professional.");
    if (d.role === "customer" && !get(db, "clients", d.clientId))
      throw Error("Choose a client.");
    const link = transaction(db, () => {
      if (
        db
          .prepare("SELECT id FROM users WHERE email=?")
          .get(d.email.toLowerCase())
      )
        throw Error("This email already has an account.");
      const key = id();
      db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
        key,
        d.email.toLowerCase(),
        d.name.trim(),
        passwordHash(token()),
        d.role,
      );
      db.prepare(
        "INSERT INTO user_access(user_id,staff_id,client_id,verified) VALUES(?,?,?,0)",
      ).run(key, d.staffId || null, d.clientId || null);
      const t = issueToken(db, key, "invite", 1440);
      const link = origin + "/account?action=invite#" + t;
      if (process.env.RESEND_API_KEY)
        enqueue(db, {
          to: d.email,
          subject: "Your Chairside invitation",
          body: link,
        });
      return link;
    });
    return answer({ link });
  }
  if (path === "/api/team/access" && method === "GET") {
    need(managers);
    return answer(
      db
        .prepare(
          "SELECT u.id,u.name,u.email,u.role,a.staff_id,a.client_id,a.disabled,a.verified FROM users u LEFT JOIN user_access a ON a.user_id=u.id",
        )
        .all(),
    );
  }
  if (path === "/api/team/access" && method === "PATCH") {
    need(["owner"]);
    const d = await data();
    if (d.userId === user.id)
      throw Error("You cannot disable your own account.");
    db.prepare("UPDATE user_access SET disabled=? WHERE user_id=?").run(
      d.disabled ? 1 : 0,
      d.userId,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(d.userId);
    return answer({ ok: true });
  }
  if (path === "/api/portal" && method === "GET") {
    need(["customer"]);
    const a = access(db, user),
      client = get(db, "clients", a.client_id);
    return answer({
      profile: client,
      appointments: db
        .prepare(
          "SELECT * FROM appointments WHERE client_id=? ORDER BY start DESC",
        )
        .all(client.id)
        .map(cleanAppointment),
      orders: db
        .prepare("SELECT * FROM orders WHERE client_id=? ORDER BY created DESC")
        .all(client.id),
      memberships: db
        .prepare("SELECT * FROM subscriptions_v2 WHERE client_id=?")
        .all(client.id),
      messages: list(db, "messages").filter((m) => m.clientId === client.id),
    });
  }
  if (path === "/api/portal/book" && method === "POST") {
    need(["customer"]);
    const d = await data();
    const a = book(db, { ...d, clientId: access(db, user).client_id });
    bookingMessages(db, a);
    return answer(cleanAppointment(a));
  }
  if (path === "/api/portal/profile" && method === "PATCH") {
    need(["customer"]);
    const c = get(db, "clients", access(db, user).client_id),
      d = await data();
    if (typeof d.name !== "string" || !d.name.trim())
      throw Error("Name is required.");
    return answer(
      put(
        db,
        "clients",
        {
          ...c,
          name: d.name.trim().slice(0, 120),
          phone: String(d.phone || "").slice(0, 40),
          marketingConsent: d.marketingConsent === true,
        },
        c.id,
      ),
    );
  }
  if (/^\/api\/portal\/appointments\/[^/]+$/.test(path) && method === "POST") {
    need(["customer"]);
    const a = db
      .prepare("SELECT * FROM appointments WHERE id=?")
      .get(path.split("/").pop());
    if (!a || !canAppointment(db, user, a))
      throw Object.assign(Error("Not found."), { status: 404 });
    appointmentPolicy(db, a);
    const d = await data();
    if (d.action === "reschedule")
      return answer(cleanAppointment(reschedule(db, a, d.start)));
    if (d.action !== "cancel") throw Error("Invalid action.");
    db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(
      a.id,
    );
    return answer({ ok: true });
  }
  if (path === "/api/membership/checkout" && method === "POST") {
    const d = await data();
    const clientId =
      user.role === "customer" ? access(db, user).client_id : d.clientId;
    if (user.role !== "customer") need(operators);
    return answer(await membershipLink(db, clientId, d.planId));
  }
  if (path === "/api/membership/portal" && method === "POST") {
    const d = await data(),
      sub = db
        .prepare("SELECT * FROM subscriptions_v2 WHERE id=?")
        .get(d.subscriptionId);
    if (
      !sub ||
      !sub.stripe_id ||
      (user.role === "customer" && sub.client_id !== access(db, user).client_id)
    )
      throw Error("Membership not found.");
    if (user.role !== "customer") need(operators);
    const stripe = stripeClient(),
      subscription = await stripe.subscriptions.retrieve(sub.stripe_id);
    const portal = await stripe.billingPortal.sessions.create({
      customer:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      return_url: origin + "/portal",
    });
    return answer({ url: portal.url });
  }
  if (path === "/api/messages" && method === "POST") {
    const d = await data();
    const clientId =
      user.role === "customer" ? access(db, user).client_id : d.clientId;
    if (user.role !== "customer") need(operators);
    if (
      !get(db, "clients", clientId) ||
      !d.body?.trim() ||
      d.body.length > 5000
    )
      throw Error("Invalid message.");
    return answer(
      put(db, "messages", {
        name: "Conversation",
        clientId,
        body: d.body,
        sender: user.role === "customer" ? "client" : "studio",
        created: new Date().toISOString(),
      }),
    );
  }
  if (path === "/api/commerce/deposits" && method === "POST") {
    const d = await data(),
      a = db
        .prepare("SELECT * FROM appointments WHERE id=?")
        .get(d.appointmentId);
    if (!a || !canAppointment(db, user, a))
      throw Error("Appointment not found.");
    if (user.role !== "customer") need(operators);
    return answer(
      createDeposit(db, a.id, d.amount, req.headers["idempotency-key"]),
    );
  }
  if (path === "/api/commerce/quote" && method === "POST") {
    need(operators);
    return answer(quote(db, await data()));
  }
  if (path === "/api/commerce/orders" && method === "POST") {
    const d = await data();
    if (user.role === "customer") {
      const a = db
        .prepare("SELECT * FROM appointments WHERE id=?")
        .get(d.appointmentId);
      if (!a || !canAppointment(db, user, a))
        throw Error("Appointment not found.");
      d.items = [];
      d.tip = 0;
      d.promoCode = undefined;
      d.loyaltyPoints = 0;
      d.subscriptionId = undefined;
    } else need(operators);
    return answer(createOrder(db, d, req.headers["idempotency-key"]));
  }
  if (
    /^\/api\/commerce\/orders\/[^/]+\/(pay|card|refund|receipt|cancel)$/.test(
      path,
    )
  ) {
    const [, , , , key, action] = path.split("/"),
      order = db.prepare("SELECT * FROM orders WHERE id=?").get(key);
    if (!order) throw Error("Order not found.");
    if (user.role === "customer") {
      if (
        order.client_id !== access(db, user).client_id ||
        !["card", "receipt"].includes(action)
      )
        throw Object.assign(Error("Not allowed."), { status: 403 });
    } else need(operators);
    if (action === "receipt" && method === "GET")
      return answer({
        ...order,
        details: JSON.parse(order.details),
        tenders: db
          .prepare("SELECT method,amount FROM tenders WHERE order_id=?")
          .all(key),
        refunds: db
          .prepare("SELECT amount,status,reason FROM refunds WHERE order_id=?")
          .all(key),
      });
    if (method !== "POST") return false;
    const d = await data();
    if (action === "cancel") return answer(cancelOrder(db, key));
    if (action === "pay") return answer(settle(db, key, d.tenders));
    if (action === "card") return answer(await checkoutLink(db, key));
    if (action === "refund") {
      need(managers);
      return answer(
        order.stripe_payment
          ? await requestRefund(db, key, d.reason)
          : refundLocal(db, key, d.reason),
      );
    }
  }
  if (path === "/api/uploads" && method === "POST") {
    need(managers);
    const d = await data();
    const bytes = Buffer.from(String(d.base64 || ""), "base64");
    if (
      bytes.length > 1000000 ||
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(16) > 4096 ||
      bytes.readUInt32BE(20) > 4096
    )
      throw Error("Upload a PNG under 1 MB and 4096 × 4096 pixels.");
    const key = id();
    db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?)").run(
      key,
      user.id,
      "image/png",
      bytes,
      d.public === true ? 1 : 0,
      new Date().toISOString(),
    );
    return answer({ id: key, url: "/api/images/" + key });
  }
  if (path === "/api/operations" && method === "GET") {
    need(operators);
    return answer({
      orders: db
        .prepare("SELECT * FROM orders ORDER BY created DESC LIMIT 500")
        .all(),
      stock: db.prepare("SELECT * FROM stock").all(),
      movements: db
        .prepare(
          "SELECT * FROM stock_movements ORDER BY created DESC LIMIT 500",
        )
        .all(),
      subscriptions: db.prepare("SELECT * FROM subscriptions_v2").all(),
      outbox: db
        .prepare(
          "SELECT id,channel,recipient,subject,status,attempts,last_error,created FROM outbox ORDER BY created DESC LIMIT 200",
        )
        .all(),
      shifts: list(db, "shifts"),
      resources: list(db, "resources"),
      promotions: list(db, "promotions"),
      suppliers: list(db, "suppliers"),
      purchaseOrders: list(db, "purchaseOrders"),
      messages: list(db, "messages"),
      portfolio: list(db, "portfolio"),
      timesheets: list(db, "timesheets"),
      recurrences: list(db, "recurrences"),
      riskAlerts: list(db, "riskAlerts"),
      branding: get(db, "branding", "brand") || {},
      integrations: {
        stripe: Boolean(
          process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
        ),
        email: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
        sms: Boolean(
          process.env.TWILIO_ACCOUNT_SID &&
          process.env.TWILIO_AUTH_TOKEN &&
          process.env.TWILIO_FROM,
        ),
        worker: process.env.RUN_WORKER === "true",
      },
    });
  }
  if (path === "/api/inventory/adjust" && method === "POST") {
    need(managers);
    const d = await data();
    integer(Math.abs(d.delta));
    if (!d.reason?.trim()) throw Error("A reason is required.");
    transaction(db, () =>
      moveStock(db, d.productId, d.locationId, d.delta, d.reason),
    );
    return answer({ ok: true });
  }
  if (path === "/api/inventory/transfer" && method === "POST") {
    need(managers);
    const d = await data();
    integer(d.quantity, 1);
    if (d.from === d.to) throw Error("Choose different locations.");
    transaction(db, () => {
      const ref = id();
      moveStock(db, d.productId, d.from, -d.quantity, "transfer out", ref);
      moveStock(db, d.productId, d.to, d.quantity, "transfer in", ref);
    });
    return answer({ ok: true });
  }
  if (path === "/api/inventory/receive" && method === "POST") {
    need(managers);
    return answer(receivePurchase(db, (await data()).id));
  }
  if (path === "/api/clients/import" && method === "POST") {
    need(managers);
    const d = await data();
    if (!Array.isArray(d.clients) || d.clients.length > 1000)
      throw Error("Import up to 1,000 clients.");
    const result = transaction(db, () =>
      d.clients.map((c) => {
        if (!c.name?.trim() || !validEmail(c.email))
          throw Error("Every client needs a name and valid email.");
        const old = list(db, "clients").find(
          (x) => x.email === c.email.toLowerCase(),
        );
        if (old) return old;
        return put(db, "clients", {
          name: c.name.trim().slice(0, 120),
          email: c.email.toLowerCase(),
          phone: String(c.phone || "").slice(0, 40),
          notes: "",
          points: 0,
          marketingConsent: false,
        });
      }),
    );
    return answer({ count: result.length });
  }
  if (path === "/api/clients/merge" && method === "POST") {
    need(managers);
    const d = await data();
    if (d.sourceId === d.targetId) throw Error("Choose different clients.");
    transaction(db, () => {
      const source = get(db, "clients", d.sourceId),
        target = get(db, "clients", d.targetId);
      if (!source || !target) throw Error("Client not found.");
      const accounts = db
        .prepare("SELECT * FROM user_access WHERE client_id IN (?,?)")
        .all(source.id, target.id);
      if (accounts.length > 1)
        throw Error("Cannot merge profiles with separate login accounts.");
      db.prepare("UPDATE appointments SET client_id=? WHERE client_id=?").run(
        target.id,
        source.id,
      );
      db.prepare(
        "UPDATE orders SET client_id=?,details=json_set(details,'$.clientId',?) WHERE client_id=?",
      ).run(target.id, target.id, source.id);
      db.prepare(
        "UPDATE ledger SET entity_id=? WHERE kind='loyalty' AND entity_id=?",
      ).run(target.id, source.id);
      db.prepare("UPDATE outbox SET client_id=? WHERE client_id=?").run(
        target.id,
        source.id,
      );
      for (const r of list(db, "recurrences").filter(
        (r) => r.clientId === source.id,
      ))
        put(db, "recurrences", { ...r, clientId: target.id }, r.id);
      db.prepare("UPDATE user_access SET client_id=? WHERE client_id=?").run(
        target.id,
        source.id,
      );
      db.prepare(
        "UPDATE subscriptions_v2 SET client_id=? WHERE client_id=?",
      ).run(target.id, source.id);
      for (const m of list(db, "messages").filter(
        (m) => m.clientId === source.id,
      ))
        put(db, "messages", { ...m, clientId: target.id }, m.id);
      put(
        db,
        "clients",
        {
          ...target,
          points: target.points + source.points,
          notes: [target.notes, source.notes].filter(Boolean).join("\n"),
          marketingConsent: target.marketingConsent && source.marketingConsent,
        },
        target.id,
      );
      db.prepare("DELETE FROM records WHERE kind='clients' AND id=?").run(
        source.id,
      );
    });
    return answer({ ok: true });
  }
  if (path === "/api/campaigns/send" && method === "POST") {
    need(managers);
    return answer(queueCampaign(db, (await data()).id));
  }
  if (path === "/api/outbox/retry" && method === "POST") {
    need(managers);
    const d = await data();
    db.prepare(
      "UPDATE outbox SET status='pending',available=?,lease=0,attempts=0 WHERE id=? AND status IN ('failed','retry')",
    ).run(Date.now(), d.id);
    return answer({ ok: true });
  }
  if (path === "/api/recurrences" && method === "PATCH") {
    need(operators);
    const d = await data(),
      t = get(db, "recurrences", d.id);
    if (!t) throw Error("Recurring schedule not found.");
    return answer(
      put(
        db,
        "recurrences",
        { ...t, active: d.active === true, lastError: null },
        t.id,
      ),
    );
  }
  if (path === "/api/series" && method === "POST") {
    need(operators);
    const d = await data();
    const rows = db
      .prepare(
        "SELECT a.* FROM appointments a JOIN appointment_meta m ON m.appointment_id=a.id WHERE m.series_id=? AND a.start>? AND a.status IN ('confirmed','checked-in') ORDER BY a.start",
      )
      .all(d.seriesId, new Date().toISOString());
    if (!rows.length) throw Error("No future visits in this series.");
    transaction(db, () => {
      if (d.action === "cancel") {
        for (const a of rows) {
          if (
            db
              .prepare(
                "SELECT id FROM orders WHERE appointment_id=? AND status='pending' AND stripe_session IS NOT NULL",
              )
              .get(a.id)
          )
            throw Error("A payment is in progress for this series.");
          db.prepare(
            "UPDATE appointments SET status='cancelled' WHERE id=?",
          ).run(a.id);
        }
        const template = get(db, "recurrences", d.seriesId);
        if (template)
          put(db, "recurrences", { ...template, active: false }, template.id);
      } else if (d.action === "move") {
        integer(Math.abs(d.days), 0, 365);
        for (const a of rows) {
          const zone =
              get(db, "locations", a.location_id).timezone ||
              get(db, "settings", "business").timezone,
            p = localParts(new Date(a.start), zone),
            date = new Date(
              Date.parse(p.date + "T12:00:00Z") + d.days * 86400000,
            )
              .toISOString()
              .slice(0, 10);
          reschedule(db, a, zonedInstant(date, p.minute, zone));
        }
        const template = get(db, "recurrences", d.seriesId);
        if (template)
          put(
            db,
            "recurrences",
            {
              ...template,
              nextDate: new Date(
                Date.parse(template.nextDate + "T12:00:00Z") +
                  d.days * 86400000,
              )
                .toISOString()
                .slice(0, 10),
            },
            template.id,
          );
      } else throw Error("Unknown series action.");
    });
    return answer({ updated: rows.length });
  }
  if (path === "/api/timesheets/clock" && method === "POST") {
    need([...operators, "staff"]);
    const d = await data(),
      staffId = user.role === "staff" ? access(db, user).staff_id : d.staffId;
    if (!get(db, "staff", staffId)) throw Error("Choose a professional.");
    const open = list(db, "timesheets").find(
      (t) => t.staffId === staffId && !t.end,
    );
    if (d.action === "in") {
      if (open) throw Error("Already clocked in.");
      return answer(
        put(db, "timesheets", {
          name: "Shift",
          staffId,
          start: new Date().toISOString(),
          end: null,
        }),
      );
    }
    if (d.action === "out" && open)
      return answer(
        put(
          db,
          "timesheets",
          { ...open, end: new Date().toISOString() },
          open.id,
        ),
      );
    throw Error("No open shift.");
  }
  if (path === "/api/reports" && method === "GET") {
    need(managers);
    const from = url.searchParams.get("from") || "2000-01-01",
      to = url.searchParams.get("to") || "2100-01-01",
      location = url.searchParams.get("location") || "all";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      throw Error("Invalid date range.");
    const orders = db
      .prepare(
        "SELECT * FROM orders WHERE created>=? AND created<=? AND (?='all' OR location_id=?)",
      )
      .all(from + "T00:00:00.000Z", to + "T23:59:59.999Z", location, location);
    const paid = orders.filter(
      (o) => o.status === "paid" && o.kind !== "giftcard",
    );
    const appointments = db
      .prepare(
        "SELECT a.*,m.commission FROM appointments a LEFT JOIN appointment_meta m ON m.appointment_id=a.id WHERE a.start>=? AND a.start<=? AND (?='all' OR a.location_id=?)",
      )
      .all(from, to + "T23:59:59.999Z", location, location);
    return answer({
      orders: orders.length,
      giftCardLiability: list(db, "giftcards").reduce(
        (n, c) => n + c.balance,
        0,
      ),
      revenue: paid.reduce((n, o) => n + o.total, 0),
      tax: paid.reduce((n, o) => n + o.tax, 0),
      tips: paid.reduce((n, o) => n + o.tip, 0),
      discounts: paid.reduce((n, o) => n + o.discount, 0),
      refunds: orders
        .filter((o) => o.status === "refunded")
        .reduce((n, o) => n + o.total, 0),
      noShowRate: appointments.length
        ? appointments.filter((a) => a.status === "no-show").length /
          appointments.length
        : 0,
      commissions: list(db, "staff").map((s) => ({
        name: s.name,
        amount: appointments
          .filter(
            (a) =>
              a.staff_id === s.id &&
              a.status === "completed" &&
              !orders.some(
                (o) => o.appointment_id === a.id && o.status === "refunded",
              ),
          )
          .reduce(
            (n, a) =>
              n + Math.round((a.price * (a.commission ?? s.commission)) / 100),
            0,
          ),
      })),
      retention: list(db, "clients").map((c) => {
        const visits = appointments.filter(
          (a) => a.client_id === c.id && a.status === "completed",
        );
        return {
          name: c.name,
          visits: visits.length,
          lastVisit: visits.at(-1)?.start || null,
        };
      }),
    });
  }
  return false;
}
