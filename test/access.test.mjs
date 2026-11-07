import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
test(
  "role boundaries, single-use invitations, customer isolation, and signed webhook rejection",
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "chairside-access-"));
    const port = 31000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ["server.mjs"], {
      env: {
        ...process.env,
        DB_PATH: join(dir, "test.sqlite"),
        PORT: String(port),
        HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(() => {
          throw Error("Server exited");
        }),
      ]);
      const base = `http://127.0.0.1:${port}/api`;
      let cookie = "";
      const req = async (path, method = "GET", body) => {
        const r = await fetch(base + path, {
          method,
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: body ? JSON.stringify(body) : undefined,
        });
        return {
          status: r.status,
          data: await r.json(),
          cookie: r.headers.get("set-cookie")?.split(";")[0],
        };
      };
      const owner = await req("/setup", "POST", {
        name: "Owner",
        email: "owner@example.com",
        password: "test-owner-password",
      });
      cookie = owner.cookie;
      const staffInvite = await req("/team/invite", "POST", {
        name: "Marcus",
        email: "staff@example.com",
        role: "staff",
        staffId: "marcus",
      });
      assert.equal(staffInvite.status, 200);
      const staffToken = staffInvite.data.link.split("#")[1];
      const customerInvite = await req("/team/invite", "POST", {
        name: "James",
        email: "customer@example.com",
        role: "customer",
        clientId: "client-0",
      });
      assert.equal(customerInvite.status, 200);
      const customerToken = customerInvite.data.link.split("#")[1];
      assert.equal(
        (
          await req("/public/reset", "POST", {
            token: staffToken,
            password: "staff-test-password",
            invitation: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await req("/public/reset", "POST", {
            token: staffToken,
            password: "staff-test-password",
            invitation: true,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await req("/public/reset", "POST", {
            token: customerToken,
            password: "customer-test-password",
            invitation: true,
          })
        ).status,
        200,
      );
      const staffLogin = await req("/login", "POST", {
        email: "staff@example.com",
        password: "staff-test-password",
      });
      cookie = staffLogin.cookie;
      assert.equal(staffLogin.status, 200);
      assert.equal((await req("/data")).data.staff.length, 1);
      assert.equal((await req("/operations")).status, 403);
      assert.equal((await req("/team/access")).status, 403);
      assert.equal(
        (
          await req("/records/products", "POST", {
            name: "Forbidden",
            price: 100,
            stock: 1,
            reorderAt: 0,
          })
        ).status,
        403,
      );
      assert.equal(
        (await req("/appointments", "POST", { staffId: "alex" })).status,
        403,
      );
      const customerLogin = await req("/login", "POST", {
        email: "customer@example.com",
        password: "customer-test-password",
      });
      cookie = customerLogin.cookie;
      assert.equal((await req("/portal")).data.profile.id, "client-0");
      assert.equal((await req("/data")).status, 403);
      assert.equal((await req("/operations")).status, 403);
      assert.equal(
        (await req("/commerce/orders", "POST", { appointmentId: "unknown" }))
          .status,
        400,
      );
      assert.equal((await req("/team/invite", "POST", {})).status, 403);
      assert.equal((await req("/webhooks/stripe", "POST", {})).status, 503);
    } finally {
      child.kill();
      if (child.exitCode === null) await once(child, "exit");
      await rm(dir, { recursive: true, force: true });
    }
  },
);
