import { test } from "node:test";
import assert from "node:assert/strict";
test("Google does not load without consent and never receives query strings or private paths", async () => {
  const originals = Object.fromEntries(
    ["window", "document", "location", "localStorage", "fetch"].map((k) => [
      k,
      globalThis[k],
    ]),
  );
  try {
    const nodes = [],
      scripts = [],
      buttons = [
        { dataset: { consent: "yes" } },
        { dataset: { consent: "no" } },
      ];
    let fetched = 0;
    globalThis.location = {
      pathname: "/book",
      origin: "https://studio.example.com",
      search: "?utm_source=instagram&private=should-not-leak",
      reload() {},
    };
    globalThis.window = {};
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    globalThis.fetch = async () => {
      fetched++;
      return { json: async () => ({ ga4Id: "G-TEST123456" }) };
    };
    globalThis.document = {
      querySelector: () => null,
      createElement: (tag) => ({
        tag,
        setAttribute() {},
        querySelectorAll: () => buttons,
        remove() {},
      }),
      body: { append: (n) => nodes.push(n) },
      head: { append: (n) => scripts.push(n) },
    };
    const mod = await import("../public/analytics.js?consent-test");
    await mod.initAnalytics();
    assert.equal(fetched, 1);
    assert.equal(scripts.length, 0);
    assert.equal(nodes.length, 2);
    buttons[1].onclick();
    assert.equal(scripts.length, 0);
    nodes[0].onclick();
    buttons[0].onclick();
    assert.equal(scripts.length, 1);
    mod.trackBooking();
    const events = window.dataLayer.map((a) => Array.from(a));
    assert.equal(
      events.filter((a) => a[0] === "event" && a[1] === "booking_complete")
        .length,
      1,
    );
    assert.ok(!JSON.stringify(events).includes("should-not-leak"));
    assert.ok(!JSON.stringify(events).includes("utm_source"));
    location.pathname = "/manage";
    await mod.initAnalytics();
    assert.equal(fetched, 1);
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
});
