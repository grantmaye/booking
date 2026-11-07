import {
  initAnalytics,
  trackBooking,
  bookingAttribution,
} from "./analytics.js";
import { extensions, standalone } from "./advanced.js";
let extension;
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  modal = $("#modal");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format((n || 0) / 100);
let state = {
    page: "Overview",
    location: "all",
    date: new Date().toLocaleDateString("en-CA"),
    search: "",
    data: null,
    user: null,
  },
  catalog,
  booking = {};
const icons = {
  Overview: "◫",
  Calendar: "▦",
  Clients: "♧",
  Team: "♙",
  Services: "✂",
  Waitlist: "≋",
  Checkout: "▤",
  Inventory: "▧",
  Growth: "↗",
  Reports: "▥",
  Settings: "⚙",
  Operations: "◈",
  Access: "⚿",
  Studio: "✺",
  Messages: "✉",
  Tools: "⊞",
  Marketing: "↗",
  "Marketing analytics": "▥",
  Integrations: "⌘",
};
async function api(path, options = {}) {
  const r = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Something went wrong.");
  return data;
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
const send = (path, body, method = "POST") => api(path, { method, body });
const find = (kind, id) => state.data[kind].find((x) => x.id === id) || {};
const biz = () => state.data?.settings[0] || catalog?.settings || {};
const dateKey = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone:
      catalog?.locations?.find((l) => l.id === booking.locationId)?.timezone ||
      biz().timezone ||
      "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
const time = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone:
      catalog?.locations?.find((l) => l.id === booking.locationId)?.timezone ||
      biz().timezone ||
      "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
const fullDate = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone:
      catalog?.locations?.find((l) => l.id === booking.locationId)?.timezone ||
      biz().timezone ||
      "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
const badge = (s) =>
  `<span class="badge ${esc(s)}">${esc(s.replaceAll("-", " "))}</span>`;
const initials = (name) =>
  esc(
    (name || "?")
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join(""),
  );
const avatar = (person) =>
  `<span class="avatar" style="background:${/^#[0-9a-f]{6}$/i.test(person.color || "") ? person.color : "#e9eade"}">${initials(person.name)}</span>`;
const options = (items, key = "name", selected = "") =>
  items
    .map(
      (x) =>
        `<option value="${esc(x.id)}" ${x.id === selected ? "selected" : ""}>${esc(x[key])}</option>`,
    )
    .join("");
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select = (label, name, items, selected = "") =>
  `<label>${label}<select name="${name}">${options(items, "name", selected)}</select></label>`;
function showModal(title, content) {
  modal.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close dialog">×</button></div>${content}`;
  modal.showModal();
  modal.querySelector("[data-close]").onclick = () => modal.close();
}
function modalForm(title, content, onSubmit, button = "Save changes") {
  showModal(
    title,
    `<form id="edit-form"><div class="form-grid">${content}</div><p class="form-error" role="alert"></p><div class="form-footer"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">${button}</button></div></form>`,
  );
  modal
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => modal.close()));
  $("#edit-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(e.target)));
      modal.close();
      await refresh();
      toast("Saved successfully");
    } catch (err) {
      modal.querySelector(".form-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
}
async function refresh() {
  state.data = await api("/data");
  if (["owner", "manager", "receptionist"].includes(state.user.role))
    state.ops = await api("/operations");
  if (["owner", "manager"].includes(state.user.role))
    state.accounts = await api("/team/access");
  if (["owner", "manager"].includes(state.user.role))
    [state.marketing, state.integrations] = await Promise.all([
      api("/marketing?" + new URLSearchParams(state.marketingRange || {})),
      api("/integrations"),
    ]);
  render();
}
function appointments() {
  return state.data.appointments.filter(
    (a) => state.location === "all" || a.location_id === state.location,
  );
}
function empty(title, description, action = "") {
  return `<div class="empty"><span>✧</span><h3>${title}</h3><p>${description}</p>${action}</div>`;
}
function stats() {
  const today = appointments().filter((a) => dateKey(a.start) === state.date),
    paid = state.data.payments.filter(
      (p) =>
        dateKey(p.created) === state.date &&
        appointments().some((a) => a.id === p.appointment_id),
    ),
    total = state.ops
      ? (state.ops.orders || [])
          .filter(
            (o) =>
              o.status === "paid" &&
              o.kind !== "giftcard" &&
              dateKey(o.created) === state.date &&
              (state.location === "all" || o.location_id === state.location),
          )
          .reduce((n, o) => n + o.total, 0)
      : paid.reduce((n, p) => n + p.total, 0);
  return `<div class="stats">${[
    [
      "Revenue collected",
      money(total),
      "Collected today, including deposits",
      "↗",
    ],
    [
      "Appointments",
      today.filter((a) => a.status !== "cancelled").length,
      `${today.filter((a) => a.status === "completed").length} completed today`,
      "▦",
    ],
    [
      "Clients today",
      new Set(
        today.filter((a) => a.status !== "cancelled").map((a) => a.client_id),
      ).size,
      "Make every visit personal",
      "♧",
    ],
    [
      "Open waitlist",
      state.data.waitlist.filter(
        (x) =>
          x.status !== "booked" &&
          (state.location === "all" || x.locationId === state.location),
      ).length,
      "Opportunities to fill your chairs",
      "≋",
    ],
  ]
    .map(
      ([label, value, sub, icon]) =>
        `<section class="stat"><div>${label}<span>${icon}</span></div><strong>${value}</strong><small>${sub}</small></section>`,
    )
    .join("")}</div>`;
}
function appointmentRows(items) {
  if (!items.length)
    return empty(
      "A little room to grow",
      "Your appointments will appear here. Book a client or share your booking page.",
      '<button class="primary" data-action="book">＋ New appointment</button>',
    );
  return `<div class="table-scroll"><table><thead><tr><th>Client</th><th>Service</th><th>Professional</th><th>Time</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>${items
    .map((a) => {
      const c = find("clients", a.client_id),
        s = find("staff", a.staff_id);
      return `<tr><td><div class="person">${avatar(c)}<div><b>${esc(c.name)}</b><small>${esc(c.email)}</small></div></div></td><td>${esc(find("services", a.service_id).name)}</td><td>${esc(s.name)}</td><td>${time(a.start)}<small>${fullDate(a.start)}</small></td><td>${badge(a.status)}</td><td>${money(a.price)}</td><td><button class="text-btn" data-appointment="${a.id}">View →</button></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function overview() {
  const today = appointments().filter((a) => dateKey(a.start) === state.date),
    low = state.data.products.filter((p) => p.stock <= p.reorderAt);
  return `<div class="welcome"><div><span class="eyebrow">YOUR STUDIO, AT A GLANCE</span><h1>A good day starts here.</h1><p>Keep your chairs full and your business moving.</p></div><a class="secondary" href="/book" target="_blank">View booking page ↗</a></div>${stats()}<div class="overview-grid"><section class="panel"><div class="section-head"><div><h2>Today's appointments <span class="count">${today.length}</span></h2><p>Your people. Your schedule. All in one place.</p></div><button class="text-btn" data-nav="Calendar">Full calendar ↗</button></div>${appointmentRows(today)}</section><aside class="side-stack"><section class="spotlight"><span class="eyebrow">A LITTLE LESS ADMIN</span><h2>More time for<br>your craft.</h2><p>Let clients find their next appointment, any time of day.</p><a class="light-btn" href="/book" target="_blank">Open online booking ↗</a><div class="decorative" aria-hidden="true">✳</div></section><section class="panel pulse"><h2>Studio pulse <span class="live-dot"></span></h2><div><span>Team members</span><b>${state.data.staff.filter((s) => s.active && (state.location === "all" || s.locationId === state.location)).length} active</b></div><div><span>Low-stock products</span><button class="text-btn" data-nav="Inventory">${low.length} to review →</button></div><div><span>Messaging</span><span class="muted">${state.ops?.integrations?.email ? "Email configured" : "Not configured"}</span></div><div><span>Online booking</span><span class="green">Open for bookings</span></div></section></aside></div><section class="panel team-strip"><div class="section-head"><h2>The people behind the craft</h2><button class="text-btn" data-nav="Team">Manage team →</button></div><div class="team-mini">${state.data.staff
    .filter((s) => s.active)
    .map(
      (s) =>
        `<div>${avatar(s)}<div><b>${esc(s.name)}</b><small>${esc(s.title)} · ${esc(find("locations", s.locationId).name)}</small></div><span class="live-dot"></span></div>`,
    )
    .join("")}</div></section>`;
}
function calendar() {
  const staff = state.data.staff.filter(
      (s) =>
        s.active &&
        (state.location === "all" || s.locationId === state.location),
    ),
    items = appointments().filter(
      (a) => dateKey(a.start) === state.date && a.status !== "cancelled",
    );
  return `<div class="page-heading"><div><h1>Your schedule</h1><p>Space for every client. Time for every detail.</p></div><button class="secondary" data-action="block">＋ Block time</button></div><div class="panel"><div class="section-head"><div class="date-controls"><button class="icon-btn" data-day="-1" aria-label="Previous day">‹</button><input aria-label="Calendar date" type="date" id="calendar-date" value="${state.date}"><button class="icon-btn" data-day="1" aria-label="Next day">›</button><button class="secondary" data-day="0">Today</button></div><span class="muted">${esc(biz().timezone)} · 15-minute booking slots</span></div><div class="calendar-scroll"><div class="calendar" style="--columns:${staff.length}"><div class="calendar-corner">TIME</div>${staff.map((s) => `<div class="calendar-person">${avatar(s)}<b>${esc(s.name)}</b><small>${esc(s.title)}</small></div>`).join("")}<div class="time-gutter">${Array.from({ length: 11 }, (_, i) => `<div>${i + 9 > 12 ? i - 3 : i + 9}:00 ${i + 9 >= 12 ? "PM" : "AM"}</div>`).join("")}</div>${staff
    .map(
      (s) =>
        `<div class="day-column">${items
          .filter((a) => a.staff_id === s.id)
          .map((a) => {
            const parts = new Intl.DateTimeFormat("en-GB", {
              timeZone: biz().timezone,
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            })
              .format(new Date(a.start))
              .split(":")
              .map(Number);
            const top = (parts[0] * 60 + parts[1] - 540) * 1.4,
              height = Math.max(
                48,
                ((Date.parse(a.end) - Date.parse(a.start)) / 60000) * 1.4,
              );
            return `<button class="calendar-event ${esc(a.status)}" style="top:${top}px;height:${height}px;background:${esc(s.color)}" data-appointment="${a.id}"><b>${esc(find("clients", a.client_id).name)}</b><span>${esc(find("services", a.service_id).name)}</span><small>${time(a.start)} · ${money(a.price)}</small></button>`;
          })
          .join("")}${state.data.blocks
          .filter((b) => b.staffId === s.id && dateKey(b.start) === state.date)
          .map(
            (b) =>
              `<div class="block-note">Unavailable ${time(b.start)}–${time(b.end)} <button class="text-btn" data-delete="blocks:${b.id}">Remove</button></div>`,
          )
          .join("")}</div>`,
    )
    .join("")}</div></div></div>`;
}
function clients() {
  const items = state.data.clients.filter((c) =>
    (c.name + " " + c.email + " " + c.phone)
      .toLowerCase()
      .includes(state.search.toLowerCase()),
  );
  return `<div class="page-heading"><div><h1>Familiar faces. Lasting relationships.</h1><p>Preferences, visit history, and loyalty in one place.</p></div><button class="primary" data-edit="clients">＋ Add client</button></div><section class="panel"><div class="section-head"><h2>All clients <span class="count">${items.length}</span></h2><input class="search" id="client-search" placeholder="Search name, email, or phone" value="${esc(state.search)}" aria-label="Search clients"></div>${
    items.length
      ? `<div class="table-scroll"><table><thead><tr><th>Client</th><th>Phone</th><th>Visits</th><th>Lifetime spend</th><th>Loyalty</th><th></th></tr></thead><tbody>${items
          .map((c) => {
            const visits = state.data.appointments.filter(
              (a) => a.client_id === c.id && a.status === "completed",
            );
            return `<tr><td><div class="person">${avatar(c)}<div><b>${esc(c.name)}</b><small>${esc(c.email)}</small></div></div></td><td>${esc(c.phone || "—")}</td><td>${visits.length}</td><td>${money(visits.reduce((n, a) => n + a.price, 0))}</td><td>${c.points} points</td><td><button class="text-btn" data-client="${c.id}">View profile →</button></td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : empty(
          "No clients found",
          "Try a different search or add your first client.",
        )
  }</section>`;
}
const cardHead = (title, sub, kind, label) =>
  `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div><button class="primary" data-edit="${kind}">＋ ${label}</button></div>`;
function team() {
  return `${cardHead("Great people. Great service.", "Manage your professionals, locations, and commission rates.", "staff", "Add professional")}<div class="cards">${state.data.staff.map((s) => `<section class="panel staff-card">${avatar(s)}${badge(s.active ? "active" : "archived")}<h2>${esc(s.name)}</h2><p>${esc(s.title)}</p><div class="card-detail"><span>Location</span><b>${esc(find("locations", s.locationId).name)}</b></div><div class="card-detail"><span>Commission</span><b>${s.commission}%</b></div><div class="card-detail"><span>Completed visits</span><b>${state.data.appointments.filter((a) => a.staff_id === s.id && a.status === "completed").length}</b></div><button class="secondary" data-edit="staff:${s.id}">Edit professional</button></section>`).join("")}</div><div class="notice">Invite professionals from Access to give them a restricted login. Configure shifts and chairs in Operations.</div>`;
}
function services() {
  return `${cardHead("Services worth coming back for.", "Set your menu, prices, service duration, and cleanup buffers.", "services", "Add service")}<div class="cards">${state.data.services.map((s) => `<section class="panel service-card"><div class="service-symbol">✂</div><span class="eyebrow">${esc(s.category)}</span><h2>${esc(s.name)}</h2><p>${s.duration} minutes${s.buffer ? ` + ${s.buffer} minute buffer` : ""}</p><strong>${money(s.price)}</strong><div class="card-detail">${badge(s.active ? "active" : "archived")}<button class="text-btn" data-edit="services:${s.id}">Edit service →</button></div></section>`).join("")}</div>`;
}
function waitlist() {
  const items = state.data.waitlist.filter(
    (w) => state.location === "all" || w.locationId === state.location,
  );
  return `${cardHead("Turn openings into opportunities.", "Keep walk-ins and flexible clients ready for the next available chair.", "waitlist", "Add to waitlist")}<div class="panel">${items.length ? `<div class="table-scroll"><table><thead><tr><th>Client</th><th>Service</th><th>Preferred date</th><th>Status</th><th></th></tr></thead><tbody>${items.map((w) => `<tr><td><b>${esc(w.name)}</b><small>${esc(w.email)}</small></td><td>${esc(find("services", w.serviceId).name)}</td><td>${esc(w.date)}</td><td>${badge(w.status || "waiting")}</td><td><button class="text-btn" data-edit="waitlist:${w.id}">Edit</button> <button class="text-btn" data-delete="waitlist:${w.id}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : empty("Ready for the next opening", "Add walk-ins or clients waiting for their preferred time.")}</div>`;
}
function checkoutPage() {
  return `<div class="page-heading"><div><h1>A smooth finish to every visit.</h1><p>Record cash payments and tips, then award client loyalty points.</p></div></div><div class="notice">Use POS for split payments, gift cards, promotions, tax, loyalty redemption, card checkout, and refunds. This screen provides quick cash checkout.</div><section class="panel"><div class="section-head"><h2>Ready for checkout</h2></div>${appointmentRows(appointments().filter((a) => ["confirmed", "checked-in"].includes(a.status)))}</section><section class="panel spaced"><div class="section-head"><h2>Payment history</h2></div>${state.data.payments.length ? `<div class="table-scroll"><table><thead><tr><th>Receipt</th><th>Collected</th><th>Tip</th><th>Method</th><th>Date</th></tr></thead><tbody>${state.data.payments.map((p) => `<tr><td>${p.id.slice(0, 8).toUpperCase()}</td><td>${money(p.total)}</td><td>${money(p.tip)}</td><td>Cash</td><td>${fullDate(p.created)}</td></tr>`).join("")}</tbody></table></div>` : empty("No payments yet", "Completed cash checkouts will appear here.")}</section>`;
}
function inventory() {
  return `${cardHead("Keep the good stuff in stock.", "Retail products, stock counts, and reorder alerts.", "products", "Add product")}<div class="cards">${state.data.products.map((p) => `<section class="panel product-card"><div class="product-art" aria-hidden="true"><span>${esc(p.name.split(" ")[0])}<small>CHAIRSIDE</small></span></div><h2>${esc(p.name)}</h2><div class="card-detail"><strong>${money(p.price)}</strong>${badge(p.stock <= p.reorderAt ? "low-stock" : "in-stock")}</div><div class="card-detail"><span>${p.stock} units in stock</span><div><button class="text-btn" data-sale="${p.id}">Sell</button> · <button class="text-btn" data-edit="products:${p.id}">Manage →</button></div></div></section>`).join("")}</div>`;
}
function growth() {
  return `<div class="page-heading"><div><h1>Give them a reason to return.</h1><p>Build your retention toolkit, one great relationship at a time.</p></div><button class="primary" data-edit="campaigns">＋ Draft campaign</button></div><div class="notice">Create campaign drafts here, then queue delivery in Messages. Configure a Stripe Price ID on membership plans to enable online subscriptions.</div><div class="growth-grid">${[
    ["campaigns", "Campaign drafts", "A thoughtful message goes a long way."],
    ["memberships", "Membership plans", "Make regular visits a habit."],
    ["giftcards", "Gift card ledger", "Track manually issued gift balances."],
    [
      "subscriptions",
      "Member enrollments",
      "Track manually managed service credits.",
    ],
    [
      "rent",
      "Booth rent ledger",
      "Keep due dates and manual payments organized.",
    ],
  ]
    .map(
      ([kind, title, subtitle]) =>
        `<section class="panel"><div class="section-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="text-btn" data-edit="${kind}">＋ Add</button></div>${state.data[kind].length ? state.data[kind].map((x) => `<div class="list-row"><div><b>${esc(x.name)}</b><small>${kind === "memberships" ? `${money(x.price)} / month · ${x.credits} credits` : kind === "giftcards" ? `${esc(x.code)} · ${money(x.balance)}` : kind === "rent" ? `${money(x.amount)} · due ${esc(x.due)}` : esc(x.subject || x.status || "")}</small></div><button class="text-btn" data-edit="${kind}:${x.id}">Edit →</button></div>`).join("") : empty("Nothing here yet", "Create your first record to get started.")}</section>`,
    )
    .join("")}</div>`;
}
function reports() {
  const all = appointments(),
    paid = state.data.payments.filter((p) =>
      all.some((a) => a.id === p.appointment_id),
    ),
    revenue = paid.reduce((n, p) => n + p.subtotal, 0),
    tips = paid.reduce((n, p) => n + p.tip, 0),
    completed = all.filter((a) => a.status === "completed");
  const byStaff = state.data.staff
    .filter((s) => state.location === "all" || s.locationId === state.location)
    .map((s) => {
      const sales = completed
        .filter((a) => a.staff_id === s.id)
        .reduce((n, a) => n + a.price, 0);
      return { ...s, sales };
    });
  const max = Math.max(1, ...byStaff.map((s) => s.sales));
  return `<div class="page-heading"><div><h1>Know what makes your studio grow.</h1><p>All-time results from recorded appointments and cash payments.</p></div><button class="secondary" data-action="export">↓ Export appointments</button></div><div class="stats">${[
    ["Service revenue", money(revenue)],
    ["Tips collected", money(tips)],
    ["Completed visits", completed.length],
    [
      "Average service ticket",
      money(completed.length ? Math.round(revenue / completed.length) : 0),
    ],
  ]
    .map(
      ([name, value]) =>
        `<section class="stat"><div>${name}</div><strong>${value}</strong><small>All time · selected location</small></section>`,
    )
    .join(
      "",
    )}</div><div class="notice">Retail cash sales across all locations: ${money(state.data.sales.reduce((n, s) => n + s.total, 0))} · ${state.data.sales.reduce((n, s) => n + s.quantity, 0)} units sold. Retail is tracked separately from service revenue.</div><div class="growth-grid"><section class="panel"><div class="section-head"><h2>Revenue by professional</h2></div><div class="chart">${byStaff.map((s) => `<div class="bar-row"><span>${esc(s.name)}</span><div><i style="width:${(s.sales / max) * 100}%"></i></div><b>${money(s.sales)}</b></div>`).join("")}</div></section><section class="panel"><div class="section-head"><h2>Commission estimates</h2></div><table><thead><tr><th>Professional</th><th>Rate</th><th>Commission</th></tr></thead><tbody>${byStaff.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.commission}%</td><td>${money(Math.round((s.sales * s.commission) / 100))}</td></tr>`).join("")}</tbody></table><p class="footnote">Calculated using current commission rates. Estimates only; payroll and payouts are not connected.</p></section></div>`;
}
function settings() {
  const b = biz();
  return `<div class="page-heading"><div><h1>Make it your own.</h1><p>Your business, booking policies, and locations.</p></div><button class="primary" data-edit="settings:business">Edit business</button></div><div class="growth-grid"><section class="panel"><div class="section-head"><h2>Business details</h2></div>${[
    ["Business name", b.name],
    ["Timezone", b.timezone],
    ["Booking window", `${b.bookingDays} days`],
    ["Cancellation notice", `${b.cancelHours} hours`],
    ["Currency", b.currency],
  ]
    .map(
      ([k, v]) =>
        `<div class="list-row"><span>${k}</span><b>${esc(v)}</b></div>`,
    )
    .join(
      "",
    )}</section><section class="panel"><div class="section-head"><h2>Locations</h2><button class="text-btn" data-edit="locations">＋ Add location</button></div>${state.data.locations.map((l) => `<div class="list-row"><div><b>${esc(l.name)}</b><small>${esc(l.address)}<br>${l.open}:00–${l.close}:00</small></div><button class="text-btn" data-edit="locations:${l.id}">Edit →</button></div>`).join("")}</section><section class="panel"><div class="section-head"><h2>Integration readiness</h2></div>${(state.integrations?.items || []).map((i) => `<div class="list-row"><span>${esc(i.name)}</span>${badge(i.limited ? "transport-only" : i.configured ? "configured" : "setup-required")}</div>`).join("")}<div class="padded"><button class="secondary" data-nav="Integrations">Manage integrations →</button></div></section><section class="panel"><div class="section-head"><h2>Recent activity</h2></div>${
    state.data.audit
      .slice(0, 6)
      .map(
        (a) =>
          `<div class="list-row"><div><b>${esc(a.action + " " + a.entity.replace("/api/", ""))}</b><small>${fullDate(a.created)} at ${time(a.created)}</small></div></div>`,
      )
      .join("") ||
    '<p class="footnote">Changes made by signed-in users appear here.</p>'
  }</section></div>`;
}
function render() {
  const pages = {
    Overview: overview,
    Calendar: extension.pages.Schedule,
    Clients: clients,
    Team: team,
    Services: services,
    Waitlist: waitlist,
    Checkout: extension.pages.POS,
    Inventory: inventory,
    Growth: growth,
    Marketing: extension.pages.Marketing,
    "Marketing analytics": extension.pages["Marketing analytics"],
    Integrations: extension.pages.Integrations,
    Reports: extension.pages.Analytics,
    Settings: settings,
    ...Object.fromEntries(
      Object.entries(extension.pages).filter(
        ([key]) =>
          ![
            "Schedule",
            "POS",
            "Analytics",
            "Marketing",
            "Marketing analytics",
            "Integrations",
          ].includes(key),
      ),
    ),
  };
  const allowed =
    state.user.role === "staff"
      ? ["Overview", "Calendar", "Clients", "Schedule", "Access"]
      : state.user.role === "receptionist"
        ? [
            "Overview",
            "Calendar",
            "Clients",
            "Waitlist",
            "Checkout",
            "POS",
            "Messages",
            "Schedule",
          ]
        : Object.keys(pages);
  Object.keys(pages).forEach((key) => {
    if (!allowed.includes(key)) delete pages[key];
  });
  if (!pages[state.page]) state.page = "Overview";
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="/"> <img src="/icon.svg" alt="">chairside<span>®</span></a><div class="workspace"><div class="studio-mark">C</div><div><b>${esc(biz().name)}</b><small>Studio workspace</small></div></div><span class="nav-label">WORKSPACE</span><nav>${Object.keys(
    pages,
  )
    .map(
      (name, i) =>
        `${i === 6 ? '<span class="nav-label">BUSINESS</span>' : ""}<button class="nav-item ${state.page === name ? "active" : ""}" data-nav="${name}" title="${name}"><span>${icons[name] || "◇"}</span>${name}${name === "Waitlist" && state.data.waitlist.length ? `<em>${state.data.waitlist.length}</em>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><div class="connection"><span class="live-dot"></span> Your studio is online</div><button class="profile" data-action="logout">${avatar(state.user)}<span><b>${esc(state.user.name)}</b><small>${esc(state.user.role)} · Sign out</small></span><span>↪</span></button></div></aside><div class="main-wrap"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <b>${state.page}</b></div><div class="topbar-actions"><select id="location" aria-label="Filter location"><option value="all">All locations</option>${options(state.data.locations, "name", state.location)}</select><span class="today-label">${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><button class="primary" data-action="book">＋ New appointment</button></div></header><main>${pages[state.page]()}</main><footer>CHAIRSIDE <span>Good business. Better days.</span><span>USD · ${esc(biz().timezone)}</span></footer></div>`;
  bind();
  extension.bind();
  if (state.user.role === "staff")
    document.querySelectorAll("[data-edit]").forEach((b) => (b.hidden = true));
}
function bind() {
  document.querySelectorAll("[data-nav]").forEach(
    (b) =>
      (b.onclick = () => {
        state.page = b.dataset.nav;
        if (state.page === "Overview") state.date = dateKey(new Date());
        state.search = "";
        render();
        window.scrollTo({ top: 0, behavior: "instant" });
      }),
  );
  document.querySelectorAll("[data-sale]").forEach(
    (b) =>
      (b.onclick = () => {
        const p = find("products", b.dataset.sale);
        modalForm(
          "Record retail cash sale",
          `<p class="wide">${esc(p.name)} · ${money(p.price)} each · ${p.stock} in stock. Record cash already collected.</p>` +
            field(
              "Quantity",
              "quantity",
              1,
              "number",
              `min="1" max="${p.stock}" required`,
            ),
          (data) =>
            send("/sales", {
              productId: p.id,
              quantity: Number(data.quantity),
            }),
          "Record cash sale",
        );
      }),
  );
  $("#location").onchange = (e) => {
    state.location = e.target.value;
    render();
  };
  document
    .querySelectorAll("[data-edit]")
    .forEach((b) => (b.onclick = () => edit(...b.dataset.edit.split(":"))));
  document
    .querySelectorAll("[data-appointment]")
    .forEach(
      (b) => (b.onclick = () => appointmentDetail(b.dataset.appointment)),
    );
  document
    .querySelectorAll("[data-client]")
    .forEach((b) => (b.onclick = () => clientDetail(b.dataset.client)));
  document
    .querySelectorAll("[data-delete]")
    .forEach(
      (b) => (b.onclick = () => deleteRecord(...b.dataset.delete.split(":"))),
    );
  document
    .querySelectorAll("[data-action]")
    .forEach((b) => (b.onclick = () => actions[b.dataset.action]()));
  $("#calendar-date")?.addEventListener("change", (e) => {
    state.date = e.target.value;
    render();
  });
  document.querySelectorAll("[data-day]").forEach(
    (b) =>
      (b.onclick = () => {
        const d = new Date(state.date + "T12:00:00");
        d.setDate(d.getDate() + Number(b.dataset.day));
        state.date =
          b.dataset.day === "0"
            ? new Date().toLocaleDateString("en-CA")
            : d.toLocaleDateString("en-CA");
        render();
      }),
  );
  $("#client-search")?.addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    state.search = e.target.value;
    render();
    $("#client-search").focus();
    $("#client-search").setSelectionRange(pos, pos);
  });
}
function edit(kind, key) {
  const x = key ? find(kind, key) : {},
    d = state.data;
  let fields = "";
  const name = () =>
    field("Name", "name", x.name || "", "text", 'required maxlength="120"');
  const active = () =>
    `<label class="check"><input name="active" type="checkbox" ${x.active !== false ? "checked" : ""}> Active and bookable</label>`;
  const dollars = (label, key, value) =>
    field(
      label,
      key,
      (value || 0) / 100,
      "number",
      'min="0" step="0.01" required',
    );
  if (kind === "clients")
    fields =
      name() +
      field("Email", "email", x.email, "email", "required") +
      field("Phone", "phone", x.phone) +
      field(
        "Loyalty points",
        "points",
        x.points || 0,
        "number",
        'min="0" required',
      ) +
      `<label class="wide">Preferences & notes<textarea name="notes">${esc(x.notes)}</textarea></label><label class="check wide"><input name="marketingConsent" type="checkbox" ${x.marketingConsent ? "checked" : ""}> Client has explicitly opted in to marketing</label>`;
  if (kind === "services")
    fields =
      name() +
      field("Category", "category", x.category || "Hair") +
      dollars("Price ($)", "price", x.price) +
      field(
        "Duration (minutes)",
        "duration",
        x.duration || 45,
        "number",
        'min="15" max="480" step="15" required',
      ) +
      field(
        "Buffer (minutes)",
        "buffer",
        x.buffer || 0,
        "number",
        'min="0" step="5" required',
      ) +
      active();
  if (kind === "staff")
    fields =
      name() +
      field("Title", "title", x.title || "Professional") +
      select("Location", "locationId", d.locations, x.locationId) +
      field(
        "Commission (%)",
        "commission",
        x.commission ?? 60,
        "number",
        'min="0" max="100" required',
      ) +
      field("Calendar color", "color", x.color || "#d9e8dc", "color") +
      active();
  if (kind === "products")
    fields =
      name() +
      dollars("Retail price ($)", "price", x.price) +
      field(
        "Stock count",
        "stock",
        x.stock || 0,
        "number",
        'min="0" required',
      ) +
      field(
        "Reorder at",
        "reorderAt",
        x.reorderAt ?? 5,
        "number",
        'min="0" required',
      );
  if (kind === "memberships")
    fields =
      name() +
      dollars("Monthly price ($)", "price", x.price) +
      field(
        "Monthly service credits",
        "credits",
        x.credits || 2,
        "number",
        'min="1" required',
      ) +
      field("Description", "description", x.description) +
      active();
  if (kind === "campaigns")
    fields =
      name() +
      field("Subject", "subject", x.subject, "text", "required") +
      `<label class="wide">Message<textarea name="body" required>${esc(x.body)}</textarea></label><p class="muted wide">Saved as a draft. Delivery is not connected. Only opted-in clients may receive marketing.</p>`;
  if (kind === "waitlist")
    fields =
      name() +
      field("Email", "email", x.email, "email", "required") +
      select("Location", "locationId", d.locations, x.locationId) +
      select(
        "Service",
        "serviceId",
        d.services.filter((s) => s.active),
        x.serviceId,
      ) +
      field(
        "Preferred date",
        "date",
        x.date || state.date,
        "date",
        "required",
      ) +
      select(
        "Status",
        "status",
        [
          { id: "waiting", name: "Waiting" },
          { id: "booked", name: "Booked" },
        ],
        x.status,
      ) +
      field("Notes", "notes", x.notes);
  if (kind === "settings")
    fields =
      name() +
      field("Timezone", "timezone", x.timezone, "text", "required") +
      field(
        "Booking window (days)",
        "bookingDays",
        x.bookingDays,
        "number",
        'min="1" max="365" required',
      ) +
      field(
        "Cancellation notice (hours)",
        "cancelHours",
        "taxBasisPoints",
        x.cancelHours,
        "number",
        'min="0" required',
      );
  if (kind === "locations")
    fields =
      name() +
      field("Address", "address", x.address) +
      field(
        "Opening hour (24h)",
        "open",
        x.open ?? 9,
        "number",
        'min="0" max="23" required',
      ) +
      field(
        "Closing hour (24h)",
        "close",
        x.close ?? 19,
        "number",
        'min="1" max="24" required',
      ) +
      `<label class="wide">Open days (0 = Sunday, 6 = Saturday)<input name="days" value="${(x.days || [1, 2, 3, 4, 5, 6]).join(",")}" required></label>`;
  if (kind === "giftcards")
    fields =
      name() +
      field(
        "Gift code",
        "code",
        x.code || crypto.randomUUID().slice(0, 8).toUpperCase(),
        "text",
        "required",
      ) +
      dollars("Remaining balance ($)", "balance", x.balance);
  if (kind === "subscriptions")
    fields =
      name() +
      select("Client", "clientId", d.clients, x.clientId) +
      select("Plan", "membershipId", d.memberships, x.membershipId) +
      field(
        "Remaining credits",
        "credits",
        x.credits ?? 2,
        "number",
        'min="0" required',
      ) +
      select(
        "Status",
        "status",
        [
          { id: "active", name: "Active" },
          { id: "paused", name: "Paused" },
          { id: "cancelled", name: "Cancelled" },
        ],
        x.status,
      );
  if (kind === "rent")
    fields =
      name() +
      select("Professional", "staffId", d.staff, x.staffId) +
      dollars("Rent amount ($)", "amount", x.amount) +
      field("Due date", "due", x.due || state.date, "date", "required") +
      select(
        "Status",
        "status",
        [
          { id: "due", name: "Due" },
          { id: "paid", name: "Paid manually" },
        ],
        x.status,
      );
  if (kind === "locations")
    fields +=
      field(
        "Location timezone",
        "timezone",
        x.timezone || state.data.settings[0].timezone,
      ) +
      field(
        "Tax rate (basis points; 100 = 1%)",
        "taxBasisPoints",
        x.taxBasisPoints || 0,
        "number",
        'min="0" max="5000"',
      );
  if (kind === "staff")
    fields += `<label class="wide">Additional locations<select name="extraLocations" multiple>${options(d.locations, "name", "")}</select></label>`;
  if (kind === "services")
    fields += d.locations
      .map((l) =>
        field(
          "Price at " + l.name + " ($; blank uses default)",
          "locationPrice_" + l.id,
          x.locationPrices?.[l.id] !== undefined
            ? x.locationPrices[l.id] / 100
            : "",
          "number",
          'min="0" step="0.01"',
        ),
      )
      .join("");
  if (kind === "memberships")
    fields += field(
      "Stripe recurring Price ID",
      "stripePriceId",
      x.stripePriceId || "",
    );
  modalForm(
    `${key ? "Edit" : "Add"} ${{ staff: "professional", products: "product", services: "service", clients: "client", settings: "business", locations: "location", waitlist: "waitlist entry", memberships: "membership", campaigns: "campaign", giftcards: "gift card", subscriptions: "enrollment", rent: "rent record" }[kind]}`,
    fields,
    async (data) => {
      for (const k of ["price", "balance", "amount"])
        if (k in data) data[k] = Math.round(Number(data[k]) * 100);
      for (const k of [
        "duration",
        "buffer",
        "commission",
        "points",
        "stock",
        "reorderAt",
        "credits",
        "open",
        "close",
        "bookingDays",
        "cancelHours",
        "taxBasisPoints",
      ])
        if (k in data) data[k] = Number(data[k]);
      if (["staff", "services", "memberships"].includes(kind))
        data.active = data.active === "on";
      if (kind === "clients")
        data.marketingConsent = data.marketingConsent === "on";
      if (kind === "staff")
        data.locationIds = [
          ...new Set([
            data.locationId,
            ...Array.from(
              document.querySelector("[name=extraLocations]").selectedOptions,
            ).map((o) => o.value),
          ]),
        ];
      if (kind === "services")
        data.locationPrices = Object.fromEntries(
          d.locations
            .filter((l) => data["locationPrice_" + l.id] !== "")
            .map((l) => [
              l.id,
              Math.round(Number(data["locationPrice_" + l.id]) * 100),
            ]),
        );
      if (kind === "locations") data.days = data.days.split(",").map(Number);
      if (kind === "campaigns") {
        data.status = "draft";
        data.audience = "consented";
      }
      if (kind === "settings") {
        data.currency = "USD";
        data.loyaltyPointsPerDollar = 1;
      }
      await send(
        `/records/${kind}${key ? "/" + key : ""}`,
        data,
        key ? "PATCH" : "POST",
      );
    },
  );
}
function deleteRecord(kind, key) {
  modalForm(
    "Remove this record?",
    '<p class="wide">This will permanently remove this record.</p>',
    () => api(`/records/${kind}/${key}`, { method: "DELETE" }),
    "Remove record",
  );
}
function clientDetail(key) {
  const c = find("clients", key);
  showModal(
    "Client profile",
    `<div class="profile-detail">${avatar(c)}<h2>${esc(c.name)}</h2><p>${esc(c.email)} · ${esc(c.phone || "No phone")}</p><div class="notice">${esc(c.notes || "No preferences saved yet.")}</div><p>${c.points} loyalty points · Marketing ${c.marketingConsent ? "opted in" : "not opted in"}</p><button class="secondary" id="edit-client">Edit profile</button></div><h3>Visit history</h3>${appointmentRows(state.data.appointments.filter((a) => a.client_id === key))}`,
  );
  $("#edit-client").onclick = () => {
    modal.close();
    edit("clients", key);
  };
  modal.querySelectorAll("[data-appointment]").forEach(
    (b) =>
      (b.onclick = () => {
        modal.close();
        appointmentDetail(b.dataset.appointment);
      }),
  );
  modal.querySelector('[data-action="book"]')?.addEventListener("click", () => {
    modal.close();
    newBooking();
  });
}
function appointmentDetail(key) {
  const a = state.data.appointments.find((x) => x.id === key),
    c = find("clients", a.client_id),
    active = ["confirmed", "checked-in"].includes(a.status);
  showModal(
    "Appointment details",
    `<div class="appointment-detail"><div class="person">${avatar(c)}<div><h2>${esc(c.name)}</h2><p>${esc(c.email)}</p></div>${badge(a.status)}</div><div class="detail-grid"><div><small>Service</small><b>${esc(find("services", a.service_id).name)}</b></div><div><small>Professional</small><b>${esc(find("staff", a.staff_id).name)}</b></div><div><small>When</small><b>${fullDate(a.start)} · ${time(a.start)}</b></div><div><small>Total</small><b>${money(a.price)}</b></div></div><p>${esc(a.notes || "No appointment notes.")}</p>${active ? `<div class="action-grid">${a.status === "confirmed" ? '<button class="secondary" data-status="checked-in">Check in</button>' : ""}<button class="secondary" id="reschedule">Reschedule</button><button class="secondary danger" data-status="no-show">Mark no-show</button><button class="secondary danger" data-status="cancelled">Cancel appointment</button></div><form id="checkout-form"><h3>Cash checkout</h3><div class="form-grid">${field("Tip ($)", "tip", 0, "number", 'min="0" max="1000" step="0.01" required')}<button class="primary">Complete · ${money(a.price)} + tip</button></div><p class="form-error" role="alert"></p></form>` : ""}</div>`,
  );
  modal.querySelectorAll("[data-status]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await send(
            "/appointments/" + key,
            { status: b.dataset.status },
            "PATCH",
          );
          modal.close();
          await refresh();
          toast("Appointment updated");
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  $("#checkout-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      const tip = Math.round(Number(new FormData(e.target).get("tip")) * 100);
      await send("/checkout", { appointmentId: key, tip, method: "cash" });
      modal.close();
      await refresh();
      toast("Cash payment recorded. Loyalty points added.");
    } catch (err) {
      modal.querySelector(".form-error").textContent = err.message;
      e.submitter.disabled = false;
    }
  });
  $("#reschedule")?.addEventListener("click", () => {
    modal.close();
    newBooking(a);
  });
}
async function newBooking(existing) {
  const d = state.data;
  modalForm(
    existing ? "Reschedule appointment" : "New appointment",
    select("Location", "locationId", d.locations, existing?.location_id) +
      select(
        "Service",
        "serviceId",
        d.services.filter((x) => x.active),
        existing?.service_id,
      ) +
      select(
        "Professional",
        "staffId",
        d.staff.filter((x) => x.active),
        existing?.staff_id,
      ) +
      select("Client", "clientId", d.clients, existing?.client_id) +
      select(
        "Chair / room (optional)",
        "resourceId",
        [
          { id: "", name: "No assigned resource" },
          ...(state.ops?.resources || []).filter((r) => r.active),
        ],
        existing?.resource_id,
      ) +
      field("Date", "date", state.date, "date", "required") +
      `<label>Available time<select name="start" required><option value="">Choose a date</option></select></label>` +
      (existing
        ? ""
        : field(
            "Number of visits",
            "repeatCount",
            1,
            "number",
            'min="1" max="12" required',
          ) +
          select("Repeat interval", "repeatWeeks", [
            { id: "1", name: "Every week" },
            { id: "2", name: "Every 2 weeks" },
            { id: "4", name: "Every 4 weeks" },
          ])) +
      `<label class="check wide"><input type="checkbox" name="repeatForever"> Keep this schedule recurring within the booking window</label><label class="wide">Notes<textarea name="notes"></textarea></label>`,
    async (data) => {
      if (existing)
        await send(
          "/appointments/" + existing.id,
          { start: data.start },
          "PATCH",
        );
      else {
        data.repeatForever = data.repeatForever === "on";
        await send("/appointments", data);
      }
    },
    existing ? "Save new time" : "Book appointment",
  );
  const form = $("#edit-form");
  if (existing)
    ["locationId", "serviceId", "staffId", "clientId"].forEach(
      (k) => (form.elements[k].disabled = true),
    );
  let slotRequest = 0;
  const slots = async () => {
    const request = ++slotRequest;
    const loc = form.elements.locationId.value;
    const current = form.elements.staffId.value;
    form.elements.staffId.innerHTML = options(
      d.staff.filter(
        (s) => s.active && (s.locationIds || [s.locationId]).includes(loc),
      ),
      "name",
      current,
    );
    form.elements.start.innerHTML = '<option value="">Loading…</option>';
    try {
      const query = new URLSearchParams({
        locationId: loc,
        serviceId: form.elements.serviceId.value,
        staffId: form.elements.staffId.value,
        date: form.elements.date.value,
        resourceId: form.elements.resourceId?.value || "",
      });
      const slots = await api("/public/availability?" + query);
      if (request !== slotRequest || !form.isConnected) return;
      form.elements.start.innerHTML = slots.length
        ? slots
            .map((s) => `<option value="${s.start}">${time(s.start)}</option>`)
            .join("")
        : '<option value="">No available times</option>';
    } catch (e) {
      toast(e.message);
    }
  };
  ["locationId", "serviceId", "staffId", "date", "resourceId"].forEach(
    (k) => (form.elements[k].onchange = slots),
  );
  await slots();
}
const actions = {
  book: () => newBooking(),
  logout: async () => {
    await send("/logout", {});
    location.href = "/";
  },
  block: () =>
    modalForm(
      "Block time",
      select("Professional", "staffId", state.data.staff) +
        field(
          "Start (your device timezone)",
          "start",
          "",
          "datetime-local",
          "required",
        ) +
        field(
          "End (your device timezone)",
          "end",
          "",
          "datetime-local",
          "required",
        ) +
        field("Reason", "notes", "Time off"),
      (data) =>
        send("/records/blocks", {
          ...data,
          start: new Date(data.start).toISOString(),
          end: new Date(data.end).toISOString(),
        }),
      "Block time",
    ),
  export: () => {
    const escapeCell = (v) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const rows = [
      ["Client", "Service", "Staff", "Start (UTC)", "Status", "Price USD"],
      ...appointments().map((a) => [
        find("clients", a.client_id).name,
        find("services", a.service_id).name,
        find("staff", a.staff_id).name,
        a.start,
        a.status,
        a.price / 100,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(escapeCell).join(",")).join("\r\n")], {
        type: "text/csv",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "chairside-appointments.csv";
    a.click();
    URL.revokeObjectURL(url);
  },
};
async function auth() {
  const session = await api("/session");
  if (session.user) {
    state.user = session.user;
    if (state.user.role === "customer") {
      location.href = "/portal";
      return;
    }
    await refresh();
    return;
  }
  app.innerHTML = `<div class="auth-layout"><div class="auth-story"><a class="brand" href="/"><img src="/icon.svg" alt="">chairside</a><span class="eyebrow">GOOD BUSINESS. BETTER DAYS.</span><h1>Your craft.<br>Your people.<br>Your studio.</h1><p>A calmer way to keep your business moving.</p><div class="auth-art" aria-hidden="true">✳</div></div><div class="auth-form"><span class="eyebrow">STUDIO WORKSPACE</span><h1>${session.setup ? "Make yourself at home." : "Welcome back."}</h1><p>${session.setup ? "Create your owner account to set up your studio." : "Sign in to pick up where you left off."}</p><form id="auth-form">${session.setup ? field("Your name", "name", "", "text", 'required autocomplete="name"') : ""}${session.setup && session.setupTokenRequired ? field("Setup token", "setupToken", "", "password", "required") : ""}${field("Email address", "email", "", "email", 'required autocomplete="email"')}${field("Password", "password", "", "password", `required minlength="12" maxlength="200" autocomplete="${session.setup ? "new-password" : "current-password"}"`)}${!session.setup ? field("Authenticator code (if enabled)", "code", "", "text", 'inputmode="numeric"') : ""}${session.setup ? "<small>Use at least 12 characters. This becomes the owner account.</small>" : ""}<p class="form-error" role="alert"></p><button class="primary">${session.setup ? "Create workspace" : "Sign in"} →</button></form><a href="/book" class="text-btn">Here for an appointment? Book a visit ↗</a> · <a class="text-btn" href="/account?action=recover">Reset password</a><p class="footnote">Your workspace is private. Customers can book through your public booking page.</p></div></div>`;
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      await send(
        session.setup ? "/setup" : "/login",
        Object.fromEntries(new FormData(e.target)),
      );
      await auth();
    } catch (err) {
      $(".form-error").textContent = err.message;
      e.submitter.disabled = false;
    }
  };
}
async function customer() {
  catalog = await api("/public/catalog");
  booking.locationId = catalog.locations[0]?.id;
  booking.serviceId = catalog.services[0]?.id;
  booking.date = new Date().toLocaleDateString("en-CA");
  renderCustomer();
}
function renderCustomer() {
  const service = catalog.services.find((x) => x.id === booking.serviceId),
    locationInfo = catalog.locations.find((x) => x.id === booking.locationId);
  app.innerHTML = `<div class="booking-page"><header><a class="brand" href="/book"><img src="/icon.svg" alt="">${esc(catalog.settings.name)}</a><a href="/" class="text-btn">Studio sign in ↗</a><a class="text-btn" href="/portal">My appointments</a></header><main class="booking-layout"><aside><span class="eyebrow">LOOK GOOD. FEEL LIKE YOURSELF.</span><h1>Your next <br>great visit <br>starts here.</h1><p>Good people. Thoughtful service.<br>A little time, just for you.</p><div class="booking-flower" aria-hidden="true">✳</div><div class="studio-address"><b>${esc(locationInfo?.name)}</b><p>${esc(locationInfo?.address)}</p><small>All appointment times shown in ${esc(catalog.settings.timezone)}.</small></div></aside><section class="booking-form panel"><div class="section-head"><div><span class="eyebrow">BOOK YOUR VISIT</span><h2>Let's make time for you.</h2></div><span class="step-dot">1 / 2</span></div><form id="booking-form"><div class="form-grid">${select("Choose your studio", "locationId", catalog.locations, booking.locationId)}${select(
    "Your professional",
    "staffId",
    catalog.staff.filter((s) =>
      (s.locationIds || [s.locationId]).includes(booking.locationId),
    ),
    booking.staffId,
  )}</div><h3>Choose your service</h3><div class="service-options">${catalog.services.map((s) => `<label class="service-option ${s.id === booking.serviceId ? "selected" : ""}"><input type="radio" name="serviceId" value="${s.id}" ${s.id === booking.serviceId ? "checked" : ""}><div><b>${esc(s.name)}</b><small>${s.duration} min</small></div><strong>${money(s.price)}</strong></label>`).join("")}</div><label class="spaced">Additional services (optional)<select name="extraServices" multiple>${options(catalog.services.filter((s) => s.id !== booking.serviceId))}</select></label><div class="form-grid spaced">${field("Pick a date", "date", booking.date, "date", "required")}<label>Available time<select name="start" required><option value="">Loading times…</option></select></label></div><p><a class="text-btn" href="/waitlist">Can’t find a time? Join the waitlist →</a> · <a class="text-btn" href="/group">Book a group</a></p><h3>Your details</h3><div class="form-grid">${field("Full name", "name", booking.name || "", "text", 'required autocomplete="name" maxlength="120"')}${field("Email", "email", booking.email || "", "email", 'required autocomplete="email"')}${field("Phone (optional)", "phone", booking.phone || "", "tel", 'autocomplete="tel"')}<label class="check"><input type="checkbox" name="marketingConsent"> Keep me updated with studio offers</label></div><p class="booking-policy">Pay at your visit. Cancel online at least ${catalog.settings.cancelHours} hours ahead. Save your confirmation link to manage your appointment.</p><p class="form-error" role="alert"></p><button class="primary booking-submit">Confirm appointment · ${money(service?.price)} →</button></form></section></main><footer>Powered by Chairside <span>Good business. Better days.</span></footer></div>`;
  const form = $("#booking-form");
  let slotRequest = 0;
  const loadSlots = async () => {
    const request = ++slotRequest;
    form.elements.start.innerHTML = '<option value="">Loading times…</option>';
    try {
      const query = new URLSearchParams({
        locationId: form.elements.locationId.value,
        staffId: form.elements.staffId.value,
        serviceId: form.elements.serviceId.value,
        serviceIds: [
          form.elements.serviceId.value,
          ...Array.from(form.elements.extraServices?.selectedOptions || []).map(
            (o) => o.value,
          ),
        ].join(","),
        date: form.elements.date.value,
      });
      const slots = await api("/public/availability?" + query);
      if (request !== slotRequest || !form.isConnected) return;
      form.elements.start.innerHTML = slots.length
        ? slots
            .map((s) => `<option value="${s.start}">${time(s.start)}</option>`)
            .join("")
        : '<option value="">No times available — try another date</option>';
    } catch (e) {
      $(".form-error").textContent = e.message;
    }
  };
  form.elements.locationId.onchange = () => {
    booking = { ...booking, ...Object.fromEntries(new FormData(form)) };
    renderCustomer();
  };
  form.elements.staffId.onchange = loadSlots;
  if (form.elements.extraServices)
    form.elements.extraServices.onchange = () => {
      const ids = [
        form.elements.serviceId.value,
        ...Array.from(form.elements.extraServices.selectedOptions).map(
          (o) => o.value,
        ),
      ];
      form.querySelector(".booking-submit").textContent =
        "Confirm appointment · " +
        money(
          catalog.services
            .filter((s) => ids.includes(s.id))
            .reduce(
              (n, s) =>
                n +
                (s.locationPrices?.[form.elements.locationId.value] ?? s.price),
              0,
            ),
        ) +
        " →";
      loadSlots();
    };
  form.elements.date.onchange = loadSlots;
  form.querySelectorAll('[name="serviceId"]').forEach(
    (r) =>
      (r.onchange = () => {
        booking = { ...booking, ...Object.fromEntries(new FormData(form)) };
        renderCustomer();
      }),
  );
  loadSlots();
  form.onsubmit = async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      data.marketingConsent = data.marketingConsent === "on";
      data.serviceIds = [
        data.serviceId,
        ...Array.from(form.elements.extraServices?.selectedOptions || []).map(
          (o) => o.value,
        ),
      ];
      data.attribution = bookingAttribution();
      const result = await send("/public/book", data);
      trackBooking();
      location.href = "/manage#" + result.manageToken;
    } catch (err) {
      $(".form-error").textContent = err.message;
      e.submitter.disabled = false;
    }
  };
}
async function manage() {
  catalog = await api("/public/catalog");
  const token = location.hash.slice(1);
  if (!/^[a-f0-9]{48}$/.test(token))
    throw Error("This confirmation link is invalid.");
  const a = await api("/public/appointment/" + token);
  app.innerHTML = `<div class="confirmation"><a class="brand" href="/book"><img src="/icon.svg" alt="">chairside</a><section class="panel"><div class="confirmation-icon">${a.status === "cancelled" ? "×" : "✓"}</div><span class="eyebrow">${a.status === "cancelled" ? "APPOINTMENT CANCELLED" : "YOUR VISIT, CONFIRMED"}</span><h1>${a.status === "cancelled" ? "See you another time." : "You're on the books."}</h1><p>${esc(a.service)} with ${esc(a.staff)}</p><h2>${fullDate(a.start)} at ${time(a.start)}</h2><p>${esc(catalog.settings.timezone)}</p>${badge(a.status)}<div class="notice">Bookmark this private link to manage your visit. Use it to reschedule or cancel within studio policy.</div>${a.status === "confirmed" ? `<a class="secondary" href="/reschedule#${token}">Reschedule</a><button class="secondary danger" id="cancel-booking">Cancel appointment</button>` : ""}<a class="primary" href="/book">Book another visit →</a><p id="manage-error" role="alert"></p></section></div>`;
  $("#cancel-booking")?.addEventListener("click", () => {
    showModal(
      "Cancel your appointment?",
      `<p>This releases your reserved time. You can book another visit whenever you’re ready.</p><button class="primary" id="confirm-cancel">Yes, cancel appointment</button><p class="form-error" role="alert"></p>`,
    );
    $("#confirm-cancel").onclick = async () => {
      try {
        await send("/public/appointment/" + token, { action: "cancel" });
        modal.close();
        await manage();
      } catch (e) {
        modal.querySelector(".form-error").textContent = e.message;
      }
    };
  });
}
extension = extensions({
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
});
(async () => {
  try {
    if (
      [
        "/account",
        "/portal",
        "/portal/book",
        "/studio",
        "/unsubscribe",
        "/group",
        "/waitlist",
        "/reschedule",
      ].includes(location.pathname)
    )
      await standalone(
        { api, send, esc, money, field, select, options, toast },
        location.pathname,
      );
    else if (location.pathname === "/book") await customer();
    else if (location.pathname === "/manage") await manage();
    else await auth();
    initAnalytics().catch(() => {});
  } catch (e) {
    app.innerHTML = `<div class="confirmation"><section class="panel"><h1>We couldn't load this page.</h1><p>${esc(e.message)}</p><a class="primary" href="/">Return to workspace</a></section></div>`;
  }
})();

if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
