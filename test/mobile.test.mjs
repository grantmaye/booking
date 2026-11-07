import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { openDB, seed, passwordHash, put } from "../db.mjs";
import { hashToken, issueToken, newMFA } from "../lib/security.mjs";
import * as OTPAuth from "otpauth";

test("native sessions preserve security, scoped booking and staff workflows", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "chairside-mobile-")),
    db = openDB(join(dir, "test.sqlite"));
  seed(db);
  const password = "mobile-integration-password";
  for (const [id, role, staffId, clientId] of [
    ["owner", "owner", null, null],
    ["pro", "staff", "marcus", null],
    ["other", "staff", "alex", null],
    ["customer", "customer", null, "client-0"],
    ["customer2", "customer", null, "client-1"],
  ]) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
      id,
      id + "@example.com",
      id,
      passwordHash(password),
      role,
    );
    db.prepare(
      "INSERT INTO user_access(user_id,staff_id,client_id) VALUES(?,?,?)",
    ).run(id, staffId, clientId);
  }
  const port = 32000 + Math.floor(Math.random() * 18000);
  const child = spawn(process.execPath, ["server.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      SEED_DEMO: "true",
      APP_SECRET: "mobile-test-secret-long-enough-for-production",
      DB_PATH: join(dir, "test.sqlite"),
      HOST: "127.0.0.1",
      PORT: String(port),
      RUN_WORKER: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stderr.on("data", (x) => (logs += x));
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw Error(logs);
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Startup timeout")), 10000).unref(),
      ),
    ]);
    async function req(
      path,
      { token, method = "GET", body, headers = {} } = {},
    ) {
      const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: r.status,
        data: await r.json(),
        cookie: r.headers.get("set-cookie"),
      };
    }
    async function login(id, extra = {}) {
      return req("/mobile/login", {
        method: "POST",
        body: { email: id + "@example.com", password, ...extra },
      });
    }
    let owner, customer, pro, appointment;
    await t.test(
      "mobile token is hashed, expires, and cannot be used as a browser cookie",
      async () => {
        owner = await login("owner");
        assert.equal(owner.status, 200);
        assert.match(owner.data.token, /^[a-f0-9]{64}$/);
        assert.equal(owner.cookie, null);
        const saved = db
          .prepare("SELECT * FROM sessions WHERE user_id=?")
          .get("owner");
        assert.equal(saved.token, "mobile:" + hashToken(owner.data.token));
        assert.equal(saved.expires, owner.data.expires);
        assert.equal(owner.data.user.role, "owner");
        assert.equal(owner.data.user.password, undefined);
        assert.equal(
          (await req("/account", { token: owner.data.token })).data.id,
          "owner",
        );
        assert.equal(
          (
            await req("/account", {
              headers: { Cookie: "session=" + saved.token },
            })
          ).status,
          401,
        );
        const web = await req("/login", {
          method: "POST",
          body: { email: "owner@example.com", password },
        });
        assert.match(web.cookie, /HttpOnly/);
        assert.match(web.cookie, /Secure/);
        assert.equal(web.data.token, undefined);
        assert.equal(
          (
            await req("/account", {
              headers: {
                Cookie: web.cookie.split(";")[0],
                Authorization: "Bearer bad",
              },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await req("/mobile/login", {
              method: "POST",
              body: { email: "owner@example.com", password },
              headers: { Origin: "https://hostile.example" },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "customer booking, multi-service history, ownership checks and conversation isolation",
      async () => {
        customer = await login("customer");
        const customer2 = await login("customer2");
        assert.equal(
          (await req("/data", { token: customer.data.token })).status,
          403,
        );
        let slots = [];
        for (let n = 3; n < 10 && !slots.length; n++) {
          const date = new Date(Date.now() + n * 86400000)
            .toISOString()
            .slice(0, 10);
          slots = (
            await req(
              "/public/availability?" +
                new URLSearchParams({
                  locationId: "south-end",
                  staffId: "marcus",
                  serviceId: "cut",
                  serviceIds: "cut,beard",
                  date,
                }),
            )
          ).data;
        }
        assert.ok(slots.length > 1);
        const booked = await req("/portal/book", {
          token: customer.data.token,
          method: "POST",
          body: {
            locationId: "south-end",
            staffId: "marcus",
            serviceId: "cut",
            serviceIds: ["cut", "beard"],
            start: slots[0].start,
            clientId: "client-1",
          },
        });
        assert.equal(booked.status, 200);
        appointment = booked.data;
        assert.equal(appointment.client_id, "client-0");
        assert.equal(appointment.token, undefined);
        const query =
          "/public/availability?" +
          new URLSearchParams({
            locationId: "south-end",
            staffId: "marcus",
            serviceId: "cut",
            serviceIds: "cut,beard",
            date: appointment.start.slice(0, 10),
            appointmentId: appointment.id,
          });
        assert.ok(
          (await req(query, { token: customer.data.token })).data.some(
            (slot) => slot.start === appointment.start,
          ),
        );
        assert.equal(
          (await req(query, { token: customer2.data.token })).status,
          404,
        );

        const portal = (await req("/portal", { token: customer.data.token }))
          .data;
        assert.deepEqual(JSON.parse(portal.appointments[0].service_ids), [
          "cut",
          "beard",
        ]);
        assert.equal(
          (
            await req("/portal/appointments/" + appointment.id, {
              token: customer2.data.token,
              method: "POST",
              body: { action: "cancel" },
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await req("/portal/appointments/" + appointment.id, {
              token: customer.data.token,
              method: "POST",
              body: { action: "reschedule", start: slots.at(-1).start },
            })
          ).status,
          200,
        );
        await req("/messages", {
          token: customer.data.token,
          method: "POST",
          body: { body: "My private message", clientId: "client-1" },
        });
        assert.equal(
          (
            await req("/messages?clientId=client-1", {
              token: customer.data.token,
            })
          ).data.length,
          1,
        );
        assert.equal(
          (
            await req("/messages?clientId=client-0", {
              token: customer2.data.token,
            })
          ).data.length,
          0,
        );
        assert.equal(
          (
            await req("/messages?clientId=client-0", {
              token: owner.data.token,
            })
          ).data[0].body,
          "My private message",
        );
      },
    );
    await t.test(
      "professionals only access their own visits and cannot collect payment",
      async () => {
        pro = await login("pro");
        const other = await login("other");
        assert.equal(
          (await req("/data", { token: pro.data.token })).data.appointments
            .length,
          1,
        );
        assert.equal(
          (await req("/data", { token: other.data.token })).data.appointments
            .length,
          0,
        );
        assert.equal(
          (
            await req("/appointments/" + appointment.id, {
              token: other.data.token,
              method: "PATCH",
              body: { status: "checked-in" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await req("/appointments/" + appointment.id, {
              token: pro.data.token,
              method: "PATCH",
              body: { status: "checked-in" },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await req("/commerce/orders", {
              token: pro.data.token,
              method: "POST",
              body: { appointmentId: appointment.id },
              headers: { "Idempotency-Key": "mobile-test-order" },
            })
          ).status,
          403,
        );
        assert.equal(
          (await req("/messages?clientId=client-0", { token: pro.data.token }))
            .status,
          403,
        );
        const shift = await req("/timesheets/clock", {
          token: pro.data.token,
          method: "POST",
          body: { action: "in", staffId: "alex" },
        });
        assert.equal(shift.data.staffId, "marcus");
        assert.equal(
          (
            await req("/timesheets/clock", {
              token: pro.data.token,
              method: "POST",
              body: { action: "out" },
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      "operator checkout is idempotent and a paid visit can be completed",
      async () => {
        const payload = { appointmentId: appointment.id, tip: 500 },
          headers = { "Idempotency-Key": "mobile-test-order" };
        const first = await req("/commerce/orders", {
          token: owner.data.token,
          method: "POST",
          body: payload,
          headers,
        });
        assert.equal(first.status, 200);
        assert.equal(
          (
            await req("/mobile/appointments/" + appointment.id + "/order", {
              token: owner.data.token,
            })
          ).data.order.id,
          first.data.id,
        );
        assert.equal(
          (
            await req("/mobile/appointments/" + appointment.id + "/order", {
              token: customer.data.token,
            })
          ).status,
          403,
        );

        const retry = await req("/commerce/orders", {
          token: owner.data.token,
          method: "POST",
          body: payload,
          headers,
        });
        assert.equal(first.data.id, retry.data.id);
        assert.equal(
          (
            await req("/commerce/orders/" + first.data.id + "/pay", {
              token: owner.data.token,
              method: "POST",
              body: { tenders: [{ method: "cash", amount: first.data.total }] },
            })
          ).status,
          200,
        );
        assert.equal(
          db
            .prepare("SELECT status FROM appointments WHERE id=?")
            .get(appointment.id).status,
          "completed",
        );
        assert.equal(
          (
            await req("/commerce/orders/" + first.data.id + "/receipt", {
              token: customer.data.token,
            })
          ).data.status,
          "paid",
        );
      },
    );
    await t.test(
      "logout, password reset, disabled accounts, expiry and MFA apply to mobile",
      async () => {
        await req("/logout", {
          token: owner.data.token,
          method: "POST",
          body: {},
        });
        assert.equal(
          (await req("/account", { token: owner.data.token })).status,
          401,
        );
        db.prepare("UPDATE sessions SET expires=0 WHERE user_id=?").run("pro");
        assert.equal(
          (await req("/account", { token: pro.data.token })).status,
          401,
        );
        db.prepare("UPDATE user_access SET disabled=1 WHERE user_id=?").run(
          "customer",
        );
        assert.equal(
          (await req("/account", { token: customer.data.token })).status,
          401,
        );
        assert.equal((await login("customer")).status, 403);
        db.prepare("UPDATE user_access SET disabled=0 WHERE user_id=?").run(
          "customer",
        );
        const reset = issueToken(db, "customer", "reset");
        assert.equal(
          (
            await req("/public/reset", {
              method: "POST",
              body: { token: reset, password: "replacement-long-password" },
            })
          ).status,
          200,
        );
        assert.equal(
          db
            .prepare("SELECT count(*) n FROM sessions WHERE user_id=?")
            .get("customer").n,
          0,
        );
        db.prepare("DELETE FROM rate_limits").run();
        const mfa = newMFA("owner@example.com");
        db.prepare("UPDATE user_access SET mfa_secret=? WHERE user_id=?").run(
          mfa.secret,
          "owner",
        );
        assert.equal((await login("owner")).status, 401);
        const code = new OTPAuth.TOTP({
          secret: OTPAuth.Secret.fromBase32(mfa.secret),
          digits: 6,
          period: 30,
        }).generate();
        assert.equal((await login("owner", { code })).status, 200);
      },
    );
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
