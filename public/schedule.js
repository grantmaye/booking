export function scheduleExtension({
  state,
  esc,
  find,
  time,
  api,
  send,
  toast,
  refresh,
}) {
  let view = "week",
    anchor = new Date().toLocaleDateString("en-CA");
  function dateKey(d, zone) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(d));
  }
  function render() {
    const first = new Date(anchor + "T12:00:00Z");
    if (view === "month") first.setUTCDate(1);
    else if (view === "week")
      first.setUTCDate(first.getUTCDate() - first.getUTCDay());
    const count =
      view === "day"
        ? 1
        : view === "week"
          ? 7
          : new Date(
              first.getUTCFullYear(),
              first.getUTCMonth() + 1,
              0,
            ).getUTCDate();
    const dates = Array.from({ length: count }, (_, i) =>
      new Date(+first + i * 86400000).toISOString().slice(0, 10),
    );
    const zone =
      state.data.locations.find((l) => l.id === state.location)?.timezone ||
      state.data.settings[0].timezone;
    const appointments = state.data.appointments.filter(
      (a) =>
        a.status !== "cancelled" &&
        (state.location === "all" || a.location_id === state.location),
    );
    return `<div class="page-heading"><div><h1>See the bigger picture.</h1><p>Drag an active appointment to another day to keep its local time. Click it to choose a new time.</p></div></div><section class="panel"><div class="section-head schedule-controls"><input aria-label="Schedule date" id="schedule-date" type="date" value="${anchor}"><select id="schedule-view" aria-label="Calendar view">${["day", "week", "month"].map((v) => `<option ${view === v ? "selected" : ""} value="${v}">${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}</select><span class="muted">${esc(zone)}</span></div><div class="schedule-grid" style="${view === "day" ? "grid-template-columns:1fr" : ""}">${dates
      .map(
        (date) =>
          `<section class="schedule-cell" data-date="${date}"><strong>${new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</strong>${appointments
            .filter((a) => dateKey(a.start, zone) === date)
            .map(
              (a) =>
                `<button class="schedule-booking" draggable="${["confirmed", "checked-in"].includes(a.status)}" data-move="${a.id}"><b>${esc(find("clients", a.client_id).name)}</b><small>${time(a.start)} · ${esc(find("staff", a.staff_id).name)}</small><small>${esc(a.status)}</small></button>`,
            )
            .join("")}</section>`,
      )
      .join("")}</div></section>`;
  }
  function bind() {
    const viewControl = document.querySelector("#schedule-view");
    if (!viewControl) return;
    viewControl.onchange = (e) => {
      view = e.target.value;
      refresh();
    };
    document.querySelector("#schedule-date").onchange = (e) => {
      anchor = e.target.value;
      refresh();
    };
    let dragged = null;
    document.querySelectorAll("[data-move]").forEach((b) => {
      b.ondragstart = (e) => {
        dragged = b.dataset.move;
        e.dataTransfer.setData("text/plain", dragged);
      };
      b.onclick = () => {
        const a = state.data.appointments.find((a) => a.id === b.dataset.move);
        const modal = document.querySelector("#modal");
        modal.innerHTML = `<div class="modal-head"><h2>Move appointment</h2><button id="close-move" class="icon-btn" aria-label="Close">×</button></div><form id="move-form"><label>Date<input name="date" type="date" value="${anchor}" required></label><label class="spaced">Local time<input name="time" type="time" step="900" required></label><p class="form-error"></p><button class="primary spaced">Save time</button>${a.series_id ? '<button type="button" class="secondary spaced" id="cancel-series">Cancel future series visits</button>' : ""}</form>`;
        modal.showModal();
        document.querySelector("#close-move").onclick = () => modal.close();
        document.querySelector("#move-form").onsubmit = async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target)),
            [h, m] = data.time.split(":").map(Number);
          try {
            await send(
              "/appointments/" + a.id,
              { localDate: data.date, minute: h * 60 + m },
              "PATCH",
            );
            modal.close();
            await refresh();
          } catch (e) {
            modal.querySelector(".form-error").textContent = e.message;
          }
        };
        document
          .querySelector("#cancel-series")
          ?.addEventListener("click", async () => {
            try {
              await send("/series", {
                seriesId: a.series_id,
                action: "cancel",
              });
              modal.close();
              await refresh();
            } catch (e) {
              toast(e.message);
            }
          });
      };
    });
    document.querySelectorAll("[data-date]").forEach((cell) => {
      cell.ondragover = (e) => {
        e.preventDefault();
        cell.classList.add("drag-over");
      };
      cell.ondragleave = () => cell.classList.remove("drag-over");
      cell.ondrop = async (e) => {
        e.preventDefault();
        cell.classList.remove("drag-over");
        const key = dragged || e.dataTransfer.getData("text/plain"),
          a = state.data.appointments.find((a) => a.id === key);
        if (!a) return;
        const zone =
          state.data.locations.find((l) => l.id === a.location_id)?.timezone ||
          state.data.settings[0].timezone;
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .format(new Date(a.start))
          .split(":")
          .map(Number);
        try {
          await send(
            "/appointments/" + key,
            { localDate: cell.dataset.date, minute: parts[0] * 60 + parts[1] },
            "PATCH",
          );
          await refresh();
          toast("Appointment moved");
        } catch (e) {
          toast(e.message);
        }
      };
    });
  }
  return { render, bind };
}
