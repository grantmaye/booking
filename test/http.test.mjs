import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
test("HTTP lifecycle: setup, session security, CRUD, public booking, conflicts, checkout, cancellation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chairside-test-"));
  const port = 31000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.mjs"], {
    env: {
      ...process.env,
      DB_PATH: join(dir, "test.sqlite"),
      PORT: String(port),
      HOST: "127.0.0.1",
      SETUP_TOKEN: "integration-test-token",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(([code]) => {
        throw Error("Server exited " + code);
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(Error("Server startup timed out")),
          10000,
        );
        timer.unref();
      }),
    ]);
    let cookie = "";
    const req = async (
      path,
      { method = "GET", body, auth = true, origin } = {},
    ) => {
      const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Cookie: cookie } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: r.status,
        data: await r.json(),
        cookie: r.headers.get("set-cookie"),
      };
    };
    assert.equal((await req("/data")).status, 401);
    assert.equal(
      (
        await req("/setup", {
          method: "POST",
          body: {
            name: "Test Owner",
            email: "owner@example.com",
            password: "a-long-test-password",
          },
        })
      ).status,
      403,
    );
    const setup = await req("/setup", {
      method: "POST",
      body: {
        name: "Test Owner",
        email: "owner@example.com",
        password: "a-long-test-password",
        setupToken: "integration-test-token",
      },
    });
    assert.equal(setup.status, 200);
    assert.match(setup.cookie, /HttpOnly/);
    cookie = setup.cookie.split(";")[0];
    assert.equal((await req("/session")).data.user.name, "Test Owner");
    assert.equal(
      (
        await req("/records/products", {
          method: "POST",
          body: { name: "Test product", price: 1000, stock: 5, reorderAt: 2 },
          origin: "https://evil.example",
        })
      ).status,
      403,
    );
    const product = await req("/records/products", {
      method: "POST",
      body: { name: "Test product", price: 1000, stock: 5, reorderAt: 2 },
    });
    assert.equal(product.status, 200);
    assert.ok(product.data.id);
    assert.equal(
      (
        await req("/records/products", {
          method: "POST",
          body: { name: "Bad product" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/records/staff", {
          method: "POST",
          body: {
            name: "Bad color",
            title: "Test",
            color: '\" onmouseover=\"alert(1)',
            locationId: "south-end",
            commission: 50,
            active: true,
          },
        })
      ).status,
      400,
    );
    let slots = [];
    let date;
    for (let n = 2; n < 9 && !slots.length; n++) {
      date = new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
      slots = (
        await req(
          "/public/availability?" +
            new URLSearchParams({
              locationId: "south-end",
              staffId: "marcus",
              serviceId: "cut",
              date,
            }),
          { auth: false },
        )
      ).data;
    }
    assert.ok(slots.length);
    const input = {
      locationId: "south-end",
      staffId: "marcus",
      serviceId: "cut",
      start: slots[0].start,
      name: "QA Client",
      email: "qa@example.com",
    };
    const booked = await req("/public/book", {
      method: "POST",
      body: input,
      auth: false,
    });
    assert.equal(booked.status, 201);
    assert.equal(booked.data.manageToken.length, 48);
    const conflict = await req("/public/book", {
      method: "POST",
      body: input,
      auth: false,
    });
    assert.equal(conflict.status, 400);
    const data = (await req("/data")).data;
    assert.equal(data.appointments.length, 1);
    assert.equal(data.appointments[0].token, undefined);
    assert.equal(
      data.clients.filter((c) => c.email === "qa@example.com").length,
      1,
    );
    const checkin = await req("/appointments/" + booked.data.id, {
      method: "PATCH",
      body: { status: "checked-in" },
    });
    assert.equal(checkin.status, 200);
    const pay = await req("/checkout", {
      method: "POST",
      body: { appointmentId: booked.data.id, tip: 500, method: "cash" },
    });
    assert.equal(pay.data.total, 5000);
    assert.equal(
      (
        await req("/checkout", {
          method: "POST",
          body: { appointmentId: booked.data.id, tip: 500, method: "cash" },
        })
      ).status,
      400,
    );
    const next = await req("/public/book", {
      method: "POST",
      body: { ...input, staffId: "alex" },
      auth: false,
    });
    assert.equal(next.status, 201);
    const cancel = await req("/public/appointment/" + next.data.manageToken, {
      method: "POST",
      body: { action: "cancel" },
      auth: false,
    });
    assert.equal(cancel.status, 200);
    assert.equal(
      (
        await req("/public/appointment/" + next.data.manageToken, {
          auth: false,
        })
      ).data.status,
      "cancelled",
    );
    assert.equal(
      (await req("/logout", { method: "POST", body: {} })).status,
      200,
    );
    assert.equal((await req("/data")).status, 401);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
    await rm(dir, { recursive: true, force: true });
  }
});
