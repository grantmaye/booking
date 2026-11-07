const errors = [],
  warnings = [];
if (Number(process.versions.node.split(".")[0]) < 24)
  errors.push("Node 24 or newer is required.");
if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32)
  errors.push("APP_SECRET must contain at least 32 random characters.");
if (!/^https:\/\//.test(process.env.PUBLIC_ORIGIN || ""))
  errors.push("PUBLIC_ORIGIN must be the public HTTPS origin.");
if (!process.env.DB_PATH)
  errors.push("DB_PATH must point to a persistent volume.");
if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)
  warnings.push(
    "Stripe payments and subscriptions are disabled until credentials and webhooks are configured.",
  );
if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM)
  warnings.push(
    "Email, reminders, recovery and self-service registration require a verified email sender.",
  );
if (process.env.RUN_WORKER !== "true")
  warnings.push(
    "RUN_WORKER=true is required for notification delivery and waitlist matching.",
  );
if (process.env.SEED_DEMO === "true")
  errors.push("Do not enable SEED_DEMO in production.");
console.log(
  JSON.stringify({ ready: errors.length === 0, errors, warnings }, null, 2),
);
if (errors.length) process.exitCode = 1;
