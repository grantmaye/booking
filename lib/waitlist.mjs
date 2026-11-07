import {
  get,
  list,
  put,
  transaction,
  validateSlot,
  zonedInstant,
  book,
  id,
} from "../db.mjs";
import { enqueue, bookingMessages } from "./messaging.mjs";
import { token, hashToken } from "./security.mjs";
export function matchWaitlist(
  db,
  { now = Date.now(), enabled = Boolean(process.env.RESEND_API_KEY) } = {},
) {
  for (const w of list(db, "waitlist").filter(
    (w) => w.status === "offered" && w.expires <= now,
  ))
    transaction(db, () => {
      db.prepare("DELETE FROM records WHERE kind='blocks' AND id=?").run(
        w.holdId,
      );
      put(db, "waitlist", { ...w, status: "expired" }, w.id);
    });
  if (!enabled) return 0;
  let offered = 0;
  for (const w of list(db, "waitlist")
    .filter((w) => w.status === "waiting")
    .slice(0, 25)) {
    const location = get(db, "locations", w.locationId);
    if (!location || !get(db, "services", w.serviceId)?.active) continue;
    const zone = location.timezone || get(db, "settings", "business").timezone;
    const staff = list(db, "staff").filter(
      (s) =>
        s.active &&
        (s.locationIds || [s.locationId]).includes(w.locationId) &&
        (!w.staffId || w.staffId === s.id),
    );
    let found = false;
    for (const s of staff) {
      if (found) break;
      for (let m = location.open * 60; m < location.close * 60; m += 15) {
        try {
          transaction(db, () => {
            const start = zonedInstant(w.date, m, zone),
              slot = validateSlot(
                db,
                {
                  locationId: w.locationId,
                  staffId: s.id,
                  serviceId: w.serviceId,
                  start,
                },
                null,
                new Date(now),
              );
            const raw = token(),
              holdId = id();
            put(
              db,
              "blocks",
              {
                staffId: s.id,
                start: slot.start,
                end: slot.end,
                notes: "Waitlist offer hold",
              },
              holdId,
            );
            put(
              db,
              "waitlist",
              {
                ...w,
                status: "offered",
                staffId: s.id,
                start: slot.start,
                expires: now + 15 * 60000,
                holdId,
                claimHash: hashToken(raw),
              },
              w.id,
            );
            enqueue(db, {
              to: w.email,
              subject: "An appointment opened up",
              body: `A time is available. Claim it within 15 minutes: ${process.env.PUBLIC_ORIGIN || "http://127.0.0.1:3000"}/waitlist#${raw}`,
              dedupe: "waitlist:" + w.id,
            });
          });
          offered++;
          found = true;
          break;
        } catch (e) {
          if (!/available|hours|window|shift|booked/.test(e.message)) throw e;
        }
      }
    }
  }
  return offered;
}
export function waitlistOffer(db, raw) {
  const w = list(db, "waitlist").find(
    (w) => w.claimHash === hashToken(raw || ""),
  );
  if (!w || w.status !== "offered" || w.expires < Date.now())
    throw Error("This offer has expired or has already been claimed.");
  return w;
}
export function claimWaitlist(db, raw) {
  return transaction(db, () => {
    const w = waitlistOffer(db, raw);
    db.prepare("DELETE FROM records WHERE kind='blocks' AND id=?").run(
      w.holdId,
    );
    const a = book(
      db,
      {
        locationId: w.locationId,
        staffId: w.staffId,
        serviceId: w.serviceId,
        start: w.start,
        name: w.name,
        email: w.email,
      },
      { publicBooking: true },
    );
    bookingMessages(db, a);
    put(db, "waitlist", { ...w, status: "booked", appointmentId: a.id }, w.id);
    return { manageToken: a.token };
  });
}
