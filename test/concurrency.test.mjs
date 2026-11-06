import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB, seed } from "../db.mjs";

test(
  "independent SQLite connections cannot both reserve the same slot",
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "chairside-race-")),
      path = join(dir, "race.sqlite");
    const initial = openDB(path);
    seed(initial);
    initial.close();
    const gate = new SharedArrayBuffer(4),
      workers = [];
    try {
      const code = `const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {openDB,book}=await import(workerData.module);const db=openDB(workerData.path);parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.gate),0,0);try{book(db,{locationId:'south-end',staffId:'marcus',serviceId:'cut',clientId:'client-0',start:'2026-11-03T15:00:00Z'},{now:new Date('2026-11-02T12:00:00Z')});parentPort.postMessage({ok:true});}catch(e){parentPort.postMessage({ok:false,error:e.message});}finally{db.close();}})().catch(e=>{throw e;});`;
      const ready = Array.from({ length: 2 }, () => {
        const w = new Worker(code, {
          eval: true,
          workerData: {
            module: new URL("../db.mjs", import.meta.url).href,
            path,
            gate,
          },
        });
        workers.push(w);
        return once(w, "message");
      });
      await Promise.all(ready);
      const exits = workers.map((w) => once(w, "exit"));
      const outcomes = workers.map((w) => once(w, "message"));
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0, 2);
      const results = (await Promise.all(outcomes)).map(([v]) => v);
      assert.equal(results.filter((x) => x.ok).length, 1);
      assert.match(results.find((x) => !x.ok).error, /no longer available/);
      await Promise.all(exits);
      const db = openDB(path);
      assert.equal(
        db.prepare("SELECT count(*) n FROM appointments").get().n,
        1,
      );
      db.close();
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
