import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDB,
  seed,
  book,
  checkout,
  list,
  get,
  put,
  passwordHash,
  passwordMatches,
  localParts,
} from "../db.mjs";
const now = new Date("2026-11-02T12:00:00Z");
function setup() {
  const db = openDB(":memory:");
  seed(db);
  return db;
}
const input = {
  locationId: "south-end",
  staffId: "marcus",
  serviceId: "cut",
  clientId: "client-0",
  start: "2026-11-03T15:00:00Z",
};
test("booking persists correct duration and price", () => {
  const db = setup();
  const a = book(db, input, { now });
  assert.equal(a.end, "2026-11-03T15:45:00.000Z");
  assert.equal(a.price, 4500);
  assert.equal(a.status, "confirmed");
  db.close();
});
test("overlapping booking is rejected and adjacent booking succeeds", () => {
  const db = setup();
  book(db, input, { now });
  assert.throws(
    () => book(db, { ...input, start: "2026-11-03T15:30:00Z" }, { now }),
    /no longer available/,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM appointments").get().n, 1);
  book(db, { ...input, start: "2026-11-03T15:45:00Z" }, { now });
  db.close();
});
test("other professionals can book at the same time", () => {
  const db = setup();
  book(db, input, { now });
  book(db, { ...input, staffId: "alex" }, { now });
  assert.equal(db.prepare("SELECT count(*) n FROM appointments").get().n, 2);
  db.close();
});
test("rejects past, closed days, wrong location, off-grid, and beyond booking window", () => {
  const db = setup();
  for (const change of [
    { start: "2026-11-01T15:00:00Z" },
    { start: "2026-11-08T15:00:00Z" },
    { locationId: "noda" },
    { start: "2026-11-03T15:07:00Z" },
    { start: "2027-11-03T15:00:00Z" },
    { start: "2026-11-03T23:45:00Z" },
  ])
    assert.throws(() => book(db, { ...input, ...change }, { now }));
  db.close();
});
test("time-off blocks booking and cleanup buffer is protected", () => {
  const db = setup();
  put(db, "blocks", {
    staffId: "marcus",
    start: "2026-11-03T15:00:00.000Z",
    end: "2026-11-03T16:00:00.000Z",
  });
  assert.throws(() => book(db, input, { now }), /no longer available/);
  const svc = get(db, "services", "cut");
  put(db, "services", { ...svc, buffer: 15 }, "cut");
  book(db, { ...input, staffId: "alex" }, { now });
  assert.throws(
    () =>
      book(
        db,
        { ...input, staffId: "alex", start: "2026-11-03T15:45:00Z" },
        { now },
      ),
    /no longer available/,
  );
  db.close();
});
test("failed public booking rolls back client and notification changes", () => {
  const db = setup();
  book(db, input, { now });
  const before = list(db, "clients").length;
  assert.throws(() =>
    book(
      db,
      { ...input, name: "Guest", email: "guest@example.com" },
      { now, publicBooking: true },
    ),
  );
  assert.equal(list(db, "clients").length, before);
  assert.equal(list(db, "notifications").length, 1);
  db.close();
});
test("public booking does not mutate existing profile using known email", () => {
  const db = setup();
  const c = get(db, "clients", "client-0");
  const a = book(
    db,
    { ...input, name: "Someone else", email: c.email },
    { now, publicBooking: true },
  );
  assert.notEqual(a.client_id, c.id);
  assert.equal(get(db, "clients", c.id).name, c.name);
  db.close();
});
test("cash checkout atomically records payment and loyalty once", () => {
  const db = setup();
  const a = book(db, input, { now });
  const p = checkout(db, a.id, 500);
  assert.equal(p.total, 5000);
  assert.equal(get(db, "clients", "client-0").points, 45);
  assert.throws(() => checkout(db, a.id, 500), /cannot be checked out/);
  assert.equal(db.prepare("SELECT count(*) n FROM payments").get().n, 1);
  assert.equal(get(db, "clients", "client-0").points, 45);
  db.close();
});
test("unconnected card processor and invalid tips cannot collect payment", () => {
  const db = setup();
  const a = book(db, input, { now });
  assert.throws(() => checkout(db, a.id, 0, "card"), /provider/);
  assert.throws(() => checkout(db, a.id, -1));
  assert.throws(() => checkout(db, a.id, 0.5));
  assert.equal(db.prepare("SELECT count(*) n FROM payments").get().n, 0);
  db.close();
});
test("cancelled appointment frees capacity", () => {
  const db = setup();
  const a = book(db, input, { now });
  db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(a.id);
  book(db, input, { now });
  db.close();
});
test("seed is idempotent and password checks use salted hashes", () => {
  const db = setup();
  seed(db);
  assert.equal(list(db, "clients").length, 8);
  const hash = passwordHash("a secure password");
  assert.ok(passwordMatches("a secure password", hash));
  assert.equal(passwordMatches("wrong password", hash), false);
  assert.notEqual(hash, passwordHash("a secure password"));
  db.close();
});
test("timezone conversion observes daylight saving time", () => {
  assert.equal(
    localParts(new Date("2026-07-01T13:00:00Z"), "America/New_York").minute,
    540,
  );
  assert.equal(
    localParts(new Date("2026-12-01T14:00:00Z"), "America/New_York").minute,
    540,
  );
});

import { bookSeries, sellProduct, zonedInstant } from "../db.mjs";
test("recurring visits preserve local time across DST", () => {
  const db = setup();
  const visits = bookSeries(
    db,
    { ...input, start: "2026-10-27T14:00:00Z", repeatCount: 2, repeatWeeks: 1 },
    { now: new Date("2026-10-26T12:00:00Z") },
  );
  assert.equal(visits[0].start, "2026-10-27T14:00:00.000Z");
  assert.equal(visits[1].start, "2026-11-03T15:00:00.000Z");
  db.close();
});
test("a conflict in a later recurring visit rolls back the whole series", () => {
  const db = setup();
  book(db, input, { now });
  assert.throws(
    () =>
      bookSeries(
        db,
        { ...input, start: "2026-10-27T14:00:00Z", repeatCount: 2 },
        { now: new Date("2026-10-26T12:00:00Z") },
      ),
    /no longer available/,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM appointments").get().n, 1);
  db.close();
});
test("retail sale decrements stock atomically and rejects overselling", () => {
  const db = setup();
  const p = list(db, "products")[0],
    sale = sellProduct(db, p.id, 2);
  assert.equal(sale.total, p.price * 2);
  assert.equal(get(db, "products", p.id).stock, p.stock - 2);
  assert.throws(() => sellProduct(db, p.id, 1000), /Insufficient/);
  assert.equal(db.prepare("SELECT count(*) n FROM sales").get().n, 1);
  db.close();
});
test("nonexistent DST local time is rejected", () =>
  assert.throws(
    () => zonedInstant("2026-03-08", 150, "America/New_York"),
    /does not exist/,
  ));
