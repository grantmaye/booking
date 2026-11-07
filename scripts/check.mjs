import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const files = ["server.mjs", "db.mjs"];
for (const dir of ["lib", "public", "scripts", "test"])
  for (const file of await readdir(dir))
    if (/\.(mjs|js)$/.test(file)) files.push(dir + "/" + file);
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (r.status) process.exit(r.status);
}
console.log(`Syntax checked ${files.length} modules.`);
