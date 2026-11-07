// Explicit opt-in LAN demo. Uses only a dedicated fictional database.
import { resolve } from "node:path";
import { openDB, seed, passwordHash, put } from "../db.mjs";
if (process.env.NODE_ENV === "production")
  throw Error("The mobile demo cannot run in production.");
process.env.DB_PATH = resolve("data/mobile-demo.sqlite");
process.env.PORT = process.env.PORT || "3002";
process.env.HOST = process.env.HOST || "0.0.0.0";
const db = openDB();
seed(db);
for (const [key, role, staffId, clientId] of [
  ["owner", "owner", null, null],
  ["staff", "staff", "marcus", null],
  ["customer", "customer", null, "client-0"],
]) {
  if (!db.prepare("SELECT id FROM users WHERE id=?").get("mobile-" + key)) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      "mobile-" + key,
      key + "@chairside.test",
      "Demo " + key,
      passwordHash("chairside-mobile-demo"),
      role,
    );
    db.prepare(
      "INSERT INTO user_access(user_id,staff_id,client_id) VALUES(?,?,?)",
    ).run("mobile-" + key, staffId, clientId);
  }
}
// Keep a recognizable customer profile while retaining appointments between restarts.
const row = db
  .prepare("SELECT data FROM records WHERE id='client-0' AND kind='clients'")
  .get();
if (row) {
  const c = JSON.parse(row.data);
  put(
    db,
    "clients",
    { ...c, name: "Jamie Taylor", email: "customer@chairside.test" },
    "client-0",
  );
}
db.close();
console.log(
  "Local LAN demo only: owner@chairside.test, staff@chairside.test, customer@chairside.test / chairside-mobile-demo",
);
await import("../server.mjs");
