export function growthTools({
  state,
  api,
  send,
  esc,
  money,
  field,
  select,
  modalForm,
  showModal,
  refresh,
  toast,
}) {
  const metric = (label, value, note = "") =>
    `<section class="stat"><div>${label}</div><strong>${value}</strong><small>${note}</small></section>`;
  const button = (label, action) =>
    `<button class="secondary" data-marketing="${action}">${label}</button>`;
  const templates = {
    announcement: {
      name: "Studio news",
      subject: "Something new at your studio",
      body: "We have something new to share. Book your next visit and come see what’s happening.",
      segment: "all",
    },
    winback: {
      name: "We miss you",
      subject: "Ready for a little time for yourself?",
      body: "It’s been a while. We’d love to welcome you back for your next visit. Find a time that works for you below.",
      segment: "lapsed",
    },
    loyal: {
      name: "A thank-you to our regulars",
      subject: "Thanks for making us your studio",
      body: "You’re a big part of what makes this place special. Thank you for coming back. We look forward to seeing you again.",
      segment: "vip",
    },
  };
  function marketing() {
    const d = state.marketing;
    if (!d) return "<p>Marketing data is unavailable.</p>";
    return `<div class="page-heading"><div><span class="eyebrow">MAKE YOUR NEXT MOVE</span><h1>Turn first visits into regulars.</h1><p>Build an audience. Create a campaign. Measure the response.</p></div>${button("＋ New campaign", "new")}</div><div class="stats">${metric("Opted-in audience", d.segments[0].count, "Unique email addresses")}${metric("Campaigns", d.campaigns.length, "Drafts and queued sends")}${metric("Lapsed clients", d.segments.find((s) => s.id === "lapsed").count, "60+ days since a completed visit")}${metric("Repeat clients", d.segments.find((s) => s.id === "returning").count, "Two or more completed visits")}</div><div class="marketing-templates">${Object.entries(
      templates,
    )
      .map(
        ([key, t]) =>
          `<section class="panel padded"><span class="eyebrow">CAMPAIGN STARTER</span><h2>${esc(t.name)}</h2><p>${esc(t.subject)}</p>${button("Use template →", "template:" + key)}</section>`,
      )
      .join(
        "",
      )}</div><section class="panel spaced"><div class="section-head"><div><h2>Your campaigns</h2><p>Delivery totals are lifetime; attributed bookings use the Analytics date window. Opens and clicks depend on provider tracking and may include bots.</p></div></div><div class="table-scroll"><table><thead><tr><th>Campaign</th><th>Audience / status</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th>Bookings</th><th></th></tr></thead><tbody>${d.campaigns.map((c) => `<tr><td><b>${esc(c.name)}</b><br><small>${esc(c.subject)}</small></td><td>${esc(c.segment || "all")} · ${esc(c.status)}${c.scheduledAt ? "<br><small>" + esc(new Date(c.scheduledAt).toLocaleString()) + "</small>" : ""}</td><td>${c.metrics.delivered}</td><td>${c.metrics.opened}</td><td>${c.metrics.clicked}</td><td>${c.attributedBookings}</td><td>${button(c.status === "draft" ? "Preview & schedule" : "View", "preview:" + c.id)}${c.status === "draft" ? button("Edit", "edit:" + c.id) : ""}${c.status === "queued" ? button("Stop pending", "cancel:" + c.id) : ""}</td></tr>`).join("") || '<tr><td colspan="7">Start with a template or create your first campaign.</td></tr>'}</tbody></table></div></section><div class="notice spaced">Only clients who opted in receive campaigns. Unsubscribe links and a tracked booking link are added automatically. Scheduling needs configured email delivery and an enabled worker.</div>`;
  }
  function analytics() {
    const d = state.marketing;
    if (!d) return "<p>Analytics are unavailable.</p>";
    const max = Math.max(1, ...d.daily.map((x) => x.bookings));
    return `<div class="page-heading"><div><span class="eyebrow">THE SIGNAL BEHIND THE SCHEDULE</span><h1>Know what brings people in.</h1><p>First-party appointment performance, campaign attribution and exportable source reports.</p></div>${button("Export source CSV", "export")}</div><form id="marketing-range" class="panel report-filters">${field("From", "from", d.from, "date", "required")}${field("Through", "to", d.to, "date", "required")}<button class="primary">Update report</button></form><div class="stats spaced">${metric("Bookings", d.bookings)}${metric("Completed", d.completed)}${metric("No-shows", d.noShows)}${metric("Booked value", money(d.bookedValue), "Service value, not collected revenue")}</div><section class="panel"><div class="section-head"><h2>Bookings by appointment date</h2><small>UTC date window · days with appointments</small></div><div class="analytics-bars">${d.daily.map((x) => `<div class="analytics-bar"><span>${esc(x.date)}</span><div><i style="width:${(x.bookings / max) * 100}%"></i></div><b>${x.bookings}</b></div>`).join("") || "<p>No appointments in this date range.</p>"}</div></section><div class="growth-grid spaced"><section class="panel"><div class="section-head"><h2>Booking sources</h2></div><div class="table-scroll"><table><thead><tr><th>Source</th><th>Bookings</th><th>Completed</th><th>Value</th></tr></thead><tbody>${d.sources.map((s) => `<tr><td>${esc(s.source)}</td><td>${s.bookings}</td><td>${s.completed}</td><td>${money(s.bookedValue)}</td></tr>`).join("") || '<tr><td colspan="4">No attributed appointments yet.</td></tr>'}</tbody></table></div></section><section class="panel padded"><span class="eyebrow">TRACK YOUR NEXT CAMPAIGN</span><h2>Every channel gets its own link.</h2><p>Create a booking link for Instagram, Google, a flyer or an email campaign. Source tags are self-reported attribution, not proof that a campaign caused a booking.</p>${button("Build a booking link", "link")}</section></div><div class="notice spaced">Financial totals remain in Reports. Google Analytics is optional and configured in Integrations; these reports do not depend on Google or tracking cookies.</div>`;
  }
  function integrations() {
    const d = state.integrations;
    if (!d) return "<p>Integration data is unavailable.</p>";
    return `<div class="page-heading"><div><span class="eyebrow">YOUR CONNECTED STUDIO</span><h1>Bring your tools together.</h1><p>Native adapters, setup instructions and honest connection status. Credentials stay on the server.</p></div></div><div class="notice">Delivery worker: <b>${d.worker ? "Enabled" : "Not enabled"}</b>. “Configured” means required values are present; it does not certify a successful provider test.</div><div class="integration-grid spaced">${d.items.map((i) => `<section class="panel integration-card"><div class="integration-monogram">${esc(i.name.slice(0, 2).toUpperCase())}</div><span class="eyebrow">${esc(i.category)}</span><h2>${esc(i.name)}</h2><span class="badge ${i.configured ? "active" : "pending"}">${i.limited ? "Transport only" : i.configured ? (i.id === "csv" ? "Available" : "Configured") : "Setup required"}</span><p>${esc(i.description)}</p>${button(i.id === "ga4" ? "Configure analytics" : "Setup & details", "integration:" + i.id)}</section>`).join("")}</div>`;
  }
  function compose(template) {
    const t = template || { name: "", subject: "", body: "", segment: "all" };
    modalForm(
      "Create a campaign",
      field(
        "Campaign name",
        "name",
        t.name,
        "text",
        'required maxlength="120"',
      ) +
        field(
          "Email subject",
          "subject",
          t.subject,
          "text",
          'required maxlength="200"',
        ) +
        select(
          "Audience",
          "segment",
          state.marketing.segments.map((s) => ({
            ...s,
            name: s.name + " (" + s.count + ")",
          })),
          t.segment,
        ) +
        `<label class="wide">Message<textarea name="body" rows="7" maxlength="10000" required>${esc(t.body)}</textarea></label><p class="wide">Saved as a draft. Preview recipients and choose the send time in the next step.</p>`,
      (d) => send("/marketing/campaigns", { ...d, id: t.id }),
      "Save draft",
    );
  }
  async function dispatch(value) {
    const [action, key] = value.split(":");
    try {
      if (action === "new") compose();
      if (action === "edit")
        compose(state.marketing.campaigns.find((c) => c.id === key));
      if (action === "template") compose(templates[key]);
      if (action === "preview") {
        const p = await send("/marketing/preview", { id: key }),
          c = state.marketing.campaigns.find((c) => c.id === key);
        if (c.status === "draft")
          modalForm(
            "Preview & schedule",
            `<div class="wide campaign-preview"><span class="eyebrow">${p.count} ELIGIBLE RECIPIENTS · ${esc(p.segment)}</span><h2>${esc(p.subject)}</h2><p>${esc(p.body).replaceAll("\n", "<br>")}</p><small>A booking link and unsubscribe link will be appended.</small></div>${field("Send time (your local time; blank sends now)", "when", "", "datetime-local")}`,
            (d) =>
              send("/marketing/schedule", {
                id: key,
                when: d.when ? new Date(d.when).toISOString() : null,
              }),
            "Queue campaign",
          );
        else
          showModal(
            "Campaign details",
            `<h2>${esc(p.subject)}</h2><p class="campaign-preview">${esc(p.body)}</p><p>Pending: ${c.metrics.pending} · Failed/bounced: ${c.metrics.failed}</p>`,
          );
      }
      if (action === "cancel")
        modalForm(
          "Stop pending campaign messages",
          `<p class="wide">Already delivered or in-flight messages cannot be recalled. All remaining pending/retry messages will be suppressed.</p>`,
          () => send("/marketing/cancel", { id: key }),
          "Stop pending sends",
        );
      if (action === "link") {
        showModal(
          "Build a campaign link",
          `<form id="utm-form"><div class="form-grid">${field("Source", "source", "instagram", "text", 'required pattern="[a-zA-Z0-9_.-]+" maxlength="80"')}${field("Medium", "medium", "social", "text", 'required pattern="[a-zA-Z0-9_.-]+" maxlength="80"')}${field("Campaign", "campaign", "spring-refresh", "text", 'required pattern="[a-zA-Z0-9_.-]+" maxlength="80"')}</div><button class="primary spaced">Generate link</button></form><label class="spaced">Your booking link<textarea id="utm-result" readonly rows="4"></textarea></label>`,
        );
        document.querySelector("#utm-form").onsubmit = (e) => {
          e.preventDefault();
          const q = new URLSearchParams(
            Array.from(new FormData(e.target)).map(([k, v]) => ["utm_" + k, v]),
          );
          document.querySelector("#utm-result").value =
            location.origin + "/book?" + q;
        };
      }
      if (action === "export") {
        const safe = (v) =>
            '"' +
            String(v)
              .replace(/^[=+@-]/, "'$&")
              .replaceAll('"', '""') +
            '"',
          rows = [
            [
              "Source",
              "Bookings",
              "Completed",
              "Cancelled",
              "Booked value (USD cents)",
            ],
            ...state.marketing.sources.map((s) => [
              s.source,
              s.bookings,
              s.completed,
              s.cancelled,
              s.bookedValue,
            ]),
          ],
          blob = new Blob([
            rows.map((r) => r.map(safe).join(",")).join("\r\n"),
          ]),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "chairside-sources-" + state.marketing.from + ".csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      if (action === "integration") {
        const i = state.integrations.items.find((i) => i.id === key),
          content = `<p>${esc(i.description)}</p><ol class="setup-steps">${i.steps.map((s) => "<li>" + esc(s) + "</li>").join("")}</ol>${i.requirements.length ? '<div class="setup-requirements">' + i.requirements.map((r) => "<p><code>" + r.key + "</code><b>" + (r.present ? "Present" : "Missing") + "</b></p>").join("") + "</div>" : ""}${i.webhook ? '<label>Webhook endpoint<input readonly value="' + esc(i.webhook) + '"></label>' : ""}<div class="action-grid spaced">${i.url ? '<a class="secondary" target="_blank" rel="noopener noreferrer" href="' + i.url + '">Open provider ↗</a>' : ""}${i.docs ? '<a class="secondary" target="_blank" rel="noopener noreferrer" href="' + i.docs + '">Official guide ↗</a>' : ""}</div>`;
        if (key === "ga4" && state.user.role === "owner")
          modalForm(
            "Google Analytics setup",
            `<div class="wide">${content}</div>${field("Measurement ID (blank disables tracking)", "ga4Id", state.integrations.ga4Id, "text", 'placeholder="G-XXXXXXXXXX"')}`,
            (d) => send("/integrations", d, "PATCH"),
            "Save configuration",
          );
        else showModal(i.name + " integration", content);
      }
    } catch (e) {
      toast(e.message);
    }
  }
  function bind() {
    document
      .querySelectorAll("[data-marketing]")
      .forEach((b) => (b.onclick = () => dispatch(b.dataset.marketing)));
    document
      .querySelector("#marketing-range")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          state.marketing = await api(
            "/marketing?" + new URLSearchParams(new FormData(e.target)),
          );
          state.marketingRange = {
            from: state.marketing.from,
            to: state.marketing.to,
          };
          await refresh();
        } catch (e) {
          toast(e.message);
        }
      });
  }
  return {
    pages: {
      Marketing: marketing,
      "Marketing analytics": analytics,
      Integrations: integrations,
    },
    bind,
  };
}
