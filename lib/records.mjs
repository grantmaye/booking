import { get, list } from "../db.mjs";
import { integer } from "./commerce.mjs";
export const extraSchemas = {
  shifts: ["name", "staffId", "locationId", "days", "startMinute", "endMinute"],
  resources: ["name", "locationId", "active"],
  promotions: [
    "name",
    "code",
    "type",
    "value",
    "active",
    "expires",
    "maxUses",
    "uses",
  ],
  suppliers: ["name", "email", "phone"],
  purchaseOrders: ["name", "supplierId", "locationId", "items", "status"],
  branding: [
    "name",
    "headline",
    "description",
    "accent",
    "logoId",
    "reviewUrl",
    "instagramUrl",
  ],
  portfolio: ["name", "caption", "imageId", "staffId"],
  timesheets: ["name", "staffId", "start", "end"],
};
export function validateExtra(db, kind, d) {
  if (kind === "shifts") {
    if (
      !get(db, "staff", d.staffId) ||
      !get(db, "locations", d.locationId) ||
      !Array.isArray(d.days) ||
      !d.days.length ||
      d.days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)
    )
      throw Error("Invalid shift.");
    integer(d.startMinute, 0, 1439);
    integer(d.endMinute, 1, 1440);
    if (d.startMinute >= d.endMinute)
      throw Error("Shift must end after it starts.");
  }
  if (
    kind === "resources" &&
    (!get(db, "locations", d.locationId) || typeof d.active !== "boolean")
  )
    throw Error("Invalid resource.");
  if (kind === "promotions") {
    if (
      !/^[A-Z0-9_-]{3,30}$/.test(d.code || "") ||
      !["percent", "fixed"].includes(d.type)
    )
      throw Error("Invalid promotion code or type.");
    integer(d.value, 1, d.type === "percent" ? 100 : 1000000);
    integer(d.maxUses || 0);
    integer(d.uses || 0);
    if (list(db, "promotions").some((p) => p.code === d.code && p.id !== d.id))
      throw Error("Promotion code already exists.");
  }
  if (kind === "purchaseOrders") {
    if (
      !get(db, "locations", d.locationId) ||
      !get(db, "suppliers", d.supplierId) ||
      !Array.isArray(d.items) ||
      !d.items.length ||
      d.items.length > 100
    )
      throw Error("Invalid purchase order.");
    for (const item of d.items) {
      if (!get(db, "products", item.productId)) throw Error("Unknown product.");
      integer(item.quantity, 1, 10000);
    }
    if (d.status !== "ordered")
      throw Error("Use the receive action to receive stock.");
  }
  if (kind === "branding") {
    if (d.accent && !/^#[0-9a-f]{6}$/i.test(d.accent))
      throw Error("Invalid brand color.");
    for (const k of ["reviewUrl", "instagramUrl"])
      if (d[k] && !/^https:\/\//.test(d[k]))
        throw Error("Links must use HTTPS.");
  }
  if (
    kind === "portfolio" &&
    !db.prepare("SELECT id FROM uploads WHERE id=? AND public=1").get(d.imageId)
  )
    throw Error("Choose a public uploaded image.");
  return d;
}
