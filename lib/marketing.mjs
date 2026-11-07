import { get, list, put, id, transaction } from "../db.mjs";
import { requireRole } from "./security.mjs";
import { audience, segments } from "./audience.mjs";
import { queueCampaign } from "./messaging.mjs";
export function marketingReport(db, from, to) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from || "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to || "") ||
    from > to
  )
    throw Error("Choose a valid date range.");
  const rows = db
    .prepare(
      "SELECT * FROM appointments WHERE start>=? AND start<=? ORDER BY start",
    )
    .all(from + "T00:00:00.000Z", to + "T23:59:59.999Z");
  const attribution = new Map(list(db, "attribution").map((a) => [a.id, a]));
  const sourceMap = new Map(),
    dayMap = new Map();
  for (const a of rows) {
    const source = attribution.get(a.id)?.source || "direct / untracked",
      s = sourceMap.get(source) || {
        source,
        bookings: 0,
        completed: 0,
        cancelled: 0,
        bookedValue: 0,
      };
    s.bookings++;
    s.completed += a.status === "completed" ? 1 : 0;
    s.cancelled += a.status === "cancelled" ? 1 : 0;
    if (!["cancelled", "no-show"].includes(a.status)) s.bookedValue += a.price;
    sourceMap.set(source, s);
    const day = a.start.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const campaigns = list(db, "campaigns").map((c) => {
    const messages = db
      .prepare("SELECT status FROM outbox WHERE dedupe LIKE ?")
      .all("campaign:" + c.id + ":%");
    const engagement = list(db, "emailEngagement").filter(
      (e) => e.campaignId === c.id,
    );
    const unique = (type) =>
      new Set(engagement.filter((e) => e.type === type).map((e) => e.messageId))
        .size;
    return {
      ...c,
      metrics: {
        queued: messages.length,
        delivered: unique("email.delivered"),
        opened: unique("email.opened"),
        clicked: unique("email.clicked"),
        failed: messages.filter((m) =>
          ["failed", "bounced", "complained"].includes(m.status),
        ).length,
        pending: messages.filter((m) =>
          ["pending", "retry", "sending"].includes(m.status),
        ).length,
      },
      attributedBookings: rows.filter(
        (a) => attribution.get(a.id)?.campaign === c.id,
      ).length,
    };
  });
  return {
    from,
    to,
    bookings: rows.length,
    completed: rows.filter((a) => a.status === "completed").length,
    noShows: rows.filter((a) => a.status === "no-show").length,
    bookedValue: rows
      .filter((a) => !["cancelled", "no-show"].includes(a.status))
      .reduce((n, a) => n + a.price, 0),
    sources: [...sourceMap.values()].sort((a, b) => b.bookings - a.bookings),
    daily: [...dayMap].map(([date, bookings]) => ({ date, bookings })),
    segments: Object.entries(segments).map(([key, name]) => ({
      id: key,
      name,
      count: audience(db, key).length,
    })),
    campaigns,
  };
}
export function integrations(db) {
  const env = process.env,
    analytics = get(db, "integrations", "analytics") || {},
    origin = env.PUBLIC_ORIGIN || "http://127.0.0.1:3000";
  const specs = [
    {
      id: "resend",
      name: "Resend",
      category: "Email marketing",
      description:
        "Campaigns, confirmations, reminders and signed delivery analytics.",
      required: [
        "RESEND_API_KEY",
        "MAIL_FROM",
        "RESEND_WEBHOOK_SECRET",
        "APP_SECRET",
        "PUBLIC_ORIGIN",
      ],
      url: "https://resend.com/domains",
      docs: "https://resend.com/docs/dashboard/webhooks/event-types",
      webhook: "/api/webhooks/email",
      steps: [
        "Verify your sending domain in Resend.",
        "Set the listed server environment variables and restart.",
        "Register delivered, opened, clicked, bounced, complained and failed webhooks. Enable open/click tracking in your provider if desired.",
        "Enable RUN_WORKER=true and test delivery to your own address.",
      ],
    },
    {
      id: "stripe",
      name: "Stripe",
      category: "Payments & retention",
      description:
        "Hosted payments, deposits and recurring membership subscriptions.",
      required: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      url: "https://dashboard.stripe.com/",
      docs: "https://docs.stripe.com/checkout/quickstart",
      webhook: "/api/webhooks/stripe",
      steps: [
        "Start with sandbox keys and set the server environment variables.",
        "Register the signed webhook endpoint using the events in the deployment runbook.",
        "Add recurring Price IDs to membership plans.",
        "Test payment, renewal and refund before using live keys.",
      ],
    },
    {
      id: "ga4",
      name: "Google Analytics 4",
      category: "Website analytics",
      description:
        "Consent-based public page views and completed booking events. No account or manage-link pages tracked.",
      required: [],
      configured: Boolean(analytics.ga4Id),
      url: "https://analytics.google.com/",
      docs: "https://developers.google.com/tag-platform/security/guides/consent",
      steps: [
        "Create a GA4 web data stream.",
        "Save its G- measurement ID here.",
        "Disable Enhanced Measurement automatic events in that stream; this app sends only sanitized page_view and booking_complete events.",
        "Visitors must accept analytics before Google loads. Use your property to verify events.",
      ],
    },
    {
      id: "twilio",
      name: "Twilio",
      category: "SMS transport",
      description:
        "Server SMS delivery adapter. Automated SMS campaigns and inbound messaging are not available.",
      required: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"],
      url: "https://console.twilio.com/",
      docs: "https://www.twilio.com/docs/messaging",
      limited: true,
      steps: [
        "Configure the server credentials and approved sending number.",
        "This release exposes an SMS transport only; campaign enrollment and inbound SMS need additional integration work.",
      ],
    },
    {
      id: "csv",
      name: "CSV export",
      category: "Reporting & CRM",
      description:
        "Download source performance for spreadsheets or BI tools. Client CSV import is available in Tools.",
      required: [],
      configured: true,
      url: null,
      steps: [
        "Open Marketing analytics and select the date range.",
        "Download the source report as CSV.",
        "Import the file into your reporting tool; no automatic sync is implied.",
      ],
    },
  ];
  return {
    ga4Id: analytics.ga4Id || "",
    worker: env.RUN_WORKER === "true",
    items: specs.map((s) => ({
      ...s,
      configured: s.configured ?? s.required.every((k) => Boolean(env[k])),
      requirements: s.required.map((key) => ({
        key,
        present: Boolean(env[key]),
      })),
      webhook: s.webhook ? origin + s.webhook : null,
    })),
  };
}
export async function marketingRoute({ db, req, url, user, body, send }) {
  const path = url.pathname,
    method = req.method,
    answer = (d) => {
      send(200, d);
      return true;
    };
  if (path === "/api/public/analytics-config" && method === "GET")
    return answer({ ga4Id: get(db, "integrations", "analytics")?.ga4Id || "" });
  if (!path.startsWith("/api/marketing") && path !== "/api/integrations")
    return false;
  requireRole(user, ["owner", "manager"]);
  if (path === "/api/integrations") {
    if (method === "GET") return answer(integrations(db));
    if (method === "PATCH") {
      requireRole(user, ["owner"]);
      const d = await body(req);
      if (d.ga4Id && !/^G-[A-Z0-9]{6,20}$/.test(d.ga4Id))
        throw Error("Enter a valid G- measurement ID.");
      put(db, "integrations", { ga4Id: d.ga4Id || "" }, "analytics");
      return answer({ ok: true });
    }
  }
  if (path === "/api/marketing" && method === "GET")
    return answer(
      marketingReport(
        db,
        url.searchParams.get("from") ||
          new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        url.searchParams.get("to") || new Date().toISOString().slice(0, 10),
      ),
    );
  if (path === "/api/marketing/campaigns" && method === "POST") {
    const d = await body(req);
    if (
      !d.name?.trim() ||
      !d.subject?.trim() ||
      !d.body?.trim() ||
      d.name.length > 120 ||
      d.subject.length > 200 ||
      d.body.length > 10000 ||
      !segments[d.segment]
    )
      throw Error("Enter a name, subject, message and valid audience.");
    if (d.id && get(db, "campaigns", d.id)?.status !== "draft")
      throw Error("Only drafts can be edited.");
    return answer(
      put(
        db,
        "campaigns",
        {
          name: d.name.trim(),
          subject: d.subject.trim(),
          body: d.body.trim(),
          segment: d.segment,
          status: "draft",
          created: new Date().toISOString(),
        },
        d.id || undefined,
      ),
    );
  }
  if (path === "/api/marketing/preview" && method === "POST") {
    const d = await body(req),
      c = get(db, "campaigns", d.id);
    if (!c) throw Error("Campaign not found.");
    return answer({
      name: c.name,
      subject: c.subject,
      body: c.body,
      count: audience(db, c.segment || "all").length,
      segment: segments[c.segment || "all"],
    });
  }
  if (path === "/api/marketing/schedule" && method === "POST") {
    const d = await body(req),
      when = d.when ? Date.parse(d.when) : Date.now();
    if (
      !Number.isFinite(when) ||
      when < Date.now() - 60000 ||
      when > Date.now() + 365 * 86400000
    )
      throw Error("Choose a time within the next year.");
    if (
      !process.env.RESEND_API_KEY ||
      !process.env.MAIL_FROM ||
      process.env.RUN_WORKER !== "true"
    )
      throw Error(
        "Configure email delivery and enable its worker before scheduling.",
      );
    return answer(queueCampaign(db, d.id, { available: when }));
  }
  if (path === "/api/marketing/cancel" && method === "POST") {
    const d = await body(req);
    return answer(
      transaction(db, () => {
        const c = get(db, "campaigns", d.id);
        if (!c) throw Error("Campaign not found.");
        const r = db
          .prepare(
            "UPDATE outbox SET status='suppressed' WHERE dedupe LIKE ? AND status IN ('pending','retry')",
          )
          .run("campaign:" + c.id + ":%");
        put(db, "campaigns", { ...c, status: "cancelled" }, c.id);
        return { suppressed: r.changes };
      }),
    );
  }
  return false;
}
