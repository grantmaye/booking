import { issueGift } from "./lib/commerce.mjs";
import { extendRecurrences } from "./lib/recurrence.mjs";
import { matchWaitlist } from "./lib/waitlist.mjs";
import { createOrder, settle } from "./lib/commerce.mjs";
import {
  extendedRoute,
  legacyGuard,
  scopedData,
  checkAppointmentScope,
  reschedule,
} from "./lib/routes.mjs";
import {
  access,
  checkMFA,
  rateLimit,
  canAppointment,
  requireRole,
} from "./lib/security.mjs";
import { bookingMessages, runOutbox } from "./lib/messaging.mjs";
import { extraSchemas, validateExtra } from "./lib/records.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { randomBytes } from "node:crypto";
import {
  openDB,
  seed,
  list,
  get,
  put,
  id,
  passwordHash,
  passwordMatches,
  book,
  checkout,
  validateSlot,
  transaction,
  bookSeries,
  sellProduct,
  zonedInstant,
} from "./db.mjs";
const db = openDB();
if (process.env.NODE_ENV !== "production" || process.env.SEED_DEMO === "true")
  seed(db);
else if (!get(db, "settings", "business"))
  put(
    db,
    "settings",
    {
      name: "My Studio",
      timezone: "America/New_York",
      currency: "USD",
      cancelHours: 24,
      bookingDays: 60,
      loyaltyPointsPerDollar: 1,
      taxBasisPoints: 0,
    },
    "business",
  );
if (
  process.env.NODE_ENV === "production" &&
  !db.prepare("SELECT id FROM users LIMIT 1").get() &&
  !process.env.SETUP_TOKEN
)
  throw Error("Set SETUP_TOKEN before starting production for the first time.");
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32)
)
  throw Error("APP_SECRET must contain at least 32 characters in production.");
const root = fileURLToPath(new URL("./public/", import.meta.url));
function throttle(key, max = 30) {
  return rateLimit(db, key, max);
}
function fail(message, status = 400) {
  throw Object.assign(Error(message), { status });
}
async function body(req) {
  if (req.parsedBody) return req.parsedBody;
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 1500000) fail("Request too large.", 413);
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    fail("Invalid JSON.");
  }
}
const schemas = {
  ...extraSchemas,
  locations: [
    "name",
    "address",
    "open",
    "close",
    "days",
    "timezone",
    "taxBasisPoints",
  ],
  staff: [
    "name",
    "title",
    "color",
    "locationId",
    "locationIds",
    "commission",
    "active",
  ],
  services: [
    "name",
    "duration",
    "price",
    "category",
    "buffer",
    "active",
    "locationPrices",
  ],
  clients: ["name", "email", "phone", "notes", "points", "marketingConsent"],
  products: ["name", "price", "stock", "reorderAt"],
  memberships: [
    "name",
    "price",
    "credits",
    "description",
    "active",
    "stripePriceId",
    "serviceIds",
  ],
  campaigns: ["name", "subject", "body", "status", "audience"],
  waitlist: [
    "name",
    "email",
    "serviceId",
    "staffId",
    "locationId",
    "date",
    "notes",
    "status",
  ],
  blocks: ["staffId", "start", "end", "notes"],
  settings: [
    "name",
    "timezone",
    "currency",
    "cancelHours",
    "bookingDays",
    "loyaltyPointsPerDollar",
    "taxBasisPoints",
  ],
  giftcards: ["name", "code", "balance"],
  subscriptions: ["name", "clientId", "membershipId", "credits", "status"],
  rent: ["name", "staffId", "amount", "due", "status"],
};
function validateRecord(kind, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Invalid record.");
  const data = Object.fromEntries(
    Object.entries(input).filter(([key]) => schemas[kind].includes(key)),
  );
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.length > 5000) fail("Text is too long.");
    if (
      [
        "price",
        "stock",
        "reorderAt",
        "points",
        "balance",
        "amount",
        "credits",
        "buffer",
      ].includes(k) &&
      (!Number.isInteger(v) || v < 0)
    )
      fail(`Invalid ${k}.`);
  }
  if (
    kind !== "blocks" &&
    kind !== "waitlist" &&
    (!data.name || typeof data.name !== "string")
  )
    fail("A name is required.");
  for (const key of {
    services: ["price", "duration", "buffer"],
    products: ["price", "stock", "reorderAt"],
    memberships: ["price", "credits"],
    clients: ["points"],
    giftcards: ["balance"],
    rent: ["amount"],
    subscriptions: ["credits"],
  }[kind] || [])
    if (!Number.isInteger(data[key]) || data[key] < 0) fail(`Invalid ${key}.`);
  if (
    kind === "staff" &&
    (!Number.isFinite(data.commission) || typeof data.active !== "boolean")
  )
    fail("Invalid staff settings.");
  if (
    ["services", "memberships"].includes(kind) &&
    typeof data.active !== "boolean"
  )
    fail("Invalid active setting.");
  if (
    kind === "services" &&
    (!Number.isInteger(data.duration) ||
      data.duration < 15 ||
      data.duration > 480)
  )
    fail("Duration must be 15–480 minutes.");
  if (kind === "staff" && !/^#[0-9a-f]{6}$/i.test(data.color || ""))
    fail("Choose a valid calendar color.");
  if (
    kind === "staff" &&
    (!get(db, "locations", data.locationId) ||
      data.commission < 0 ||
      data.commission > 100)
  )
    fail("Invalid location or commission.");
  if (
    kind === "locations" &&
    (!Number.isInteger(data.open) ||
      !Number.isInteger(data.close) ||
      data.open < 0 ||
      data.close > 24 ||
      data.open >= data.close ||
      !Array.isArray(data.days) ||
      data.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  )
    fail("Invalid business hours.");
  if (kind === "settings") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.timezone });
    } catch {
      fail("Invalid timezone.");
    }
    if (
      data.currency !== "USD" ||
      !Number.isInteger(data.bookingDays) ||
      data.bookingDays < 1 ||
      data.bookingDays > 365 ||
      !Number.isFinite(data.cancelHours) ||
      data.cancelHours < 0
    )
      fail("Invalid booking policy.");
  }
  if (kind === "campaigns" && data.status !== "draft")
    fail("Delivery requires a messaging provider. Save as draft.");
  if (kind === "blocks") {
    if (
      !get(db, "staff", data.staffId) ||
      !Number.isFinite(Date.parse(data.start)) ||
      !Number.isFinite(Date.parse(data.end)) ||
      data.end <= data.start
    )
      fail("Invalid time block.");
    data.start = new Date(data.start).toISOString();
    data.end = new Date(data.end).toISOString();
    if (
      db
        .prepare(
          "SELECT id FROM appointments WHERE staff_id=? AND status NOT IN ('cancelled','no-show') AND start<? AND end>?",
        )
        .get(data.staffId, data.end, data.start)
    )
      fail("This block overlaps an appointment.");
  }
  if (data.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.timezone });
    } catch {
      fail("Invalid timezone.");
    }
  }
  if (
    data.taxBasisPoints !== undefined &&
    (!Number.isInteger(data.taxBasisPoints) ||
      data.taxBasisPoints < 0 ||
      data.taxBasisPoints > 5000)
  )
    fail("Tax rate must be between 0 and 5000 basis points.");
  if (
    kind === "staff" &&
    data.locationIds &&
    (!Array.isArray(data.locationIds) ||
      data.locationIds.some((key) => !get(db, "locations", key)))
  )
    fail("Invalid location assignments.");
  if (kind === "giftcards") {
    data.code = String(data.code || "").toUpperCase();
    if (!/^[A-Z0-9-]{8,64}$/.test(data.code))
      fail("Use a gift code of 8–64 letters, numbers, or hyphens.");
  }
  if (extraSchemas[kind]) validateExtra(db, kind, { ...data, id: input.id });
  return data;
}
const server = createServer(async (req, res) => {
  const send = (status, data, headers = {}) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(JSON.stringify(data));
  };
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  );
  try {
    const url = new URL(req.url, "http://localhost"),
      path = url.pathname;
    if (!path.startsWith("/api/")) {
      const target = resolve(
        root,
        "." + (path === "/" || !extname(path) ? "/index.html" : path),
      );
      if (!target.startsWith(root)) fail("Not found", 404);
      try {
        const data = await readFile(target);
        res.writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".json": "application/json",
              ".webmanifest": "application/manifest+json",
            }[extname(target)] || "application/octet-stream",
        });
        res.end(data);
        return;
      } catch {
        fail("Not found", 404);
      }
    }
    const mutation = !["GET", "HEAD"].includes(req.method);
    if (
      mutation &&
      req.headers.origin &&
      req.headers.origin !==
        `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}` &&
      req.headers.origin !== process.env.PUBLIC_ORIGIN
    )
      fail("Origin not allowed.", 403);
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("session="))
      ?.slice(8);
    const user = cookie
      ? db
          .prepare(
            "SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
          )
          .get(cookie, Date.now())
      : null;
    if (user && access(db, user).disabled) fail("Account disabled.", 401);
    if (
      await extendedRoute({
        db,
        req,
        res,
        url,
        user,
        body,
        send: (status, result, headers) => {
          if (user && !["GET", "HEAD"].includes(req.method))
            db.prepare("INSERT INTO audit VALUES(?,?,?,?,?)").run(
              id(),
              user.id,
              req.method,
              path,
              new Date().toISOString(),
            );
          send(status, result, headers);
        },
      })
    )
      return;
    if (path === "/api/session" && req.method === "GET")
      return send(200, {
        user: user || null,
        setup: !db.prepare("SELECT id FROM users LIMIT 1").get(),
        setupTokenRequired: Boolean(process.env.SETUP_TOKEN),
      });
    if (["/api/setup", "/api/login"].includes(path) && req.method === "POST") {
      throttle(`auth:${req.socket.remoteAddress}`, 10);
      const data = await body(req);
      let account;
      if (path === "/api/setup") {
        if (
          process.env.SETUP_TOKEN &&
          data.setupToken !== process.env.SETUP_TOKEN
        )
          fail("Invalid setup token.", 403);
        if (db.prepare("SELECT id FROM users LIMIT 1").get())
          fail("Setup is already complete.", 409);
        if (
          !/^\S+@\S+\.\S+$/.test(data.email || "") ||
          typeof data.password !== "string" ||
          data.password.length < 12 ||
          data.password.length > 200 ||
          !data.name?.trim()
        )
          fail(
            "Provide your name, email, and a password of 12–200 characters.",
          );
        const key = id();
        db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
          key,
          data.email.toLowerCase(),
          data.name.trim(),
          passwordHash(data.password),
          "owner",
        );
        account = db.prepare("SELECT * FROM users WHERE id=?").get(key);
      } else {
        account = db
          .prepare("SELECT * FROM users WHERE email=?")
          .get(String(data.email || "").toLowerCase());
        if (
          typeof data.password !== "string" ||
          data.password.length > 200 ||
          !account ||
          !passwordMatches(data.password, account.password)
        )
          fail("Email or password is incorrect.", 401);
      }
      const grant = access(db, account);
      if (grant.disabled) fail("Account disabled.", 403);
      if (!grant.verified)
        fail("Verify your email or accept your invitation first.", 403);
      if (grant.mfa_secret && !checkMFA(grant.mfa_secret, data.code))
        fail("A valid authenticator code is required.", 401);
      const token = randomBytes(32).toString("hex");
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        token,
        account.id,
        Date.now() + 86400000 * 7,
      );
      return send(
        200,
        { ok: true },
        {
          "Set-Cookie": `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        },
      );
    }
    if (path === "/api/logout" && req.method === "POST") {
      db.prepare("DELETE FROM sessions WHERE token=?").run(cookie || "");
      return send(
        200,
        { ok: true },
        { "Set-Cookie": "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" },
      );
    }
    if (path === "/api/public/catalog" && req.method === "GET")
      return send(200, {
        settings: get(db, "settings", "business"),
        locations: list(db, "locations"),
        staff: list(db, "staff")
          .filter((x) => x.active)
          .map(({ commission, ...s }) => s),
        services: list(db, "services").filter((x) => x.active),
      });
    if (path === "/api/public/availability" && req.method === "GET") {
      throttle(`slots:${req.socket.remoteAddress}`, 120);
      const input = Object.fromEntries(url.searchParams);
      if (input.serviceIds) input.serviceIds = input.serviceIds.split(",");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || "")) fail("Choose a date.");
      const slots = [];
      const day = Date.parse(input.date + "T00:00:00Z");
      for (let n = 0; n < 48 * 4; n++) {
        const start = new Date(day + n * 15 * 60000);
        try {
          const slot = validateSlot(db, {
            ...input,
            start: start.toISOString(),
          });
          const p = new Intl.DateTimeFormat("en-CA", {
            timeZone:
              get(db, "locations", input.locationId)?.timezone ||
              get(db, "settings", "business").timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(start);
          if (p === input.date)
            slots.push({ start: slot.start, end: slot.end });
        } catch {}
      }
      return send(200, slots);
    }
    if (path === "/api/public/book" && req.method === "POST") {
      throttle(`book:${req.socket.remoteAddress}`, 10);
      req.parsedBody = await body(req);
      const a = transaction(db, () => {
        const result = book(db, req.parsedBody, { publicBooking: true });
        bookingMessages(db, result);
        return result;
      });
      return send(201, {
        id: a.id,
        start: a.start,
        status: a.status,
        manageToken: a.token,
      });
    }
    if (path.startsWith("/api/public/appointment/")) {
      throttle(`manage:${req.socket.remoteAddress}`, 60);
      const token = path.split("/").pop(),
        a = db.prepare("SELECT * FROM appointments WHERE token=?").get(token);
      if (!a) fail("Booking not found.", 404);
      if (req.method === "GET")
        return send(200, {
          id: a.id,
          start: a.start,
          status: a.status,
          service: JSON.parse(
            db
              .prepare(
                "SELECT service_ids FROM appointment_meta WHERE appointment_id=?",
              )
              .get(a.id)?.service_ids || JSON.stringify([a.service_id]),
          )
            .map((id) => get(db, "services", id)?.name)
            .join(" + "),
          serviceIds: JSON.parse(
            db
              .prepare(
                "SELECT service_ids FROM appointment_meta WHERE appointment_id=?",
              )
              .get(a.id)?.service_ids || JSON.stringify([a.service_id]),
          ),
          staff: get(db, "staff", a.staff_id)?.name,
          locationId: a.location_id,
          serviceId: a.service_id,
          staffId: a.staff_id,
          timezone:
            get(db, "locations", a.location_id)?.timezone ||
            get(db, "settings", "business").timezone,
        });
      if (req.method === "POST") {
        const policy = get(db, "settings", "business");
        if (
          !["confirmed", "checked-in"].includes(a.status) ||
          Date.parse(a.start) - Date.now() < policy.cancelHours * 3600000
        )
          fail("Contact the studio to change this appointment.");
        const data = await body(req);
        if (data.action !== "cancel") fail("Invalid action.");
        db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(
          a.id,
        );
        return send(200, { ok: true });
      }
    }
    if (!user) fail("Sign in to continue.", 401);
    legacyGuard(db, user, path, req.method);
    if (path === "/api/data" && req.method === "GET") {
      const data = Object.fromEntries(
        Object.keys(schemas).map((kind) => [kind, list(db, kind)]),
      );
      data.appointments = db
        .prepare("SELECT * FROM appointments ORDER BY start")
        .all()
        .map(({ token, ...a }) => a);
      data.payments = db
        .prepare("SELECT * FROM payments ORDER BY created DESC")
        .all();
      data.sales = db
        .prepare("SELECT * FROM sales ORDER BY created DESC")
        .all();
      data.notifications = list(db, "notifications");
      data.audit = db
        .prepare("SELECT * FROM audit ORDER BY created DESC LIMIT 100")
        .all();
      data.appointments = data.appointments.map((a) => ({
        ...a,
        ...(db
          .prepare(
            "SELECT series_id,resource_id,service_ids FROM appointment_meta WHERE appointment_id=?",
          )
          .get(a.id) || {}),
      }));
      return send(200, scopedData(db, user, data));
    }
    let result;
    if (path === "/api/appointments" && req.method === "POST") {
      const input = await body(req);
      checkAppointmentScope(db, user, input);
      const records = transaction(db, () => {
        const rows = bookSeries(db, input);
        rows.forEach((a) => bookingMessages(db, a));
        return rows;
      });
      result = records.map(({ token, ...a }) => a);
    } else if (
      /^\/api\/appointments\/[^/]+$/.test(path) &&
      req.method === "PATCH"
    ) {
      const key = path.split("/").pop(),
        data = await body(req),
        a = db.prepare("SELECT * FROM appointments WHERE id=?").get(key);
      if (!a) fail("Appointment not found.", 404);
      if (!canAppointment(db, user, a)) fail("Not allowed.", 403);
      if (
        db
          .prepare(
            "SELECT id FROM orders WHERE appointment_id=? AND status='pending' AND stripe_session IS NOT NULL",
          )
          .get(a.id)
      )
        fail(
          "A payment is in progress. Wait for completion or expiration before changing this visit.",
        );
      if (data.start || data.localDate) {
        if (!["confirmed", "checked-in"].includes(a.status))
          fail("Only active appointments can be moved.");
        const desired = data.localDate
          ? zonedInstant(
              data.localDate,
              data.minute,
              get(db, "locations", a.location_id)?.timezone ||
                get(db, "settings", "business").timezone,
            )
          : data.start;
        reschedule(db, a, desired);
      } else {
        if (
          !["confirmed", "checked-in"].includes(a.status) ||
          !["checked-in", "cancelled", "no-show", "completed"].includes(
            data.status,
          )
        )
          fail("Invalid appointment transition.");
        if (
          data.status === "completed" &&
          !db
            .prepare(
              "SELECT id FROM orders WHERE appointment_id=? AND status='paid'",
            )
            .get(a.id)
        )
          fail("Collect payment before completing this visit.");
        db.prepare("UPDATE appointments SET status=? WHERE id=?").run(
          data.status,
          key,
        );
      }
      result = { ok: true };
    } else if (path === "/api/sales" && req.method === "POST") {
      const data = await body(req);
      const order = createOrder(
        db,
        {
          locationId: data.locationId || list(db, "locations")[0]?.id,
          items: [{ productId: data.productId, quantity: data.quantity }],
        },
        id(),
      );
      result = settle(db, order.id, [{ method: "cash", amount: order.total }]);
    } else if (path === "/api/checkout" && req.method === "POST") {
      const data = await body(req);
      if (data.method !== "cash") fail("Use secure card checkout.");
      const order = createOrder(
        db,
        { appointmentId: data.appointmentId, tip: data.tip },
        id(),
      );
      result = settle(db, order.id, [{ method: "cash", amount: order.total }]);
    } else if (
      /^\/api\/records\/[^/]+(?:\/[^/]+)?$/.test(path) &&
      ["POST", "PATCH", "DELETE"].includes(req.method)
    ) {
      const [, , , kind, key] = path.split("/");
      if (!schemas[kind]) fail("Unknown resource.", 404);
      if (req.method === "DELETE") {
        if (!["blocks", "waitlist", "campaigns"].includes(kind))
          fail("Archive this record instead of deleting it.");
        db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, key);
        result = { ok: true };
      } else {
        const old = key ? get(db, kind, key) : null;
        if (key && !old) fail("Record not found.", 404);
        const data = validateRecord(kind, { ...old, ...(await body(req)) });
        if (kind === "products" && old && data.stock !== old.stock)
          fail("Use Operations → Adjust / transfer to change existing stock.");
        if (kind === "giftcards" && old && data.balance !== old.balance)
          fail("Gift balances change through checkout and refunds.");
        result =
          kind === "giftcards" && !old
            ? issueGift(db, data)
            : put(
                db,
                kind,
                data,
                key ||
                  (kind === "settings"
                    ? "business"
                    : kind === "branding"
                      ? "brand"
                      : undefined),
              );
      }
    } else fail("Not found.", 404);
    db.prepare("INSERT INTO audit VALUES(?,?,?,?,?)").run(
      id(),
      user.id,
      req.method,
      path,
      new Date().toISOString(),
    );
    send(200, result);
  } catch (e) {
    const internal = String(e.code || "").startsWith("ERR_SQLITE");
    if (internal)
      console.error(JSON.stringify({ event: "database_error", code: e.code }));
    send(e.status || (internal ? 409 : 400), {
      error: internal
        ? "This change conflicts with an existing record."
        : e.message || "Request failed.",
    });
  }
});
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `Chairside ready at http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3000}`,
    ),
);

let processing = false;
const worker =
  process.env.RUN_WORKER === "true"
    ? setInterval(async () => {
        if (processing) return;
        processing = true;
        try {
          for (const [name, job] of [
            ["recurrences", () => extendRecurrences(db)],
            ["waitlist", () => matchWaitlist(db)],
            ["outbox", () => runOutbox(db)],
          ]) {
            try {
              await job();
            } catch (e) {
              console.error(
                JSON.stringify({
                  event: "worker_job_error",
                  job: name,
                  message: e.message,
                }),
              );
            }
          }
        } catch (e) {
          console.error(
            JSON.stringify({ event: "worker_error", message: e.message }),
          );
        } finally {
          processing = false;
        }
      }, 15000)
    : null;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (worker) clearInterval(worker);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
