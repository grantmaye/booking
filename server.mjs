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
} from "./db.mjs";
const db = openDB();
seed(db);
if (
  process.env.NODE_ENV === "production" &&
  !db.prepare("SELECT id FROM users LIMIT 1").get() &&
  !process.env.SETUP_TOKEN
)
  throw Error("Set SETUP_TOKEN before starting production for the first time.");
const root = fileURLToPath(new URL("./public/", import.meta.url));
const attempts = new Map();
function throttle(key, max = 30) {
  const now = Date.now(),
    entry = attempts.get(key) || { count: 0, until: now + 60000 };
  if (entry.until < now) {
    entry.count = 0;
    entry.until = now + 60000;
  }
  entry.count++;
  attempts.set(key, entry);
  if (attempts.size > 10000)
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  if (entry.count > max)
    throw Object.assign(Error("Too many requests. Try again in a minute."), {
      status: 429,
    });
}
function fail(message, status = 400) {
  throw Object.assign(Error(message), { status });
}
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 64000) fail("Request too large.", 413);
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    fail("Invalid JSON.");
  }
}
const schemas = {
  locations: ["name", "address", "open", "close", "days"],
  staff: ["name", "title", "color", "locationId", "commission", "active"],
  services: ["name", "duration", "price", "category", "buffer", "active"],
  clients: ["name", "email", "phone", "notes", "points", "marketingConsent"],
  products: ["name", "price", "stock", "reorderAt"],
  memberships: ["name", "price", "credits", "description", "active"],
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
            timeZone: get(db, "settings", "business").timezone,
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
      const a = book(db, await body(req), { publicBooking: true });
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
          service: get(db, "services", a.service_id)?.name,
          staff: get(db, "staff", a.staff_id)?.name,
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
      return send(200, data);
    }
    let result;
    if (path === "/api/appointments" && req.method === "POST") {
      const records = bookSeries(db, await body(req));
      result = records.map(({ token, ...a }) => a);
    } else if (
      /^\/api\/appointments\/[^/]+$/.test(path) &&
      req.method === "PATCH"
    ) {
      const key = path.split("/").pop(),
        data = await body(req),
        a = db.prepare("SELECT * FROM appointments WHERE id=?").get(key);
      if (!a) fail("Appointment not found.", 404);
      if (data.start) {
        if (!["confirmed", "checked-in"].includes(a.status))
          fail("Only active appointments can be moved.");
        transaction(db, () => {
          const slot = validateSlot(
            db,
            {
              locationId: a.location_id,
              staffId: a.staff_id,
              serviceId: a.service_id,
              start: data.start,
            },
            key,
          );
          db.prepare("UPDATE appointments SET start=?,end=? WHERE id=?").run(
            slot.start,
            slot.end,
            key,
          );
        });
      } else {
        if (
          !["confirmed", "checked-in"].includes(a.status) ||
          !["checked-in", "cancelled", "no-show"].includes(data.status)
        )
          fail("Invalid appointment transition.");
        db.prepare("UPDATE appointments SET status=? WHERE id=?").run(
          data.status,
          key,
        );
      }
      result = { ok: true };
    } else if (path === "/api/sales" && req.method === "POST") {
      const data = await body(req);
      result = sellProduct(db, data.productId, data.quantity);
    } else if (path === "/api/checkout" && req.method === "POST") {
      const data = await body(req);
      result = checkout(db, data.appointmentId, data.tip, data.method);
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
        result = put(
          db,
          kind,
          data,
          key || (kind === "settings" ? "business" : undefined),
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
    send(e.status || 400, { error: e.message || "Request failed." });
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
