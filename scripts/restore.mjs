import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
if (process.argv.length !== 4)
  throw Error("Usage: npm run restore -- backup.sqlite new-database.sqlite");
const source = resolve(process.argv[2]),
  target = resolve(process.argv[3]);
const db = new DatabaseSync(source, { readOnly: true });
try {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw Error("Backup failed integrity check.");
} finally {
  db.close();
}
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target, constants.COPYFILE_EXCL);
await chmod(target, 0o600);
console.log(
  `Restored to ${target}. Stop the app, set DB_PATH to this file, then restart. Existing databases were not overwritten.`,
);
