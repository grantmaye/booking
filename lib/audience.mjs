import { list } from "../db.mjs";
export const segments = {
  all: "All opted-in clients",
  new: "No completed visits",
  returning: "Repeat clients",
  lapsed: "No completed visit in 60 days",
  vip: "Five or more completed visits",
};
export function audience(db, segment = "all", now = Date.now()) {
  if (!segments[segment]) throw Error("Unknown audience segment.");
  const visits = db
    .prepare(
      "SELECT client_id,COUNT(*) visits,MAX(start) last FROM appointments WHERE status='completed' GROUP BY client_id",
    )
    .all();
  const history = new Map(visits.map((v) => [v.client_id, v]));
  const unique = new Map();
  for (const c of list(db, "clients")) {
    if (!c.marketingConsent || !c.email) continue;
    const h = history.get(c.id),
      n = h?.visits || 0;
    if (
      (segment === "new" && n !== 0) ||
      (segment === "returning" && n < 2) ||
      (segment === "vip" && n < 5) ||
      (segment === "lapsed" && (!n || Date.parse(h.last) > now - 60 * 86400000))
    )
      continue;
    const key = c.email.trim().toLowerCase();
    if (!unique.has(key)) unique.set(key, c);
  }
  return [...unique.values()];
}
