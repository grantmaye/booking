export function migrate(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied TEXT NOT NULL);`,
  );
  const changes = [
    `CREATE TABLE IF NOT EXISTS user_access(user_id TEXT PRIMARY KEY REFERENCES users(id),staff_id TEXT,client_id TEXT,verified INTEGER NOT NULL DEFAULT 1,disabled INTEGER NOT NULL DEFAULT 0,mfa_secret TEXT,mfa_pending TEXT);
 CREATE TABLE IF NOT EXISTS auth_tokens(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS appointment_meta(appointment_id TEXT PRIMARY KEY REFERENCES appointments(id),series_id TEXT,group_id TEXT,resource_id TEXT,service_ids TEXT NOT NULL DEFAULT '[]',commission INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,appointment_id TEXT UNIQUE REFERENCES appointments(id),client_id TEXT,location_id TEXT,kind TEXT NOT NULL,subtotal INTEGER NOT NULL,discount INTEGER NOT NULL,tax INTEGER NOT NULL,tip INTEGER NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL,details TEXT NOT NULL,stripe_session TEXT UNIQUE,stripe_payment TEXT,stripe_subscription TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tenders(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),method TEXT NOT NULL,amount INTEGER NOT NULL,reference TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),amount INTEGER NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity_id TEXT NOT NULL,delta INTEGER NOT NULL,reference TEXT,created TEXT NOT NULL,UNIQUE(kind,entity_id,reference));
 CREATE TABLE IF NOT EXISTS stock(product_id TEXT NOT NULL,location_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>=0),PRIMARY KEY(product_id,location_id));
 CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,location_id TEXT NOT NULL,delta INTEGER NOT NULL,reason TEXT NOT NULL,reference TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,channel TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL,client_id TEXT,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available INTEGER NOT NULL,lease INTEGER NOT NULL DEFAULT 0,provider_id TEXT,last_error TEXT,dedupe TEXT UNIQUE,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY,scope TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS subscriptions_v2(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,plan_id TEXT NOT NULL,stripe_id TEXT UNIQUE,status TEXT NOT NULL,credits INTEGER NOT NULL DEFAULT 0,period_end TEXT,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,owner TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,public INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status,available);
 CREATE INDEX IF NOT EXISTS order_date ON orders(created,location_id);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS gift_code_unique ON records(json_extract(data,'$.code')) WHERE kind='giftcards';
 INSERT OR IGNORE INTO user_access(user_id) SELECT id FROM users;
 INSERT OR IGNORE INTO appointment_meta(appointment_id,commission,service_ids) SELECT a.id,COALESCE(json_extract(r.data,'$.commission'),0),json_array(a.service_id) FROM appointments a LEFT JOIN records r ON r.id=a.staff_id;
 INSERT OR IGNORE INTO stock(product_id,location_id,quantity) SELECT p.id,l.id,CASE WHEN l.id=(SELECT id FROM records WHERE kind='locations' ORDER BY rowid LIMIT 1) THEN COALESCE(json_extract(p.data,'$.stock'),0) ELSE 0 END FROM records p CROSS JOIN records l WHERE p.kind='products' AND l.kind='locations';`,
  ];
  changes.forEach((sql, i) => {
    if (db.prepare("SELECT version FROM migrations WHERE version=?").get(i + 1))
      return;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO migrations VALUES(?,?)").run(
        i + 1,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
}
