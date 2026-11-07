import { growthTools } from "./marketing.js";
import { scheduleExtension } from "./schedule.js";
export function extensions(ctx) {
  const {
    state,
    api,
    send,
    esc,
    money,
    field,
    select,
    options,
    modalForm,
    showModal,
    toast,
    refresh,
    find,
    avatar,
    time,
    fullDate,
  } = ctx;
  const $ = (s) => document.querySelector(s),
    modal = $("#modal");
  const schedule = scheduleExtension(ctx);
  const growth = growthTools(ctx);
  const ops = () => state.ops || {};
  const panel = (title, body, button = "") =>
    `<section class="panel"><div class="section-head"><h2>${title}</h2>${button}</div>${body}</section>`;
  const action = (label, id) =>
    `<button class="secondary" data-extra="${id}">${label}</button>`;
  const row = (title, detail, buttons = "") =>
    `<div class="list-row"><div><b>${esc(title)}</b><small>${esc(detail)}</small></div>${buttons}</div>`;
  const head = (title, sub) =>
    `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div></div>`;
  function pointOfSale() {
    return (
      head(
        "Checkout, without the loose ends.",
        "Collect cash, redeem gifts and rewards, or send a secure card checkout link.",
      ) +
      `<div class="action-grid">${action("＋ Create order", "order")}${action("Issue gift card", "gift")}${action("Collect deposit", "deposit")}</div><div class="notice">${ops().integrations?.stripe ? "Stripe checkout and webhook processing are configured." : "Card checkout needs Stripe credentials and a webhook endpoint. Cash and gift-card checkout are available."}</div>` +
      panel(
        "Orders",
        (ops().orders || [])
          .map((o) =>
            row(
              o.id.slice(-8).toUpperCase(),
              `${money(o.total)} · ${o.status} · ${fullDate(o.created)}`,
              action("Open", "order:" + o.id),
            ),
          )
          .join("") ||
          '<p class="footnote">Create your first order to begin.</p>',
      )
    );
  }
  function operations() {
    return (
      head(
        "The details that keep your studio running.",
        "Manage availability, stock, suppliers, promotions, and time tracking.",
      ) +
      `<div class="growth-grid">${[
        ["shifts", "Staff shifts", "shift"],
        ["resources", "Chairs & rooms", "resource"],
        ["promotions", "Promotions", "promotion"],
        ["suppliers", "Suppliers", "supplier"],
        ["purchaseOrders", "Purchase orders", "purchase"],
      ]
        .map(([key, title, kind]) =>
          panel(
            title,
            (ops()[key] || [])
              .map((x) =>
                row(
                  x.name,
                  x.status || x.code || x.locationId || "",
                  kind === "purchase" && x.status !== "received"
                    ? action("Receive", "receive:" + x.id)
                    : kind !== "purchase"
                      ? action("Edit", "edit-" + kind + ":" + x.id)
                      : "",
                ),
              )
              .join("") || '<p class="footnote">No records yet.</p>',
            action("＋ Add", kind),
          ),
        )
        .join("")}${panel(
        "Inventory movements",
        (ops().movements || [])
          .slice(0, 15)
          .map((x) =>
            row(
              find("products", x.product_id).name,
              `${x.delta > 0 ? "+" : ""}${x.delta} · ${find("locations", x.location_id).name} · ${x.reason}`,
            ),
          )
          .join(""),
        action("Adjust / transfer", "stock"),
      )}${panel(
        "Time tracking",
        (ops().timesheets || [])
          .slice(-10)
          .reverse()
          .map((x) =>
            row(
              find("staff", x.staffId).name,
              `${fullDate(x.start)} ${time(x.start)} · ${x.end ? "Ended " + time(x.end) : "Clocked in"}`,
            ),
          )
          .join(""),
        action("Clock in / out", "clock"),
      )}${panel("Recurring schedules", (ops().recurrences || []).map((r) => row(find("clients", r.clientId).name, `${r.active ? "Active" : "Paused"} · next ${r.nextDate}${r.lastError ? " · " + r.lastError : ""}`, action(r.active ? "Pause" : "Resume", "recurrence:" + r.id))).join("") || '<p class="footnote">Create a repeating appointment to start a schedule.</p>')}</div>`
    );
  }
  function accessPage() {
    return (
      head(
        "The right access for every person.",
        "Invite your team and clients. Protect your account with an authenticator.",
      ) +
      `<div class="action-grid">${["owner", "manager"].includes(state.user.role) ? action("Invite a person", "invite") : ""}${action("Set up authenticator", "mfa")}${action("Clock in / out", "clock")}</div><div class="notice">Owners manage security. Managers run operations. Receptionists manage visits and checkout. Professionals see their own appointments. Customers see only their own portal.</div>` +
      panel(
        "Accounts",
        (state.accounts || [])
          .map((x) =>
            row(
              x.name,
              `${x.email} · ${x.role} · ${x.disabled ? "disabled" : x.verified ? "active" : "invited"}`,
              x.id !== state.user.id && state.user.role === "owner"
                ? action(x.disabled ? "Enable" : "Disable", "access:" + x.id)
                : "",
            ),
          )
          .join(""),
      )
    );
  }
  function studio() {
    const b = ops().branding || {};
    return (
      head(
        "Your studio. Your identity.",
        "Customize your public studio page and showcase your work.",
      ) +
      `<div class="action-grid">${action("Edit brand", "brand")}${action("Add portfolio photo", "photo")}<a class="secondary" href="/studio" target="_blank">View public studio ↗</a></div>` +
      panel(
        "Brand details",
        row(
          b.name || state.data.settings[0]?.name,
          b.headline || "Make time for yourself.",
        ) + row("Description", b.description || ""),
      ) +
      `<div class="cards spaced">${(ops().portfolio || []).map((p) => `<section class="panel"><img class="portfolio-image" src="/api/images/${esc(p.imageId)}" alt="${esc(p.caption || p.name)}"><div class="section-head"><h2>${esc(p.name)}</h2></div></section>`).join("")}</div>`
    );
  }
  function messages() {
    return (
      head(
        "Stay close to your clients.",
        "Client conversations, campaign delivery, and notification status.",
      ) +
      `<div class="action-grid">${action("Write client message", "message")}${action("Queue campaign", "campaign")}</div><div class="growth-grid spaced">${panel(
        "Conversations",
        (ops().messages || [])
          .slice()
          .reverse()
          .map((m) =>
            row(find("clients", m.clientId).name + " · " + m.sender, m.body),
          )
          .join("") || '<p class="footnote">No messages yet.</p>',
      )}${panel(
        "Delivery outbox",
        (ops().outbox || [])
          .slice(0, 30)
          .map((m) =>
            row(
              m.subject,
              `${m.recipient} · ${m.status}${m.last_error ? " · " + m.last_error : ""}`,
              m.status === "failed" ? action("Retry", "retry:" + m.id) : "",
            ),
          )
          .join("") ||
          '<p class="footnote">Booking confirmations and reminders appear here.</p>',
      )}</div>`
    );
  }
  function analytics() {
    return (
      head(
        "Understand the whole business.",
        "Date-range revenue, refunds, taxes, tips, retained clients, and commission snapshots.",
      ) +
      `<form id="range-report" class="panel report-filters">${field("From", "from", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), "date", "required")}${field("Through", "to", new Date().toISOString().slice(0, 10), "date", "required")}${select("Location", "location", [{ id: "all", name: "All locations" }, ...state.data.locations])}<button class="primary">Run report</button></form><div id="report-results" class="spaced"></div>`
    );
  }
  function adminTools() {
    return (
      head(
        "Business controls",
        "Import contacts, merge profiles, and review integrations.",
      ) +
      `<div class="action-grid">${action("Import clients (CSV)", "import")}${action("Merge duplicate clients", "merge")}</div>` +
      panel(
        "Integrations",
        Object.entries(ops().integrations || {})
          .map(([name, on]) => row(name, on ? "Configured" : "Not configured"))
          .join(""),
      ) +
      panel(
        "Payment risk alerts",
        (ops().riskAlerts || [])
          .map((a) => row(a.name, a.providerId))
          .join("") ||
          '<p class="footnote">No provider risk alerts received.</p>',
      )
    );
  }
  async function startOrder() {
    modalForm(
      "Create checkout order",
      select("Appointment (optional)", "appointmentId", [
        { id: "", name: "Retail only" },
        ...state.data.appointments
          .filter((a) => ["confirmed", "checked-in"].includes(a.status))
          .map((a) => ({
            id: a.id,
            name: `${find("clients", a.client_id).name} · ${fullDate(a.start)} ${time(a.start)}`,
          })),
      ]) +
        select("Location", "locationId", state.data.locations) +
        select("Retail product (optional)", "productId", [
          { id: "", name: "No product" },
          ...state.data.products,
        ]) +
        field("Quantity", "quantity", 1, "number", 'min="1" required') +
        field("Tip ($)", "tip", 0, "number", 'min="0" step="0.01"') +
        field("Promotion code", "promoCode") +
        field(
          "Redeem points (1 point = 1¢)",
          "loyaltyPoints",
          0,
          "number",
          'min="0"',
        ) +
        select("Membership credit (optional)", "subscriptionId", [
          { id: "", name: "Do not redeem" },
          ...(ops().subscriptions || [])
            .filter((s) => s.status === "active" && s.credits > 0)
            .map((s) => ({
              id: s.id,
              name: `${find("clients", s.client_id).name} · ${s.credits} credits`,
            })),
        ]),
      async (d) => {
        const input = {
          appointmentId: d.appointmentId || undefined,
          locationId: d.locationId,
          items: d.productId
            ? [{ productId: d.productId, quantity: Number(d.quantity) }]
            : [],
          tip: Math.round(Number(d.tip) * 100),
          promoCode: d.promoCode || undefined,
          loyaltyPoints: Number(d.loyaltyPoints || 0),
          subscriptionId: d.subscriptionId || undefined,
        };
        await api("/commerce/orders", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: input,
        });
      },
      "Create order",
    );
  }
  async function orderDetail(key) {
    const o = await api("/commerce/orders/" + key + "/receipt");
    showModal(
      "Order " + key.slice(-8).toUpperCase(),
      `<div id="receipt"><h2>${esc(state.data.settings[0]?.name)}</h2><p>${esc(o.status)} · ${fullDate(o.created)}</p>${o.details.items.map((i) => row(i.name, `${i.quantity} × ${money(i.unitPrice)}`, money(i.quantity * i.unitPrice))).join("")}${[
        ["Subtotal", o.subtotal],
        ["Discount", -o.discount],
        ["Deposit applied", -(o.details.depositTotal || 0)],
        ["Tax", o.tax],
        ["Tip", o.tip],
        ["Total", o.total],
      ]
        .map(([label, n]) => row(label, "", `<b>${money(n)}</b>`))
        .join(
          "",
        )}${o.tenders.map((t) => row(t.method, "", money(t.amount))).join("")}</div><div class="action-grid spaced">${o.status === "pending" ? `${action("Pay cash / gift card", "tender:" + key)}${action("Pay by card", "card:" + key)}${!o.stripe_session ? action("Cancel order", "cancel-order:" + key) : ""}` : ""}${o.status === "paid" && ["owner", "manager"].includes(state.user.role) ? action("Refund order", "refund:" + key) : ""}${o.status === "paid" && o.appointment_id && ["confirmed", "checked-in"].includes(state.data.appointments.find((a) => a.id === o.appointment_id)?.status) ? action("Complete visit", "complete:" + o.appointment_id) : ""}${action("Print receipt", "print")}</div>`,
    );
    bindModal();
  }
  function tender(key) {
    const o = ops().orders.find((x) => x.id === key);
    modalForm(
      "Record payment",
      `<p class="wide">Total due: <b>${money(o.total)}</b>. Enter cash already collected and any gift-card amount. Amounts must add up exactly.</p>` +
        field(
          "Cash ($)",
          "cash",
          o.total / 100,
          "number",
          'min="0" step="0.01"',
        ) +
        field("Gift card code", "code") +
        field("Gift amount ($)", "gift", 0, "number", 'min="0" step="0.01"'),
      (d) =>
        send("/commerce/orders/" + key + "/pay", {
          tenders: [
            ...(Number(d.cash) > 0
              ? [{ method: "cash", amount: Math.round(Number(d.cash) * 100) }]
              : []),
            ...(Number(d.gift) > 0
              ? [
                  {
                    method: "giftcard",
                    code: d.code,
                    amount: Math.round(Number(d.gift) * 100),
                  },
                ]
              : []),
          ],
        }),
      "Record payment",
    );
  }
  const choices = {
    shift: () => [
      select("Professional", "staffId", state.data.staff),
      select("Location", "locationId", state.data.locations),
      field("Shift name", "name", "Regular shift"),
      field("Days (0 Sun–6 Sat, comma separated)", "days", "1,2,3,4,5"),
      field("Start", "start", "09:00", "time"),
      field("End", "end", "17:00", "time"),
    ],
    resource: () => [
      field("Name", "name", "Chair 1"),
      select("Location", "locationId", state.data.locations),
    ],
    promotion: () => [
      field("Name", "name"),
      field("Code", "code"),
      select("Type", "type", [
        { id: "percent", name: "Percent discount" },
        { id: "fixed", name: "Fixed amount (cents)" },
      ]),
      field("Value", "value", 10, "number", 'min="1"'),
      field("Maximum uses (0 unlimited)", "maxUses", 0, "number", 'min="0"'),
      field("Expires", "expires", "", "date"),
    ],
    supplier: () => [
      field("Name", "name"),
      field("Email", "email", "", "email"),
      field("Phone", "phone"),
    ],
    purchase: () => [
      field("Order reference", "name"),
      select("Supplier", "supplierId", ops().suppliers || []),
      select("Location", "locationId", state.data.locations),
      select("Product", "productId", state.data.products),
      field("Quantity", "quantity", 10, "number", 'min="1"'),
    ],
    brand: () => [
      field(
        "Studio name",
        "name",
        ops().branding?.name || state.data.settings[0]?.name,
      ),
      field(
        "Headline",
        "headline",
        ops().branding?.headline || "Make time for yourself.",
      ),
      `<label class="wide">Description<textarea name="description">${esc(ops().branding?.description || "")}</textarea></label>`,
      field(
        "Brand color",
        "accent",
        ops().branding?.accent || "#183e36",
        "color",
      ),
      field("Review link", "reviewUrl", ops().branding?.reviewUrl || "", "url"),
      field(
        "Instagram link",
        "instagramUrl",
        ops().branding?.instagramUrl || "",
        "url",
      ),
    ],
  };
  function create(kind, key) {
    const resource = {
      shift: "shifts",
      resource: "resources",
      promotion: "promotions",
      supplier: "suppliers",
      purchase: "purchaseOrders",
      brand: "branding",
    }[kind];
    const old = key ? (ops()[resource] || []).find((x) => x.id === key) : null;
    modalForm(
      (key ? "Edit " : "Add ") + kind,
      choices[kind]().join("") +
        (["resource", "promotion"].includes(kind)
          ? '<label class="check"><input type="checkbox" name="active" checked> Active</label>'
          : ""),
      (d) => {
        if (kind === "shift") {
          d.days = d.days.split(",").map(Number);
          const minute = (t) =>
            Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
          d.startMinute = minute(d.start);
          d.endMinute = minute(d.end);
        }
        if (kind === "resource") d.active = d.active === "on";
        if (kind === "promotion") {
          d.code = d.code.toUpperCase();
          d.value = Number(d.value);
          d.maxUses = Number(d.maxUses);
          d.uses = old?.uses || 0;
          d.active = d.active === "on";
        }
        if (kind === "purchase") {
          d.items = [{ productId: d.productId, quantity: Number(d.quantity) }];
          d.status = "ordered";
        }
        return send(
          "/records/" +
            resource +
            (key
              ? "/" + key
              : kind === "brand" && ops().branding?.id
                ? "/brand"
                : ""),
          d,
          key || (kind === "brand" && ops().branding?.id) ? "PATCH" : "POST",
        );
      },
    );
    if (old) {
      const values = {
        ...old,
        days: old.days?.join(","),
        start:
          old.startMinute === undefined
            ? ""
            : String(Math.floor(old.startMinute / 60)).padStart(2, "0") +
              ":" +
              String(old.startMinute % 60).padStart(2, "0"),
        end:
          old.endMinute === undefined
            ? ""
            : String(Math.floor(old.endMinute / 60)).padStart(2, "0") +
              ":" +
              String(old.endMinute % 60).padStart(2, "0"),
      };
      for (const [name, value] of Object.entries(values)) {
        const input = modal.querySelector(`[name="${name}"]`);
        if (input) {
          if (input.type === "checkbox") input.checked = Boolean(value);
          else input.value = value ?? "";
        }
      }
    }
  }
  function stock() {
    modalForm(
      "Adjust or transfer inventory",
      select("Product", "productId", state.data.products) +
        select("From / adjustment location", "from", state.data.locations) +
        select("Transfer destination (optional)", "to", [
          { id: "", name: "Adjustment only" },
          ...state.data.locations,
        ]) +
        field(
          "Quantity (negative to remove)",
          "quantity",
          1,
          "number",
          "required",
        ) +
        field("Reason", "reason", "Stock count correction", "text", "required"),
      (d) =>
        d.to
          ? send("/inventory/transfer", {
              productId: d.productId,
              from: d.from,
              to: d.to,
              quantity: Number(d.quantity),
            })
          : send("/inventory/adjust", {
              productId: d.productId,
              locationId: d.from,
              delta: Number(d.quantity),
              reason: d.reason,
            }),
    );
  }
  function invite() {
    modalForm(
      "Invite a person",
      field("Name", "name", "", "text", "required") +
        field("Email", "email", "", "email", "required") +
        select("Access role", "role", [
          { id: "staff", name: "Professional" },
          { id: "receptionist", name: "Receptionist" },
          { id: "manager", name: "Manager" },
          { id: "customer", name: "Customer" },
        ]) +
        select("Professional profile", "staffId", [
          { id: "", name: "Not a professional" },
          ...state.data.staff,
        ]) +
        select("Client profile", "clientId", [
          { id: "", name: "Not a customer" },
          ...state.data.clients,
        ]),
      async (d) => {
        const result = await send("/team/invite", d);
        state.inviteLink = result.link;
      },
      "Create invitation",
    );
    const form = $("#edit-form"),
      original = form.onsubmit;
    form.onsubmit = async (e) => {
      await original(e);
      if (state.inviteLink) {
        showModal(
          "Invitation ready",
          `<p>Share this private, single-use link with the invited person. It expires in 24 hours.</p><input class="invite-link" readonly value="${esc(state.inviteLink)}">`,
        );
        state.inviteLink = null;
      }
    };
  }
  function mfa() {
    modalForm(
      "Set up authenticator",
      field("Current password", "password", "", "password", "required"),
      async (d) => {
        state.mfa = await send("/account/mfa", {
          action: "setup",
          password: d.password,
        });
        state.mfa.password = d.password;
      },
      "Generate setup key",
    );
    const original = $("#edit-form").onsubmit;
    $("#edit-form").onsubmit = async (e) => {
      await original(e);
      if (state.mfa) {
        const m = state.mfa;
        state.mfa = null;
        modalForm(
          "Confirm authenticator",
          `<p class="wide">Add this setup key to your authenticator app: <code>${esc(m.secret)}</code></p>` +
            field(
              "Six-digit code",
              "code",
              "",
              "text",
              'required inputmode="numeric" pattern="[0-9]{6}"',
            ),
          (d) =>
            send("/account/mfa", {
              action: "enable",
              password: m.password,
              code: d.code,
            }),
          "Enable MFA",
        );
      }
    };
  }
  function csvRows(text) {
    const rows = [];
    let row = [],
      value = "",
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          value += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        row.push(value);
        value = "";
      } else if (c === "\n" && !quoted) {
        row.push(value.replace(/\r$/, ""));
        if (row.some(Boolean)) rows.push(row);
        row = [];
        value = "";
      } else value += c;
    }
    if (value || row.length) {
      row.push(value);
      rows.push(row);
    }
    if (quoted) throw Error("CSV has an unclosed quote.");
    const headers = rows.shift()?.map((h) => h.trim().toLowerCase());
    if (!headers?.includes("name") || !headers.includes("email"))
      throw Error("CSV needs name,email columns; phone is optional.");
    return rows.map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])),
    );
  }
  const handlers = {
    deposit: () =>
      modalForm(
        "Collect an appointment deposit",
        select(
          "Appointment",
          "appointmentId",
          state.data.appointments
            .filter((a) => a.status === "confirmed")
            .map((a) => ({
              id: a.id,
              name:
                find("clients", a.client_id).name + " · " + fullDate(a.start),
            })),
        ) +
          field(
            "Deposit ($)",
            "amount",
            20,
            "number",
            'min="1" step="0.01" required',
          ),
        (d) =>
          api("/commerce/deposits", {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: {
              appointmentId: d.appointmentId,
              amount: Math.round(Number(d.amount) * 100),
            },
          }),
        "Create deposit order",
      ),
    order: startOrder,
    stock,
    invite,
    mfa,
    clock: () =>
      modalForm(
        "Time clock",
        select("Professional", "staffId", state.data.staff) +
          select("Action", "action", [
            { id: "in", name: "Clock in" },
            { id: "out", name: "Clock out" },
          ]),
        (d) => send("/timesheets/clock", d),
      ),
    gift: () =>
      modalForm(
        "Issue a cash-funded gift card",
        field("Recipient / name", "name", "", "text", "required") +
          field(
            "Code",
            "code",
            crypto.randomUUID().slice(0, 18).toUpperCase(),
            "text",
            "required",
          ) +
          field(
            "Value paid in cash ($)",
            "balance",
            25,
            "number",
            'min="1" step="0.01" required',
          ),
        (d) =>
          send("/records/giftcards", {
            ...d,
            balance: Math.round(Number(d.balance) * 100),
          }),
        "Issue gift card",
      ),
    message: () =>
      modalForm(
        "Message a client",
        select("Client", "clientId", state.data.clients) +
          `<label class="wide">Message<textarea name="body" required></textarea></label>`,
        (d) => send("/messages", d),
        "Send to portal",
      ),
    campaign: () =>
      modalForm(
        "Queue campaign",
        select("Campaign", "id", state.data.campaigns) +
          `<p class="wide">This queues the campaign for opted-in clients. The configured delivery worker sends it.</p>`,
        (d) => send("/campaigns/send", d),
        "Queue campaign",
      ),
    merge: () =>
      modalForm(
        "Merge duplicate profiles",
        select("Profile to merge", "sourceId", state.data.clients) +
          select("Keep this profile", "targetId", state.data.clients) +
          `<p class="wide">Visits, points, orders and messages move to the kept profile. The duplicate profile is removed.</p>`,
        (d) => send("/clients/merge", d),
        "Merge profiles",
      ),
    import: () =>
      modalForm(
        "Import clients",
        `<label class="wide">CSV with name,email,phone headers<textarea name="csv" required placeholder="name,email,phone"></textarea></label>`,
        (d) => send("/clients/import", { clients: csvRows(d.csv) }),
        "Import clients",
      ),
    photo: () => {
      modalForm(
        "Add portfolio photo",
        field("Title", "name", "", "text", "required") +
          field("Caption", "caption") +
          select("Professional", "staffId", state.data.staff) +
          `<label>PNG photo<input type="file" id="photo-file" accept="image/png" required></label>`,
        async (d) => {
          const file = $("#photo-file").files[0];
          if (!file || file.size > 1000000)
            throw Error("Choose a PNG under 1 MB.");
          const raw = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const image = await send("/uploads", { base64: raw, public: true });
          await send("/records/portfolio", { ...d, imageId: image.id });
        },
      );
    },
    print: () => window.print(),
  };
  async function dispatch(value) {
    const [kind, key] = value.split(":");
    try {
      if (!key) {
        if (choices[kind]) create(kind);
        else handlers[kind]?.();
        return;
      }
      if (kind === "recurrence") {
        const r = ops().recurrences.find((r) => r.id === key);
        await send("/recurrences", { id: key, active: !r.active }, "PATCH");
        await refresh();
      } else if (kind.startsWith("edit-")) create(kind.slice(5), key);
      else if (kind === "complete") {
        await send("/appointments/" + key, { status: "completed" }, "PATCH");
        modal.close();
        await refresh();
      } else if (kind === "order") await orderDetail(key);
      else if (kind === "tender") {
        modal.close();
        tender(key);
      } else if (kind === "card") {
        const { url } = await send("/commerce/orders/" + key + "/card", {});
        location.href = url;
      } else if (kind === "refund") {
        modal.close();
        modalForm(
          "Refund the full order",
          field("Reason", "reason", "", "text", "required"),
          (d) => send("/commerce/orders/" + key + "/refund", d),
          "Refund order",
        );
      } else if (kind === "cancel-order") {
        await send("/commerce/orders/" + key + "/cancel", {});
        modal.close();
        await refresh();
      } else if (kind === "receive") {
        await send("/inventory/receive", { id: key });
        await refresh();
        toast("Stock received");
      } else if (kind === "retry") {
        await send("/outbox/retry", { id: key });
        await refresh();
      } else if (kind === "access") {
        const account = state.accounts.find((a) => a.id === key);
        await send(
          "/team/access",
          { userId: key, disabled: !account.disabled },
          "PATCH",
        );
        await refresh();
      }
    } catch (e) {
      toast(e.message);
    }
  }
  function bindModal() {
    modal
      .querySelectorAll("[data-extra]")
      .forEach((b) => (b.onclick = () => dispatch(b.dataset.extra)));
  }
  function bind() {
    schedule.bind();
    growth.bind();
    document
      .querySelectorAll("[data-extra]")
      .forEach((b) => (b.onclick = () => dispatch(b.dataset.extra)));
    $("#range-report")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const report = await api(
          "/reports?" +
            new URLSearchParams(Object.fromEntries(new FormData(e.target))),
        );
        $("#report-results").innerHTML = `<div class="stats">${[
          ["Revenue", report.revenue],
          ["Tax", report.tax],
          ["Tips", report.tips],
          ["Refunds", report.refunds],
        ]
          .map(
            ([label, n]) =>
              `<section class="stat"><div>${label}</div><strong>${money(n)}</strong></section>`,
          )
          .join(
            "",
          )}</div><div class="growth-grid">${panel("Commission snapshots", report.commissions.map((c) => row(c.name, "", money(c.amount))).join(""))}${panel(
          "Client retention",
          report.retention
            .filter((c) => c.visits)
            .map((c) =>
              row(
                c.name,
                `${c.visits} completed visits · last ${fullDate(c.lastVisit)}`,
              ),
            )
            .join("") ||
            '<p class="footnote">No completed visits in this period.</p>',
        )}</div>`;
      } catch (e) {
        toast(e.message);
      }
    });
  }
  return {
    pages: {
      Schedule: schedule.render,
      POS: pointOfSale,
      Operations: operations,
      Access: accessPage,
      Studio: studio,
      Messages: messages,
      Analytics: analytics,
      Tools: adminTools,
      ...growth.pages,
    },
    bind,
  };
}

export async function standalone(
  { api, send, esc, money, field, select, options, toast },
  path,
) {
  const app = document.querySelector("#app");
  const page = (title, content) =>
    `<div class="portal-shell"><header><a class="brand" href="/studio"><img src="/icon.svg" alt="">chairside</a><nav><a href="/book">Book a visit</a><a href="/portal">My account</a><a href="/">Studio workspace</a></nav></header><main><h1>${title}</h1>${content}</main></div>`;
  if (path === "/studio") {
    const c = await api("/public/brand");
    const b = c.brand;
    if (/^#[0-9a-f]{6}$/i.test(b.accent || ""))
      document.documentElement.style.setProperty("--green", b.accent);
    app.innerHTML = page(
      esc(b.headline || "Make time for yourself."),
      `<div class="studio-hero"><p>${esc(b.description || "Thoughtful service. Good people. Your next great visit starts here.")}</p><a class="primary" href="/book">Book your visit →</a> <a class="secondary" href="/group">Book a group</a></div><div class="cards spaced">${c.portfolio.map((p) => `<section class="panel"><img class="portfolio-image" src="/api/images/${esc(p.imageId)}" alt="${esc(p.caption || p.name)}"><div class="section-head"><h2>${esc(p.name)}</h2></div></section>`).join("")}</div><div class="cards spaced">${c.locations.map((l) => `<section class="panel padded"><h2>${esc(l.name)}</h2><p>${esc(l.address)}</p><a href="/book" class="text-btn">Book here →</a></section>`).join("")}</div>${b.reviewUrl ? `<a class="secondary spaced" href="${esc(b.reviewUrl)}" target="_blank" rel="noopener noreferrer">Leave a review ↗</a>` : ""}${b.instagramUrl ? ` <a class="secondary" href="${esc(b.instagramUrl)}" target="_blank" rel="noopener noreferrer">Instagram ↗</a>` : ""}`,
    );
    return;
  }
  if (path === "/unsubscribe") {
    const q = new URLSearchParams(location.search);
    app.innerHTML = page(
      "Email preferences",
      `<p>Stop receiving studio marketing emails. Appointment messages are unaffected.</p><button id="unsubscribe" class="primary">Unsubscribe</button><p id="result" role="status"></p>`,
    );
    document.querySelector("#unsubscribe").onclick = async () => {
      try {
        await send("/public/unsubscribe", {
          clientId: q.get("client"),
          signature: q.get("signature"),
        });
        document.querySelector("#result").textContent =
          "You have been unsubscribed.";
      } catch (e) {
        toast(e.message);
      }
    };
    return;
  }
  if (path === "/account") {
    const action =
        new URLSearchParams(location.search).get("action") || "login",
      token = location.hash.slice(1);
    const titles = {
      login: "Welcome back.",
      register: "Create your account.",
      recover: "Reset your password.",
      reset: "Choose a new password.",
      invite: "Accept your invitation.",
      verify: "Verify your email.",
    };
    app.innerHTML = page(
      titles[action] || "Your account",
      `<form class="panel account-card" id="account-form">${action === "register" ? field("Name", "name", "", "text", "required") : ""}${["login", "register", "recover"].includes(action) ? field("Email", "email", "", "email", 'required autocomplete="email"') : ""}${["login", "register", "reset", "invite"].includes(action) ? field("Password", "password", "", "password", 'required minlength="12" maxlength="200"') : ""}${["login", "reset"].includes(action) ? field("Authenticator code (if enabled)", "code", "", "text", 'inputmode="numeric"') : ""}<p class="form-error" role="alert"></p><button class="primary">${action === "verify" ? "Verify email" : "Continue"} →</button></form><div class="account-links"><a href="/account?action=register">Create account</a><a href="/account?action=recover">Forgot password?</a><a href="/account">Sign in</a></div>`,
    );
    document.querySelector("#account-form").onsubmit = async (e) => {
      e.preventDefault();
      e.submitter.disabled = true;
      try {
        const d = Object.fromEntries(new FormData(e.target));
        if (action === "login") {
          await send("/login", d);
          const session = await api("/session");
          location.href = session.user.role === "customer" ? "/portal" : "/";
        } else {
          const endpoint = {
            register: "register",
            recover: "recover",
            verify: "verify",
            reset: "reset",
            invite: "reset",
          }[action];
          const result = await send("/public/" + endpoint, {
            ...d,
            token,
            invitation: action === "invite",
          });
          document.querySelector(".form-error").textContent =
            result.message || "Success. You can now sign in.";
        }
      } catch (e) {
        document.querySelector(".form-error").textContent = e.message;
      } finally {
        e.submitter.disabled = false;
      }
    };
    return;
  }
  if (path === "/waitlist") {
    const raw = location.hash.slice(1);
    if (raw) {
      const offer = await send("/public/waitlist/offer", { token: raw });
      app.innerHTML = page(
        "A chair opened up.",
        `<section class="panel account-card"><h2>${esc(offer.service)} with ${esc(offer.staff)}</h2><p>${new Date(offer.start).toLocaleString()}</p><button class="primary" id="claim-offer">Claim appointment</button></section>`,
      );
      document.querySelector("#claim-offer").onclick = async () => {
        try {
          location.href =
            "/manage#" +
            (await send("/public/waitlist/offer", { token: raw, claim: true }))
              .manageToken;
        } catch (e) {
          toast(e.message);
        }
      };
    } else {
      const c = await api("/public/catalog");
      app.innerHTML = page(
        "Join the waitlist.",
        `<form class="panel account-card" id="wait-form">${field("Name", "name", "", "text", "required")}${field("Email", "email", "", "email", "required")}${select("Location", "locationId", c.locations)}${select("Service", "serviceId", c.services)}${field("Preferred date", "date", new Date().toISOString().slice(0, 10), "date", "required")}<p class="form-error"></p><button class="primary">Join waitlist</button></form>`,
      );
      document.querySelector("#wait-form").onsubmit = async (e) => {
        e.preventDefault();
        try {
          await send(
            "/public/waitlist",
            Object.fromEntries(new FormData(e.target)),
          );
          app.innerHTML = page(
            "You’re on the list.",
            "<p>We’ll email an offer when a matching appointment opens, if studio email delivery is enabled.</p>",
          );
        } catch (e) {
          document.querySelector(".form-error").textContent = e.message;
        }
      };
    }
    return;
  }
  if (path === "/reschedule") {
    const raw = location.hash.slice(1),
      a = await api("/public/appointment/" + raw);
    app.innerHTML = page(
      "Choose a new time.",
      `<form class="panel account-card" id="reschedule-form">${field("Date", "date", new Date(a.start).toISOString().slice(0, 10), "date", "required")}<label>Time<select name="start" required></select></label><p class="form-error"></p><button class="primary spaced">Reschedule</button></form>`,
    );
    const form = document.querySelector("#reschedule-form");
    const load = async () => {
      const slots = await api(
        "/public/availability?" +
          new URLSearchParams({
            date: form.elements.date.value,
            locationId: a.locationId,
            staffId: a.staffId,
            serviceId: a.serviceId,
            serviceIds: (a.serviceIds || [a.serviceId]).join(","),
          }),
      );
      form.elements.start.innerHTML =
        slots
          .map(
            (s) =>
              `<option value="${s.start}">${new Date(s.start).toLocaleTimeString("en-US", { timeZone: a.timezone, hour: "numeric", minute: "2-digit" })}</option>`,
          )
          .join("") || '<option value="">No times available</option>';
    };
    form.elements.date.onchange = load;
    await load();
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await send("/public/appointment/" + raw, {
          action: "reschedule",
          start: form.elements.start.value,
        });
        location.href = "/manage#" + raw;
      } catch (e) {
        document.querySelector(".form-error").textContent = e.message;
      }
    };
    return;
  }
  if (path === "/portal") {
    const session = await api("/session");
    if (!session.user) {
      location.href = "/account";
      return;
    }
    if (session.user.role !== "customer") {
      app.innerHTML = page(
        "Customer portal",
        `<p>You’re signed in as studio staff. Customer accounts have their own private portal.</p><a href="/" class="primary">Open workspace</a>`,
      );
      return;
    }
    const p = await api("/portal"),
      catalog = await api("/public/catalog");
    app.innerHTML = page(
      `Welcome, ${esc(p.profile.name.split(" ")[0])}.`,
      `<div class="action-grid"><a class="primary" href="/portal/book">Book a visit</a><button class="secondary" id="portal-logout">Sign out</button></div><div class="notice">${p.profile.points} loyalty points · ${esc(p.profile.email)}</div><section class="panel"><div class="section-head"><h2>Your appointments</h2></div>${p.appointments.map((a) => `<div class="list-row"><div><b>${esc(catalog.services.find((s) => s.id === a.service_id)?.name || "Service")}</b><small>${new Date(a.start).toLocaleString()} · ${esc(a.status)}</small></div>${["confirmed", "checked-in"].includes(a.status) ? `<div><button class="text-btn" data-portal-move="${a.id}">Reschedule</button><button class="text-btn" data-portal-cancel="${a.id}">Cancel</button><button class="text-btn" data-portal-pay="${a.id}">Pay online</button></div>` : ""}</div>`).join("") || '<p class="footnote">No bookings yet.</p>'}</section><div class="growth-grid spaced"><section class="panel padded"><h2>Memberships</h2>${p.memberships.map((m) => `<p>${esc(m.status)} · ${m.credits} credits <button class="text-btn" data-billing="${m.id}">Manage billing</button></p>`).join("")}<form id="membership-form">${select("Join a membership", "planId", (await api("/public/brand")).memberships)}<button class="primary spaced">Subscribe securely</button></form></section><section class="panel padded"><h2>Your profile</h2><form id="profile-form">${field("Name", "name", p.profile.name, "text", "required")}${field("Phone", "phone", p.profile.phone || "", "tel")}<label class="check"><input name="marketingConsent" type="checkbox" ${p.profile.marketingConsent ? "checked" : ""}> Send me studio offers</label><button class="primary spaced">Save profile</button></form></section><section class="panel padded"><h2>Conversation with your studio</h2>${p.messages.map((m) => `<p><b>${esc(m.sender)}</b>: ${esc(m.body)}</p>`).join("")}<form id="portal-message"><label>Message<textarea name="body" required></textarea></label><button class="primary spaced">Send message</button></form></section></div>`,
    );
    const run = async (fn) => {
      try {
        await fn();
      } catch (e) {
        toast(e.message);
      }
    };
    document.querySelector("#portal-logout").onclick = () =>
      run(async () => {
        await send("/logout", {});
        location.href = "/account";
      });
    document.querySelectorAll("[data-portal-cancel]").forEach(
      (b) =>
        (b.onclick = () => {
          if (confirm("Cancel this appointment?"))
            run(async () => {
              await send("/portal/appointments/" + b.dataset.portalCancel, {
                action: "cancel",
              });
              await standalone(
                { api, send, esc, money, field, select, options, toast },
                path,
              );
            });
        }),
    );
    document.querySelectorAll("[data-portal-move]").forEach(
      (b) =>
        (b.onclick = () => {
          const a = p.appointments.find((a) => a.id === b.dataset.portalMove);
          location.href = "/portal/book?reschedule=" + a.id;
        }),
    );
    document.querySelectorAll("[data-portal-pay]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            const existing = p.orders.find(
              (o) => o.appointment_id === b.dataset.portalPay,
            );
            const order =
              existing ||
              (await api("/commerce/orders", {
                method: "POST",
                headers: { "Idempotency-Key": crypto.randomUUID() },
                body: { appointmentId: b.dataset.portalPay },
              }));
            const result = await send(
              "/commerce/orders/" + order.id + "/card",
              {},
            );
            location.href = result.url;
          })),
    );
    document.querySelectorAll("[data-billing]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            location.href = (
              await send("/membership/portal", {
                subscriptionId: b.dataset.billing,
              })
            ).url;
          })),
    );
    for (const [selector, endpoint] of [
      ["#membership-form", "/membership/checkout"],
      ["#profile-form", "/portal/profile"],
      ["#portal-message", "/messages"],
    ])
      document.querySelector(selector).onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          const d = Object.fromEntries(new FormData(e.target));
          d.marketingConsent = d.marketingConsent === "on";
          const result = await send(
            endpoint,
            d,
            endpoint === "/portal/profile" ? "PATCH" : "POST",
          );
          if (result.url) location.href = result.url;
          else {
            toast("Saved");
            await standalone(
              { api, send, esc, money, field, select, options, toast },
              path,
            );
          }
        });
      };
    return;
  }
  if (["/portal/book", "/group"].includes(path)) {
    const catalog = await api("/public/catalog");
    let visits = [];
    let existing = null;
    if (path === "/portal/book") {
      const p = await api("/portal");
      existing = p.appointments.find(
        (a) => a.id === new URLSearchParams(location.search).get("reschedule"),
      );
    }
    app.innerHTML = page(
      existing
        ? "Move your appointment"
        : path === "/group"
          ? "Bring your people."
          : "Book your next visit.",
      `<form id="portal-book" class="panel account-card">${select("Location", "locationId", catalog.locations, existing?.location_id)}${select("Professional", "staffId", catalog.staff, existing?.staff_id)}${select("Service", "serviceId", catalog.services, existing?.service_id)}${field("Date", "date", new Date().toISOString().slice(0, 10), "date", "required")}<label>Available time<select name="start" required></select></label>${path === "/group" ? field("Guest name", "name", "", "text", "required") + field("Guest email", "email", "", "email", "required") : ""}<p class="form-error"></p><button class="primary spaced">${existing ? "Reschedule" : path === "/group" ? "Add guest" : "Book visit"}</button></form>${path === "/group" ? '<div id="group-visits" class="panel spaced"></div><button class="primary spaced" id="group-confirm">Confirm group booking</button>' : ""}`,
    );
    const form = document.querySelector("#portal-book");
    let requestId = 0;
    const slots = async () => {
      const request = ++requestId;
      form.elements.staffId.innerHTML = options(
        catalog.staff.filter((s) =>
          (s.locationIds || [s.locationId]).includes(
            form.elements.locationId.value,
          ),
        ),
        "name",
        form.elements.staffId.value,
      );
      form.elements.start.innerHTML = '<option value="">Loading…</option>';
      try {
        const available = await api(
          "/public/availability?" +
            new URLSearchParams(Object.fromEntries(new FormData(form))),
        );
        if (request !== requestId) return;
        const zone =
          catalog.locations.find((l) => l.id === form.elements.locationId.value)
            ?.timezone || catalog.settings.timezone;
        form.elements.start.innerHTML = available.length
          ? available
              .map(
                (s) =>
                  `<option value="${s.start}">${new Date(s.start).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" })} (${esc(zone)})</option>`,
              )
              .join("")
          : '<option value="">No times available</option>';
      } catch (e) {
        toast(e.message);
      }
    };
    if (existing)
      for (const key of ["locationId", "staffId", "serviceId"])
        form.elements[key].disabled = true;
    for (const key of ["locationId", "staffId", "serviceId", "date"])
      form.elements[key].onchange = slots;
    await slots();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      try {
        if (path === "/group") {
          if (visits.length >= 8) throw Error("Maximum eight guests.");
          visits.push(d);
          document.querySelector("#group-visits").innerHTML = visits
            .map(
              (v, i) =>
                `<div class="list-row"><span>${esc(v.name)} · ${new Date(v.start).toLocaleString()}</span><button type="button" data-remove-visit="${i}">Remove</button></div>`,
            )
            .join("");
          document.querySelectorAll("[data-remove-visit]").forEach(
            (b) =>
              (b.onclick = () => {
                const current = Array.from(
                  document.querySelectorAll("[data-remove-visit]"),
                ).indexOf(b);
                visits.splice(current, 1);
                b.closest(".list-row").remove();
              }),
          );
          form.elements.name.value = "";
          form.elements.email.value = "";
        } else {
          await send(
            existing ? "/portal/appointments/" + existing.id : "/portal/book",
            existing ? { action: "reschedule", start: d.start } : d,
          );
          location.href = "/portal";
        }
      } catch (e) {
        document.querySelector(".form-error").textContent = e.message;
      }
    };
    document
      .querySelector("#group-confirm")
      ?.addEventListener("click", async () => {
        try {
          const booked = await send("/public/group", { visits });
          app.innerHTML = page(
            "Everyone is booked.",
            booked
              .map(
                (a, i) =>
                  `<p>${esc(visits[i].name)}: <a href="/manage#${a.manageToken}">Manage appointment</a></p>`,
              )
              .join(""),
          );
        } catch (e) {
          toast(e.message);
        }
      });
    return;
  }
}
