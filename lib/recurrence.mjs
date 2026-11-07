import {
  get,
  list,
  put,
  book,
  localParts,
  zonedInstant,
  transaction,
} from "../db.mjs";
import { bookingMessages } from "./messaging.mjs";
export function extendRecurrences(db, { now = new Date() } = {}) {
  let count = 0;
  for (const template of list(db, "recurrences").filter((t) => t.active)) {
    const settings = get(db, "settings", "business"),
      location = get(db, "locations", template.locationId);
    if (!location) continue;
    const zone = location.timezone || settings.timezone;
    let date = template.nextDate;
    let iterations = 0;
    while (iterations++ < 60) {
      const start = zonedInstant(date, template.minute, zone);
      if (Date.parse(start) > +now + settings.bookingDays * 86400000) break;
      const following = new Date(
        Date.parse(date + "T12:00:00Z") + template.weeks * 7 * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      if (Date.parse(start) <= +now) {
        date = following;
        put(db, "recurrences", { ...template, nextDate: date }, template.id);
        continue;
      }
      try {
        transaction(db, () => {
          const existing = db
            .prepare(
              "SELECT a.id FROM appointments a JOIN appointment_meta m ON m.appointment_id=a.id WHERE m.series_id=? AND a.start=?",
            )
            .get(template.seriesId, start);
          if (!existing) {
            const a = book(db, { ...template, start }, { now });
            bookingMessages(db, a);
            count++;
          }
          put(
            db,
            "recurrences",
            { ...template, nextDate: following, lastError: null },
            template.id,
          );
        });
        date = following;
      } catch (e) {
        put(
          db,
          "recurrences",
          { ...template, nextDate: date, lastError: e.message, active: false },
          template.id,
        );
        break;
      }
    }
  }
  return count;
}
