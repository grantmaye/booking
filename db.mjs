import { migrate } from "./lib/migrations.mjs";
import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  scryptSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
export const id = () => randomUUID();
export function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(passwordHash(password, salt).split(":")[1], "hex"),
  );
}
export function openDB(path = process.env.DB_PATH || "data/chairside.sqlite") {
  if (path !== ":memory:")
    mkdirSync(path.substring(0, path.lastIndexOf("/")) || ".", {
      recursive: true,
    });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'owner');
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
 CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,location_id TEXT NOT NULL,staff_id TEXT NOT NULL,client_id TEXT NOT NULL,service_id TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,status TEXT NOT NULL,price INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',token TEXT UNIQUE NOT NULL);
 CREATE INDEX IF NOT EXISTS appointment_slots ON appointments(staff_id,start,end);
 CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,appointment_id TEXT UNIQUE REFERENCES appointments(id),subtotal INTEGER NOT NULL,tip INTEGER NOT NULL,total INTEGER NOT NULL,method TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,total INTEGER NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor TEXT,action TEXT,entity TEXT,created TEXT NOT NULL);
 `);
  migrate(db);
  return db;
}
export const list = (db, kind) =>
  db
    .prepare("SELECT id,data FROM records WHERE kind=?")
    .all(kind)
    .map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
export const get = (db, kind, id) => {
  if (id === undefined || id === null) return undefined;
  const row = db
    .prepare("SELECT data FROM records WHERE kind=? AND id=?")
    .get(kind, id);
  return row ? { id, ...JSON.parse(row.data) } : undefined;
};
export function put(db, kind, data, key = id()) {
  const { id: _, ...rest } = data;
  db.prepare(
    "INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE records.kind=excluded.kind",
  ).run(key, kind, JSON.stringify(rest));
  return { id: key, ...rest };
}
const transactionDepth = new WeakMap();
export function transaction(db, fn) {
  const depth = transactionDepth.get(db) || 0;
  const savepoint = "nested_" + depth;
  db.exec(depth ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  transactionDepth.set(db, depth + 1);
  try {
    const result = fn();
    db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
    return result;
  } catch (e) {
    db.exec(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}` : "ROLLBACK");
    if (depth) db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    throw e;
  } finally {
    transactionDepth.set(db, depth);
  }
}
export function seed(db) {
  if (list(db, "locations").length) return;
  transaction(db, () => {
    put(
      db,
      "settings",
      {
        name: "Chairside Studio",
        timezone: "America/New_York",
        currency: "USD",
        cancelHours: 24,
        bookingDays: 60,
        loyaltyPointsPerDollar: 1,
      },
      "business",
    );
    put(
      db,
      "locations",
      {
        name: "South End",
        address: "1420 South Boulevard, Charlotte, NC",
        open: 9,
        close: 19,
        days: [1, 2, 3, 4, 5, 6],
      },
      "south-end",
    );
    put(
      db,
      "locations",
      {
        name: "NoDa",
        address: "3200 North Davidson Street, Charlotte, NC",
        open: 10,
        close: 18,
        days: [1, 2, 3, 4, 5, 6],
      },
      "noda",
    );
    [
      ["marcus", "Marcus Reed", "Master barber", "#d9e8dc"],
      ["alex", "Alex Morgan", "Stylist", "#e8def4"],
      ["jordan", "Jordan Ellis", "Barber", "#f5dfca"],
    ].forEach(([key, name, title, color]) =>
      put(
        db,
        "staff",
        {
          name,
          title,
          color,
          locationId: "south-end",
          commission: 60,
          active: true,
        },
        key,
      ),
    );
    put(
      db,
      "staff",
      {
        name: "Taylor Brooks",
        title: "Senior stylist",
        color: "#d9e4f5",
        locationId: "noda",
        commission: 60,
        active: true,
      },
      "taylor",
    );
    [
      ["cut", "Signature haircut", 45, 4500, "Hair"],
      ["fade", "Skin fade", 60, 5500, "Hair"],
      ["beard", "Beard sculpt", 30, 3000, "Grooming"],
      ["combo", "Cut + beard", 75, 7000, "Packages"],
      ["wash", "Wash + style", 30, 3500, "Hair"],
    ].forEach(([key, name, duration, price, category]) =>
      put(
        db,
        "services",
        { name, duration, price, category, buffer: 0, active: true },
        key,
      ),
    );
    [
      "James Wilson",
      "Olivia Chen",
      "Ethan Carter",
      "Noah Williams",
      "Sophia Davis",
      "Liam Johnson",
      "Ava Martinez",
      "Mason Brown",
    ].forEach((name, i) =>
      put(
        db,
        "clients",
        {
          name,
          email: `client${i + 1}@example.com`,
          phone: "",
          notes: i === 0 ? "Prefers a low taper. #2 on the sides." : "",
          points: i * 35,
          marketingConsent: false,
        },
        `client-${i}`,
      ),
    );
    [
      ["Matte pomade", 2400, 18],
      ["Daily shampoo", 1800, 6],
      ["Beard oil", 2200, 12],
    ].forEach(([name, price, stock]) =>
      put(db, "products", { name, price, stock, reorderAt: 8 }),
    );
    put(db, "memberships", {
      name: "The Regular",
      price: 8000,
      credits: 2,
      description: "Two signature cuts each month",
      active: true,
    });
    put(db, "campaigns", {
      name: "Welcome back",
      subject: "Your next great haircut is waiting",
      body: "Book your next visit at Chairside.",
      status: "draft",
      audience: "consented",
    });
  });
}
export function localParts(date, timezone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return {
    ...p,
    date: `${p.year}-${p.month}-${p.day}`,
    minute: Number(p.hour) * 60 + Number(p.minute),
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}
export function validateSlot(db, input, exclude = null, now = new Date()) {
  const staff = get(db, "staff", input.staffId),
    service = get(db, "services", input.serviceId),
    location = get(db, "locations", input.locationId),
    settings = get(db, "settings", "business");
  if (
    !staff?.active ||
    !service?.active ||
    !location ||
    !(staff.locationIds || [staff.locationId]).includes(location.id)
  )
    throw Error(
      "Choose an available service and professional at this location.",
    );
  if (
    input.serviceIds !== undefined &&
    (!Array.isArray(input.serviceIds) ||
      input.serviceIds.length > 10 ||
      !input.serviceIds.includes(input.serviceId) ||
      new Set(input.serviceIds).size !== input.serviceIds.length)
  )
    throw Error("Invalid service cart.");
  if (input.serviceIds?.length) {
    const services = input.serviceIds.map((key) => get(db, "services", key));
    if (services.some((s) => !s?.active))
      throw Error("Invalid service selection.");
    service.duration = services.reduce((n, s) => n + s.duration, 0);
    service.buffer = services.reduce((n, s) => n + s.buffer, 0);
    service.price = services.reduce(
      (n, s) => n + (s.locationPrices?.[location.id] ?? s.price),
      0,
    );
  } else service.price = service.locationPrices?.[location.id] ?? service.price;
  const start = new Date(input.start);
  if (
    !Number.isFinite(+start) ||
    start <= now ||
    start > new Date(+now + settings.bookingDays * 86400000)
  )
    throw Error("Choose a future date within the booking window.");
  const end = new Date(+start + (service.duration + service.buffer) * 60000),
    a = localParts(start, location.timezone || settings.timezone),
    b = localParts(end, location.timezone || settings.timezone);
  if (
    !location.days.includes(a.day) ||
    a.date !== b.date ||
    a.minute < location.open * 60 ||
    b.minute > location.close * 60 ||
    a.minute % 15 !== 0
  )
    throw Error("This time falls outside available business hours.");
  const shifts = list(db, "shifts").filter((x) => x.staffId === staff.id);
  if (
    shifts.length &&
    !shifts.some(
      (s) =>
        s.locationId === location.id &&
        s.days.includes(a.day) &&
        a.minute >= s.startMinute &&
        b.minute <= s.endMinute,
    )
  )
    throw Error("Professional is not on shift at this time.");
  if (input.resourceId) {
    const resource = get(db, "resources", input.resourceId);
    if (!resource?.active || resource.locationId !== location.id)
      throw Error("Invalid resource.");
    const busy = db
      .prepare(
        "SELECT a.id FROM appointments a JOIN appointment_meta m ON m.appointment_id=a.id WHERE m.resource_id=? AND a.status NOT IN ('cancelled','no-show') AND a.start<? AND a.end>? AND a.id!=?",
      )
      .get(
        input.resourceId,
        end.toISOString(),
        start.toISOString(),
        exclude || "",
      );
    if (busy) throw Error("This chair or room is already booked.");
  }
  const conflict = db
    .prepare(
      "SELECT id FROM appointments WHERE staff_id=? AND status NOT IN ('cancelled','no-show') AND start<? AND end>? AND id!=?",
    )
    .get(staff.id, end.toISOString(), start.toISOString(), exclude || "");
  const blocked = list(db, "blocks").some(
    (x) =>
      x.staffId === staff.id &&
      x.start < end.toISOString() &&
      x.end > start.toISOString(),
  );
  if (conflict || blocked)
    throw Error("This time is no longer available. Choose another time.");
  return { staff, service, start: start.toISOString(), end: end.toISOString() };
}
export function book(
  db,
  input,
  { publicBooking = false, now = new Date() } = {},
) {
  return transaction(db, () => {
    const slot = validateSlot(db, input, null, now);
    let client = get(db, "clients", input.clientId);
    if (publicBooking) {
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 120 ||
        !/^\S+@\S+\.\S+$/.test(input.email || "")
      )
        throw Error("Enter your name and a valid email address.");
      // Public bookings cannot overwrite an existing client profile by guessing an email.
      client = put(db, "clients", {
        name: input.name.trim(),
        email: input.email.toLowerCase(),
        phone: String(input.phone || "").slice(0, 40),
        notes: "",
        points: 0,
        marketingConsent: input.marketingConsent === true,
      });
    }
    if (!client) throw Error("Select a client.");
    const key = id(),
      token = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO appointments VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
      key,
      input.locationId,
      input.staffId,
      client.id,
      input.serviceId,
      slot.start,
      slot.end,
      "confirmed",
      slot.service.price,
      String(input.notes || "").slice(0, 2000),
      token,
    );
    db.prepare(
      "INSERT INTO appointment_meta(appointment_id,series_id,group_id,resource_id,service_ids,commission) VALUES(?,?,?,?,?,?)",
    ).run(
      key,
      input.seriesId || null,
      input.groupId || null,
      input.resourceId || null,
      JSON.stringify(input.serviceIds || [input.serviceId]),
      slot.staff.commission,
    );
    put(db, "notifications", {
      appointmentId: key,
      channel: "email",
      status: "pending-provider",
      type: "booking-confirmation",
      created: new Date().toISOString(),
    });
    return db.prepare("SELECT * FROM appointments WHERE id=?").get(key);
  });
}
export function checkout(db, key, tip = 0, method = "cash") {
  if (!Number.isInteger(tip) || tip < 0 || tip > 100000)
    throw Error("Invalid tip.");
  if (method !== "cash")
    throw Error("Card payments require a connected payment provider.");
  return transaction(db, () => {
    const appointment = db
      .prepare("SELECT * FROM appointments WHERE id=?")
      .get(key);
    if (
      !appointment ||
      !["confirmed", "checked-in"].includes(appointment.status)
    )
      throw Error("This appointment cannot be checked out.");
    const payment = {
      id: id(),
      appointment_id: key,
      subtotal: appointment.price,
      tip,
      total: appointment.price + tip,
      method,
      created: new Date().toISOString(),
    };
    db.prepare("INSERT INTO payments VALUES(?,?,?,?,?,?,?)").run(
      ...Object.values(payment),
    );
    db.prepare("UPDATE appointments SET status='completed' WHERE id=?").run(
      key,
    );
    const client = get(db, "clients", appointment.client_id);
    put(
      db,
      "clients",
      {
        ...client,
        points: client.points + Math.floor(appointment.price / 100),
      },
      client.id,
    );
    return payment;
  });
}

// Resolve a wall-clock date in a business timezone without assuming a fixed UTC offset.
export function zonedInstant(date, minute, timezone) {
  const target = Date.parse(date + "T00:00:00Z") + minute * 60000;
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(candidate), timezone);
    const observed = Date.parse(p.date + "T00:00:00Z") + p.minute * 60000;
    candidate += target - observed;
  }
  const result = new Date(candidate),
    p = localParts(result, timezone);
  if (p.date !== date || p.minute !== minute)
    throw Error("This local time does not exist due to daylight saving time.");
  return result.toISOString();
}
export function bookSeries(db, input, { now = new Date() } = {}) {
  const count = Number(input.repeatCount || 1),
    weeks = Number(input.repeatWeeks || 1);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12 ||
    ![1, 2, 4].includes(weeks)
  )
    throw Error(
      "Choose 1–12 visits and a weekly, biweekly, or four-week interval.",
    );
  const settings = get(db, "settings", "business"),
    first = localParts(
      new Date(input.start),
      get(db, "locations", input.locationId)?.timezone || settings.timezone,
    );
  const seriesId = count > 1 || input.repeatForever ? id() : null;
  return transaction(db, () => {
    const visits = Array.from({ length: count }, (_, index) => {
      const date = new Date(
        Date.parse(first.date + "T12:00:00Z") + index * weeks * 7 * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      return book(
        db,
        {
          ...input,
          seriesId,
          start: zonedInstant(
            date,
            first.minute,
            get(db, "locations", input.locationId)?.timezone ||
              settings.timezone,
          ),
        },
        { now },
      );
    });
    if (input.repeatForever) {
      const last = localParts(
        new Date(visits.at(-1).start),
        get(db, "locations", input.locationId)?.timezone || settings.timezone,
      );
      put(
        db,
        "recurrences",
        {
          name: "Recurring appointment",
          seriesId,
          locationId: input.locationId,
          staffId: input.staffId,
          serviceId: input.serviceId,
          clientId: input.clientId,
          minute: first.minute,
          weeks,
          nextDate: new Date(
            Date.parse(last.date + "T12:00:00Z") + weeks * 7 * 86400000,
          )
            .toISOString()
            .slice(0, 10),
          active: true,
        },
        seriesId,
      );
    }
    return visits;
  });
}
export function sellProduct(db, productId, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000)
    throw Error("Enter a valid quantity.");
  return transaction(db, () => {
    const product = get(db, "products", productId);
    if (!product || product.stock < quantity)
      throw Error("Insufficient inventory.");
    const sale = {
      id: id(),
      product_id: productId,
      quantity,
      unit_price: product.price,
      total: product.price * quantity,
      created: new Date().toISOString(),
    };
    db.prepare("INSERT INTO sales VALUES(?,?,?,?,?,?)").run(
      ...Object.values(sale),
    );
    put(
      db,
      "products",
      { ...product, stock: product.stock - quantity },
      product.id,
    );
    return sale;
  });
}
