const publicPages = ["/studio", "/book", "/group", "/waitlist"];
const consentKey = "chairside-analytics-choice";
let active = false;
export function bookingAttribution() {
  const q = new URLSearchParams(location.search);
  return Object.fromEntries(
    ["source", "medium", "campaign"].map((k) => [k, q.get("utm_" + k) || ""]),
  );
}
export function trackBooking() {
  if (active && window.gtag)
    window.gtag("event", "booking_complete", {
      page_location: location.origin + "/book",
      page_referrer: "",
      transport_type: "beacon",
    });
}
export async function initAnalytics() {
  if (!publicPages.includes(location.pathname)) return;
  const { ga4Id } = await (await fetch("/api/public/analytics-config")).json();
  if (!/^G-[A-Z0-9]{6,20}$/.test(ga4Id || "")) return;
  let choice = null;
  try {
    const saved = JSON.parse(localStorage.getItem(consentKey));
    if (saved && saved.at > Date.now() - 180 * 86400000) choice = saved.choice;
  } catch {}
  const activate = () => {
    if (active) return;
    active = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("consent", "default", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    window.gtag("js", new Date());
    window.gtag("config", ga4Id, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: location.origin + location.pathname,
      page_referrer: "",
    });
    window.gtag("event", "page_view", {
      page_location: location.origin + location.pathname,
      page_referrer: "",
      page_title: "Chairside public booking",
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + ga4Id;
    document.head.append(script);
  };
  const controls = document.createElement("button");
  controls.className = "privacy-choice secondary";
  controls.textContent = "Analytics preferences";
  document.body.append(controls);
  const prompt = () => {
    if (document.querySelector("#analytics-consent")) return;
    const panel = document.createElement("section");
    panel.id = "analytics-consent";
    panel.className = "consent-panel";
    panel.setAttribute("aria-label", "Analytics preferences");
    panel.innerHTML =
      '<strong>Your visit. Your choice.</strong><p>Allow Google Analytics to measure public page visits and successful bookings? Booking works either way. We do not send your contact details or private appointment links.</p><div><button class="primary" data-consent="yes">Allow analytics</button><button class="secondary" data-consent="no">No thanks</button></div>';
    document.body.append(panel);
    panel.querySelectorAll("[data-consent]").forEach(
      (b) =>
        (b.onclick = () => {
          const accepted = b.dataset.consent === "yes";
          try {
            localStorage.setItem(
              consentKey,
              JSON.stringify({ choice: accepted, at: Date.now() }),
            );
          } catch {}
          panel.remove();
          if (accepted) activate();
          else if (active) {
            window["ga-disable-" + ga4Id] = true;
            window.gtag("consent", "update", { analytics_storage: "denied" });
            location.reload();
          }
        }),
    );
  };
  controls.onclick = prompt;
  if (choice === true) activate();
  else if (choice === null) prompt();
}
