import { Webhook } from "svix";
import { get, put, transaction } from "../db.mjs";
export function emailWebhook(
  db,
  raw,
  headers,
  secret = process.env.RESEND_WEBHOOK_SECRET,
) {
  if (!secret)
    throw Object.assign(Error("Email webhook is not configured."), {
      status: 503,
    });
  new Webhook(secret).verify(raw, {
    "svix-id": headers["svix-id"],
    "svix-timestamp": headers["svix-timestamp"],
    "svix-signature": headers["svix-signature"],
  });
  const event = JSON.parse(raw);
  if (!event.type || !event.data?.email_id) throw Error("Invalid email event.");
  return transaction(db, () => {
    const key = "resend:" + headers["svix-id"];
    if (db.prepare("SELECT id FROM webhook_events WHERE id=?").get(key))
      return { duplicate: true };
    const row = db
      .prepare("SELECT * FROM outbox WHERE provider_id=?")
      .get(event.data?.email_id);
    const states = {
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.complained": "complained",
      "email.failed": "failed",
    };
    if (
      row &&
      ["email.delivered", "email.opened", "email.clicked"].includes(event.type)
    ) {
      const campaignId = row.dedupe?.startsWith("campaign:")
        ? row.dedupe.split(":")[1]
        : null;
      if (campaignId)
        put(
          db,
          "emailEngagement",
          {
            campaignId,
            messageId: row.id,
            type: event.type,
            created: new Date().toISOString(),
          },
          key,
        );
    }
    if (row && states[event.type]) {
      db.prepare("UPDATE outbox SET status=? WHERE id=?").run(
        states[event.type],
        row.id,
      );
      if (
        ["email.bounced", "email.complained"].includes(event.type) &&
        row.client_id
      ) {
        const c = get(db, "clients", row.client_id);
        if (c) put(db, "clients", { ...c, marketingConsent: false }, c.id);
      }
    }
    db.prepare("INSERT INTO webhook_events VALUES(?,?,?)").run(
      key,
      event.type,
      new Date().toISOString(),
    );
    return { received: true };
  });
}
