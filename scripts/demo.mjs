// Explicitly opt-in local demo. Never uses the production database.
import { openDB, seed, id, passwordHash, book } from "../db.mjs";
import { resolve } from "node:path";
if (process.env.NODE_ENV === "production")
  throw Error("Demo mode is only for local development.");
process.env.DB_PATH = resolve("data/demo.sqlite");
process.env.PORT = "3001";
process.env.HOST = "127.0.0.1";
const db = openDB();
seed(db);
if (!db.prepare("SELECT id FROM users LIMIT 1").get())
  db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
    id(),
    "demo@example.com",
    "Demo Owner",
    passwordHash("chairside-demo-only"),
    "owner",
  );
if (!db.prepare("SELECT id FROM appointments LIMIT 1").get()) {
  let count = 0;
  for (let n = 1; n <= 14 && count < 8; n++) {
    const start = new Date(Date.now() + n * 3600000);
    start.setUTCMinutes(0, 0, 0);
    try {
      book(db, {
        locationId: "south-end",
        staffId: ["marcus", "alex", "jordan"][count % 3],
        serviceId: ["cut", "fade", "beard"][count % 3],
        clientId: "client-" + count,
        start: start.toISOString(),
        notes: "Fictional demo appointment",
      });
      count++;
    } catch {}
  }
}
db.close();
console.log("Local demo: demo@example.com / chairside-demo-only");
await import("../server.mjs");
