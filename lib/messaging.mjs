import { id, get, list, put, transaction } from "../db.mjs";
import { sign, validSignature } from "./security.mjs";
const iso = () => new Date().toISOString();
export function enqueue(
  db,
  {
    channel = "email",
    to,
    subject = "",
    body,
    kind = "transactional",
    clientId = null,
    dedupe,
    available = Date.now(),
  },
) {
  if (!to || !body) throw Error("Message recipient and content are required.");
  const key = id();
  db.prepare(
    "INSERT OR IGNORE INTO outbox(id,channel,recipient,subject,body,kind,client_id,available,dedupe,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(
    key,
    channel,
    to,
    subject,
    body,
    kind,
    clientId,
    available,
    dedupe || null,
    iso(),
  );
  return key;
}
export function bookingMessages(db, a) {
  const c = get(db, "clients", a.client_id),
    settings = get(db, "settings", "business");
  const origin = process.env.PUBLIC_ORIGIN || "http://127.0.0.1:3000";
  const location = get(db, "locations", a.location_id);
  const when = new Date(a.start).toLocaleString("en-US", {
    timeZone: location?.timezone || settings.timezone,
  });
  const body = `Your appointment at ${settings.name} is confirmed for ${when}. Manage your visit: ${origin}/manage#${a.token}`;
  enqueue(db, {
    to: c.email,
    subject: "Your appointment is confirmed",
    body,
    clientId: c.id,
    dedupe: "confirmation:" + a.id + ":" + a.start,
  });
  const reminderTime = Date.parse(a.start) - 86400000;
  if (reminderTime > Date.now())
    enqueue(db, {
      to: c.email,
      subject: "Your appointment is tomorrow",
      body: `Reminder: ${body}`,
      clientId: c.id,
      kind: "reminder:" + a.id,
      dedupe: "reminder:" + a.id + ":" + a.start,
      available: reminderTime,
    });
}
export function unsubscribe(db, clientId, signature) {
  if (!validSignature("unsubscribe:" + clientId, signature))
    throw Error("Invalid unsubscribe link.");
  const c = get(db, "clients", clientId);
  if (c) put(db, "clients", { ...c, marketingConsent: false }, c.id);
  return { ok: true };
}
export function queueCampaign(db, campaignId) {
  if (!process.env.APP_SECRET || !process.env.PUBLIC_ORIGIN)
    throw Error(
      "Configure APP_SECRET and PUBLIC_ORIGIN before sending campaigns.",
    );
  return transaction(db, () => {
    const campaign = get(db, "campaigns", campaignId);
    if (!campaign || campaign.status === "queued")
      throw Error("Campaign cannot be queued again.");
    const clients = list(db, "clients").filter(
      (c) => c.marketingConsent && c.email,
    );
    for (const c of clients) {
      const link = `${process.env.PUBLIC_ORIGIN}/unsubscribe?client=${c.id}&signature=${sign("unsubscribe:" + c.id)}`;
      enqueue(db, {
        to: c.email,
        subject: campaign.subject,
        body: campaign.body + "\n\nUnsubscribe: " + link,
        kind: "marketing",
        clientId: c.id,
        dedupe: `campaign:${campaignId}:${c.id}`,
      });
    }
    put(
      db,
      "campaigns",
      { ...campaign, status: "queued", recipients: clients.length },
      campaignId,
    );
    return { queued: clients.length };
  });
}
export async function deliver(message, fetcher = fetch) {
  if (message.channel === "email") {
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)
      throw Object.assign(Error("Email provider not configured."), {
        unconfigured: true,
      });
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "chairside/" + message.id,
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [message.recipient],
        subject: message.subject,
        text: message.body,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Error(`Email provider returned ${response.status}.`);
    return (await response.json()).id;
  }
  if (message.channel === "sms") {
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_FROM
    )
      throw Object.assign(Error("SMS provider not configured."), {
        unconfigured: true,
      });
    try {
      const response = await fetcher(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                process.env.TWILIO_ACCOUNT_SID +
                  ":" +
                  process.env.TWILIO_AUTH_TOKEN,
              ).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: process.env.TWILIO_FROM,
            To: message.recipient,
            Body: message.body,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw Error(`SMS provider returned ${response.status}.`);
      return (await response.json()).sid;
    } catch (e) {
      e.ambiguous = true;
      throw e;
    }
  }
  throw Error("Unsupported delivery channel.");
}
export async function runOutbox(
  db,
  { send = deliver, now = Date.now(), limit = 25 } = {},
) {
  const messages = transaction(db, () => {
    const rows = db
      .prepare(
        "SELECT * FROM outbox WHERE status IN ('pending','retry','sending') AND available<=? AND lease<? ORDER BY available LIMIT ?",
      )
      .all(now, now, limit);
    for (const m of rows)
      db.prepare(
        "UPDATE outbox SET status='sending',lease=?,attempts=attempts+1 WHERE id=?",
      ).run(now + 60000, m.id);
    return rows;
  });
  for (const m of messages) {
    if (
      m.kind === "marketing" &&
      !get(db, "clients", m.client_id)?.marketingConsent
    ) {
      db.prepare(
        "UPDATE outbox SET status='suppressed',lease=0 WHERE id=?",
      ).run(m.id);
      continue;
    }
    if (m.kind.startsWith("reminder:")) {
      const a = db
        .prepare("SELECT status FROM appointments WHERE id=?")
        .get(m.kind.slice(9));
      if (!a || !["confirmed", "checked-in"].includes(a.status)) {
        db.prepare(
          "UPDATE outbox SET status='suppressed',lease=0 WHERE id=?",
        ).run(m.id);
        continue;
      }
    }
    try {
      const providerId = await send(m);
      db.prepare(
        "UPDATE outbox SET status='sent',provider_id=?,lease=0,last_error=NULL WHERE id=?",
      ).run(providerId, m.id);
    } catch (e) {
      const dead =
        e.ambiguous ||
        m.attempts >= 7 ||
        now - Date.parse(m.created) > 23 * 3600000;
      db.prepare(
        "UPDATE outbox SET status=?,available=?,lease=0,last_error=? WHERE id=?",
      ).run(
        e.unconfigured ? "pending" : dead ? "failed" : "retry",
        now +
          (e.unconfigured
            ? 300000
            : Math.min(3600000, 30000 * 2 ** m.attempts)),
        String(e.message).slice(0, 300),
        m.id,
      );
    }
  }
  return messages.length;
}
