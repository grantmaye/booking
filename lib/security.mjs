import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import * as OTPAuth from "otpauth";
export const hashToken = (t) => createHash("sha256").update(t).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export function requireRole(user, roles) {
  if (!user || !roles.includes(user.role))
    throw Object.assign(Error("You do not have permission for this action."), {
      status: 403,
    });
}
export function access(db, user) {
  return (
    db.prepare("SELECT * FROM user_access WHERE user_id=?").get(user.id) || {
      verified: 1,
      disabled: 0,
    }
  );
}
export function canAppointment(db, user, a) {
  if (["owner", "manager", "receptionist"].includes(user?.role)) return true;
  const grant = access(db, user);
  return user.role === "staff"
    ? a.staff_id === grant.staff_id
    : user.role === "customer" && a.client_id === grant.client_id;
}
export function issueToken(db, userId, purpose, minutes = 60) {
  const raw = token();
  db.prepare("INSERT INTO auth_tokens VALUES(?,?,?,?,0)").run(
    hashToken(raw),
    userId,
    purpose,
    Date.now() + minutes * 60000,
  );
  return raw;
}
export function takeToken(db, raw, purpose) {
  const row = db
    .prepare(
      "SELECT * FROM auth_tokens WHERE hash=? AND purpose=? AND expires>? AND used=0",
    )
    .get(hashToken(raw || ""), purpose, Date.now());
  if (!row) throw Error("This link is invalid or has expired.");
  db.prepare("UPDATE auth_tokens SET used=1 WHERE hash=?").run(row.hash);
  return row.user_id;
}
export function checkMFA(secret, code) {
  secret = unseal(secret);
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  return (
    new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      digits: 6,
      period: 30,
    }).validate({ token: String(code), window: 1 }) !== null
  );
}
export function newMFA(email) {
  const totp = new OTPAuth.TOTP({
    issuer: "Chairside",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });
  return { secret: totp.secret.base32, uri: totp.toString() };
}
export function rateLimit(db, key, max, windowMs = 60000) {
  const now = Date.now();
  db.prepare("DELETE FROM rate_limits WHERE expires<?").run(now);
  db.prepare(
    "INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
  ).run(key, now + windowMs);
  if (
    db.prepare("SELECT count FROM rate_limits WHERE key=?").get(key).count > max
  )
    throw Object.assign(Error("Too many requests. Try again later."), {
      status: 429,
    });
}
export function sign(value) {
  if (!process.env.APP_SECRET)
    throw Error("APP_SECRET is required for signed links.");
  return createHmac("sha256", process.env.APP_SECRET)
    .update(value)
    .digest("hex");
}
export function validSignature(value, signature) {
  if (!process.env.APP_SECRET || !/^[a-f0-9]{64}$/.test(signature || ""))
    return false;
  return timingSafeEqual(
    Buffer.from(sign(value), "hex"),
    Buffer.from(signature, "hex"),
  );
}

export function seal(value) {
  if (!process.env.APP_SECRET) return value;
  const iv = randomBytes(12),
    key = createHash("sha256").update(process.env.APP_SECRET).digest(),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "enc",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}
export function unseal(value) {
  if (!value?.startsWith("enc:")) return value;
  if (!process.env.APP_SECRET)
    throw Error("APP_SECRET is required to unlock the authenticator secret.");
  const [, iv, tag, body] = value.split(":"),
    key = createHash("sha256").update(process.env.APP_SECRET).digest(),
    decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
