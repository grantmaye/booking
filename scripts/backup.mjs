import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, chmod, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const source = resolve(process.env.DB_PATH || "data/chairside.sqlite"),
  destination = resolve(
    process.argv[2] ||
      `backups/chairside-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
  );
if (source === destination)
  throw Error("Backup destination must differ from source.");
try {
  await access(destination);
  throw Error("Backup destination already exists. Choose a new filename.");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await mkdir(dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  await chmod(destination, 0o600);
  const check = new DatabaseSync(destination, { readOnly: true });
  try {
    if (check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("Backup integrity check failed.");
  } finally {
    check.close();
  }
  console.log(JSON.stringify({ backup: destination, integrity: "ok" }));
} finally {
  db.close();
}
