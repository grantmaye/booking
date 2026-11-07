import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { once } from "node:events";
const suffix = randomBytes(5).toString("hex"),
  name = "chairside-verify-" + suffix,
  volume = name + "-data";
const secret = randomBytes(32).toString("hex"),
  setup = randomBytes(32).toString("hex");
const env = {
  ...process.env,
  APP_SECRET: secret,
  SETUP_TOKEN: setup,
  PUBLIC_ORIGIN: "https://release.example.com",
  RUN_WORKER: "false",
};
const docker = (...args) =>
  execFileSync("docker", args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
let logs;
async function ready(since) {
  logs = spawn("docker", ["logs", "--since", since, "--follow", name], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      logs.kill();
      reject(Error("Container startup timed out."));
    }, 30000);
    const check = (chunk) => {
      if (chunk.toString().includes("Chairside ready")) {
        clearTimeout(timer);
        resolve();
      }
    };
    logs.stdout.on("data", check);
    logs.stderr.on("data", check);
    logs.on("error", reject);
    logs.on("exit", (code) => {
      if (code) reject(Error("Container log stream exited."));
    });
  });
  logs.kill();
}
try {
  docker("volume", "create", volume);
  const startedAt = new Date().toISOString();
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--init",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "-e",
    "APP_SECRET",
    "-e",
    "SETUP_TOKEN",
    "-e",
    "PUBLIC_ORIGIN",
    "-e",
    "RUN_WORKER",
    "-p",
    "127.0.0.1::3000",
    "-v",
    volume + ":/app/data",
    process.argv[2] || "chairside:verify",
  );
  await ready(startedAt);
  const address = docker("port", name, "3000/tcp").split("\n")[0];
  let base = "http://" + address;
  let cookie = "";
  const req = async (path, method = "GET", body) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie"),
    };
  };
  assert.equal((await req("/health")).status, 200);
  assert.equal((await req("/public/catalog")).data.locations.length, 0);
  const account = await req("/setup", "POST", {
    name: "Release Owner",
    email: "release@example.com",
    password: randomBytes(20).toString("hex"),
    setupToken: setup,
  });
  assert.equal(account.status, 200, JSON.stringify(account.data));
  assert.match(account.cookie, /Secure/);
  cookie = account.cookie.split(";")[0];
  const location = await req("/records/locations", "POST", {
    name: "Release Studio",
    address: "Test only",
    open: 9,
    close: 17,
    days: [1, 2, 3, 4, 5],
    timezone: "America/New_York",
  });
  assert.equal(location.status, 200, JSON.stringify(location.data));
  docker(
    "exec",
    name,
    "node",
    "scripts/backup.mjs",
    "/app/backups/release.sqlite",
  );
  docker(
    "exec",
    name,
    "node",
    "scripts/restore.mjs",
    "/app/backups/release.sqlite",
    "/app/data/restored.sqlite",
  );
  const restartingAt = new Date().toISOString();
  docker("restart", name);
  await ready(restartingAt);
  base = "http://" + docker("port", name, "3000/tcp").split("\n")[0];
  assert.equal((await req("/data")).data.locations[0].name, "Release Studio");
  assert.equal(
    docker(
      "exec",
      name,
      "node",
      "-e",
      "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/app/data/restored.sqlite');console.log(d.prepare('PRAGMA integrity_check').get().integrity_check);d.close()",
    ),
    "ok",
  );
  console.log(
    JSON.stringify({
      container: "passed",
      productionSeed: "empty",
      secureCookie: true,
      persistentRestart: "passed",
      backupRestore: "passed",
      image: process.argv[2] || "chairside:verify",
    }),
  );
} finally {
  logs?.kill();
  try {
    docker("rm", "-f", "-v", name);
  } catch {}
  try {
    docker("volume", "rm", volume);
  } catch {}
}
