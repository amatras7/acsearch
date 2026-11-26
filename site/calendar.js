const positionKey = "publication-calendar-position";
const dateLabel = new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeZone: "UTC" });
const monthLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: "UTC" });

function atUtc(year, month, day = 1) {
  return new Date(Date.UTC(year, month, day));
}

function monthStart(date) {
  return new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
}

function savedPosition() {
  try {
    const position = JSON.parse(localStorage.getItem(positionKey));
    if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) return position;
  } catch {
    // The calendar still works when browser storage is unavailable.
  }
  return null;
}

export function setupCalendar({ min, max, today, defaultDate, onChange }) {
  const byId = (id) => document.getElementById(id);
  const panel = byId("publication-calendar");
  const trigger = byId("open-calendar");
  const header = panel.querySelector(".calendar-header");
  const resizeHandle = byId("resize-calendar");
  const close = byId("close-calendar");
  const days = byId("calendar-days");
  const previous = byId("calendar-previous");
  const next = byId("calendar-next");
  const todayButton = byId("calendar-today");
  const clearButton = byId("calendar-clear");
  let month = monthStart(max);
  let selected = "";
  let position = savedPosition();

  function inRange(date) {
    return date >= min && date <= max;
  }

  function renderMonth() {
    const year = month.getUTCFullYear();
    const index = month.getUTCMonth();
    const firstWeekday = (month.getUTCDay() + 6) % 7;
    const dayCount = atUtc(year, index + 1, 0).getUTCDate();
    const currentDate = today();
    byId("calendar-month-label").textContent = monthLabel.format(month);
    previous.disabled = month <= monthStart(min);
    next.disabled = month >= monthStart(max);
    todayButton.disabled = !inRange(currentDate);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const day = i - firstWeekday + 1;
      if (day < 1 || day > dayCount) {
        const blank = document.createElement("span");
        blank.setAttribute("aria-hidden", "true");
        cells.push(blank);
        continue;
      }
      const date = atUtc(year, index, day);
      const value = date.toISOString().slice(0, 10);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.date = value;
      button.textContent = day;
      button.disabled = !inRange(value);
      button.setAttribute("aria-label", dateLabel.format(date));
      button.setAttribute("aria-pressed", String(value === (selected || defaultDate())));
      if (value === currentDate) button.setAttribute("aria-current", "date");
      cells.push(button);
    }
    days.replaceChildren(...cells);
  }

  function sync() {
    const date = selected || defaultDate();
    byId("date-value").textContent = date.replaceAll("-", "/");
    for (const button of days.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.date === date));
    }
    clearButton.disabled = !selected;
  }

  function choose(date) {
    selected = date;
    onChange(date);
    if (panel.open && !date) {
      month = monthStart(defaultDate());
      renderMonth();
    }
    sync();
  }

  function place(x, y) {
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    position = {
      x: Math.max(0, Math.min(x, width - panel.offsetWidth)),
      y: Math.max(0, Math.min(y, height - panel.offsetHeight)),
      width: panel.offsetWidth,
      height: panel.offsetHeight,
    };
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
  }

  function resize(width, height) {
    const availableWidth = document.documentElement.clientWidth - position.x;
    const availableHeight = window.innerHeight - position.y;
    panel.style.width = `${Math.max(Math.min(240, availableWidth), Math.min(width, availableWidth))}px`;
    panel.style.height = `${Math.max(Math.min(288, availableHeight), Math.min(height, availableHeight))}px`;
    place(position.x, position.y);
  }

  function trackPointer(handle, onMove) {
    let drag;
    handle.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || (handle === header && event.target.closest("button"))) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      onMove(drag.start, event.clientX - drag.x, event.clientY - drag.y);
    });
    handle.addEventListener("lostpointercapture", () => {
      drag = null;
      handle.classList.remove("dragging");
    });
  }

  trigger.disabled = false;
  trigger.addEventListener("click", () => {
    if (panel.open) {
      close.focus();
      return;
    }
    month = monthStart(selected || defaultDate());
    renderMonth();
    clearButton.disabled = !selected;
    const anchor = trigger.getBoundingClientRect();
    if (Number.isFinite(position?.width) && Number.isFinite(position?.height)) {
      panel.style.width = `${position.width}px`;
      panel.style.height = `${position.height}px`;
    }
    panel.show();
    place(position?.x ?? anchor.left, position?.y ?? anchor.bottom + 6);
    trigger.setAttribute("aria-expanded", "true");
    (days.querySelector('[aria-pressed="true"]') ?? days.querySelector("button:enabled") ?? close).focus();
  });
  close.addEventListener("click", () => panel.close());
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      panel.close();
    }
  });
  panel.addEventListener("close", () => {
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
    try {
      localStorage.setItem(positionKey, JSON.stringify(position));
    } catch {
      // The in-memory position can still be reused while this page stays open.
    }
  });
  days.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-date]");
    if (button && !button.disabled) choose(button.dataset.date);
  });
  previous.addEventListener("click", () => {
    month = atUtc(month.getUTCFullYear(), month.getUTCMonth() - 1);
    renderMonth();
  });
  next.addEventListener("click", () => {
    month = atUtc(month.getUTCFullYear(), month.getUTCMonth() + 1);
    renderMonth();
  });
  todayButton.addEventListener("click", () => {
    const date = today();
    if (!inRange(date)) return;
    month = monthStart(date);
    renderMonth();
    choose(date);
  });
  clearButton.addEventListener("click", () => {
    choose("");
    (days.querySelector("button:enabled") ?? close).focus();
  });

  trackPointer(header, (start, dx, dy) => place(start.x + dx, start.y + dy));
  trackPointer(resizeHandle, (start, dx, dy) => resize(start.width + dx, start.height + dy));
  resizeHandle.addEventListener("keydown", (event) => {
    const offsets = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
    const delta = offsets[event.key];
    if (!delta) return;
    event.preventDefault();
    resize(position.width + delta[0], position.height + delta[1]);
  });
  window.addEventListener("resize", () => {
    if (panel.open) place(position.x, position.y);
  });

  return { clear: () => choose(""), sync };
}
