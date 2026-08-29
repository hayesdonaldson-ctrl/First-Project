// Load any tasks saved from before, or start with an empty list.
// localStorage is the offline cache and the store used when signed out;
// sync.js takes over persistence once a user signs in.
const TAGS = ["school", "health", "personal"];

// Bring any shape of saved task up to the current model.
// Earlier versions stored a single `dueDate` — treat that as the window end.
function normalize(list) {
  return (list || [])
    .filter((task) => task && typeof task.text === "string")
    .map((task) => ({
      text: task.text,
      done: !!task.done,
      startDate: task.startDate || "",
      startTime: typeof task.startTime === "string" ? task.startTime : "",
      endDate: task.endDate || task.dueDate || "",
      endTime: typeof task.endTime === "string" ? task.endTime : "",
      urgency: typeof task.urgency === "number" ? task.urgency : 50,
      tag: TAGS.indexOf(task.tag) >= 0 ? task.tag : "",
      subtasks: Array.isArray(task.subtasks)
        ? task.subtasks
            .filter((s) => s && typeof s.text === "string")
            .map((s) => ({ text: s.text, done: !!s.done }))
        : [],
    }));
}

let tasks = normalize(JSON.parse(localStorage.getItem("tasks") || "[]"));

const form = document.getElementById("task-form");
const input = document.getElementById("task-input");
const tagInput = document.getElementById("task-tag");
const startInput = document.getElementById("task-start");
const startTimeInput = document.getElementById("task-start-time");
const endInput = document.getElementById("task-end");
const endTimeInput = document.getElementById("task-end-time");
const sortSelect = document.getElementById("sort-mode");
const calToggle = document.getElementById("cal-toggle");
const list = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");

let dragFrom = null;

// After a full re-render, put the cursor back in the "add a step" box of the
// task the user was just typing into, so a sub-list can be filled in quickly.
let focusSubtaskIndex = null;

// View-only preference (per device) — the tasks array itself always stays
// in the user's manual drag order.
let sortMode = localStorage.getItem("sortMode") || "manual";
if (sortSelect) {
  sortSelect.value = sortMode;
  sortSelect.addEventListener("change", () => {
    sortMode = sortSelect.value;
    localStorage.setItem("sortMode", sortMode);
    render();
  });
}

// Show a per-task "Add to calendar" button (on by default).
let calEnabled = localStorage.getItem("calendarButtons") !== "off";
if (calToggle) {
  calToggle.checked = calEnabled;
  calToggle.addEventListener("change", () => {
    calEnabled = calToggle.checked;
    localStorage.setItem("calendarButtons", calEnabled ? "on" : "off");
    render();
  });
}

function saveTasks() {
  localStorage.setItem("tasks", JSON.stringify(tasks));
  // When signed in, sync.js registers this hook to push changes to the cloud.
  if (typeof window !== "undefined" && typeof window.__onTasksChanged === "function") {
    window.__onTasksChanged(tasks.map((t) => ({ ...t })));
  }
}

// urgency 0 -> green (almost done), 50 -> amber, 100 -> red (urgent)
function urgencyColor(value) {
  const stops = [
    [0, [34, 197, 94]],
    [50, [245, 158, 11]],
    [100, [239, 68, 68]],
  ];
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i][0] && value <= stops[i + 1][0]) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const range = upper[0] - lower[0] || 1;
  const t = (value - lower[0]) / range;
  const channel = (c) => Math.round(lower[1][c] + (upper[1][c] - lower[1][c]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function asDate(iso) {
  return new Date(iso + "T00:00:00");
}

function fmtShort(iso) {
  return asDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "14:05" -> "2:05 PM"
function fmtTime(time) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour = ((h + 11) % 12) + 1;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function fmtWhen(iso, time) {
  return fmtShort(iso) + (time ? ` ${fmtTime(time)}` : "");
}

// A Date at a given day + optional "HH:MM" (midnight when no time).
function atTime(iso, time) {
  const d = asDate(iso);
  if (time) {
    const [h, m] = time.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

function daysBetween(a, b) {
  return Math.round((a - b) / 86400000);
}

// A sortable timestamp for a task's due date (end preferred, then start).
// Tasks with no date sort to the end regardless of direction.
function dueValue(task) {
  const date = task.endDate || task.startDate;
  if (!date) return Infinity;
  const time = task.endDate ? task.endTime : task.startTime;
  return atTime(date, time).getTime();
}

// Return tasks in display order for the current sort mode. The underlying
// array is untouched, so switching back to "manual" restores the drag order.
function sortedForView() {
  if (sortMode === "manual") return tasks;
  const copy = tasks.slice();
  const cmp = {
    "urgency-desc": (a, b) => b.urgency - a.urgency,
    "urgency-asc": (a, b) => a.urgency - b.urgency,
    "due-asc": (a, b) => dueValue(a) - dueValue(b),
    "due-desc": (a, b) => {
      const av = dueValue(a);
      const bv = dueValue(b);
      if (av === Infinity && bv === Infinity) return 0;
      if (av === Infinity) return 1;
      if (bv === Infinity) return -1;
      return bv - av;
    },
    "az": (a, b) => a.text.toLowerCase().localeCompare(b.text.toLowerCase()),
  }[sortMode];
  return cmp ? copy.sort(cmp) : tasks;
}

// "90m" / "5h" / "3d" from a millisecond gap.
function humanGap(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const hrs = Math.round(ms / 3600000);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(ms / 86400000)}d`;
}

// Describe the due-date window and whether it's overdue.
// Date-only endpoints keep whole-day wording; endpoints with a time
// switch to a precise countdown.
function windowLabel(start, end, startTime, endTime) {
  let range = "";
  if (start && end) range = `${fmtWhen(start, startTime)} – ${fmtWhen(end, endTime)}`;
  else if (end) range = `by ${fmtWhen(end, endTime)}`;
  else if (start) range = `from ${fmtWhen(start, startTime)}`;
  else return { text: "", overdue: false };

  const now = new Date();
  const today = startOfToday();
  const startTimed = !!(start && startTime);
  const endTimed = !!(end && endTime);
  let status = "";
  let overdue = false;

  const beforeStart = start && (startTimed ? now < atTime(start, startTime) : today < asDate(start));

  if (beforeStart) {
    status = startTimed
      ? ` · starts in ${humanGap(atTime(start, startTime) - now)}`
      : ` · starts in ${daysBetween(asDate(start), today)}d`;
  } else if (end && endTimed) {
    const diff = atTime(end, endTime) - now;
    if (diff < 0) {
      status = ` · overdue by ${humanGap(-diff)}`;
      overdue = true;
    } else {
      status = ` · ${humanGap(diff)} left`;
    }
  } else if (end) {
    const left = daysBetween(asDate(end), today);
    if (left < 0) {
      status = ` · overdue by ${-left}d`;
      overdue = true;
    } else if (left === 0) {
      status = " · due today";
    } else {
      status = ` · ${left}d left`;
    }
  }

  return { text: range + status, overdue };
}

/* --------------------------------------------------------------------------
   Calendar export (.ics)
   -------------------------------------------------------------------------- */
function pad2(n) {
  return String(n).padStart(2, "0");
}

// Local Date -> "YYYYMMDDTHHMMSSZ" (UTC)
function icsStampUTC(date) {
  return (
    date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    "T" +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    "Z"
  );
}

function icsEscape(text) {
  return String(text).replace(/[\\;,]/g, "\\$&").replace(/\r?\n/g, "\\n");
}

// Build a VCALENDAR string for one task, with a reminder before it's due.
// Returns null when the task has no dates.
function taskToICS(task) {
  if (!task.startDate && !task.endDate) return null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//My To-Do List//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:todo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9) + "@todo.local",
    "DTSTAMP:" + icsStampUTC(new Date()),
    "SUMMARY:" + icsEscape(task.text),
  ];

  const timed = !!(task.endDate && task.endTime);

  if (task.endDate && task.endTime) {
    const end = atTime(task.endDate, task.endTime);
    const start = task.startDate
      ? atTime(task.startDate, task.startTime || "09:00")
      : new Date(end.getTime() - 30 * 60000);
    lines.push("DTSTART:" + icsStampUTC(start));
    lines.push("DTEND:" + icsStampUTC(end));
  } else {
    const day = task.endDate || task.startDate;
    const next = asDate(day);
    next.setDate(next.getDate() + 1);
    lines.push("DTSTART;VALUE=DATE:" + day.replace(/-/g, ""));
    lines.push("DTEND;VALUE=DATE:" + next.toISOString().slice(0, 10).replace(/-/g, ""));
  }

  if (task.tag) lines.push("CATEGORIES:" + icsEscape(task.tag));

  // Reminder: 1 hour before a timed due, 1 day before an all-day due.
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + icsEscape(task.text),
    "TRIGGER:" + (timed ? "-PT1H" : "-P1D"),
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  );

  return lines.join("\r\n");
}

function downloadICS(task) {
  const ics = taskToICS(task);
  if (!ics) return;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (task.text.replace(/[^\w \-]+/g, "").trim().slice(0, 40) || "task") + ".ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Play the green "done" animation on a task row, then drop the task entirely.
// Called when its checkbox is ticked (or its text is clicked while not done).
function completeTask(li, task) {
  if (li.classList.contains("completing")) return;
  task.done = true;
  li.classList.add("completing");

  const burst = document.createElement("div");
  burst.className = "complete-burst";
  burst.textContent = "✓";
  li.appendChild(burst);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const i = tasks.indexOf(task);
    if (i >= 0) tasks.splice(i, 1);
    saveTasks();
    render();
  };
  li.addEventListener("animationend", (e) => {
    if (e.target === li) finish();
  });
  setTimeout(finish, 900); // fallback if animationend never fires
}

// Same idea for a single step: flash green, slide away, then remove it.
function completeStep(subLi, task, sub) {
  if (subLi.classList.contains("completing")) return;
  sub.done = true;
  subLi.classList.add("completing");

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const arr = Array.isArray(task.subtasks) ? task.subtasks : [];
    const i = arr.indexOf(sub);
    if (i >= 0) arr.splice(i, 1);
    saveTasks();
    render();
  };
  subLi.addEventListener("animationend", (e) => {
    if (e.target === subLi) finish();
  });
  setTimeout(finish, 800);
}

function render() {
  list.innerHTML = "";
  emptyState.style.display = tasks.length === 0 ? "block" : "none";

  const draggable = sortMode === "manual";

  sortedForView().forEach((task) => {
    const index = tasks.indexOf(task);
    const li = document.createElement("li");
    if (task.done) li.classList.add("done");
    li.style.borderLeft = `4px solid ${urgencyColor(task.urgency)}`;

    // --- drag to reorder (manual sort only; grabbed by the handle) ---
    const handle = document.createElement("span");
    handle.className = "handle" + (draggable ? "" : " handle-off");
    handle.textContent = "⠿";
    handle.title = draggable ? "Drag to reorder" : "Switch Sort to “Manual” to reorder by hand";

    if (draggable) {
      handle.addEventListener("mousedown", () => { li.draggable = true; });

      li.addEventListener("dragstart", (e) => {
        dragFrom = index;
        li.classList.add("dragging");
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      li.addEventListener("dragend", () => {
        li.draggable = false;
        li.classList.remove("dragging");
        dragFrom = null;
      });
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        li.classList.add("drag-over");
      });
      li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("drag-over");
        if (dragFrom === null || dragFrom === index) return;
        const [moved] = tasks.splice(dragFrom, 1);
        tasks.splice(index, 0, moved);
        dragFrom = null;
        saveTasks();
        render();
      });
    }

    const top = document.createElement("div");
    top.className = "task-top";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-check";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", task.done ? "Mark as not done" : "Mark as done");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        completeTask(li, task);
      } else {
        tasks[index].done = false;
        saveTasks();
        render();
      }
    });

    const span = document.createElement("span");
    span.className = "task-text";
    span.textContent = task.text;
    span.addEventListener("click", () => {
      if (task.done) {
        tasks[index].done = false;
        saveTasks();
        render();
      } else {
        completeTask(li, task);
      }
    });

    // --- tag picker ---
    const tagSelect = document.createElement("select");
    tagSelect.className = "tag-select" + (task.tag ? " tag-" + task.tag : "");
    [["", "No tag"], ["school", "School"], ["health", "Health"], ["personal", "Personal"]]
      .forEach(([value, label]) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === task.tag) opt.selected = true;
        tagSelect.appendChild(opt);
      });
    tagSelect.addEventListener("change", () => {
      tasks[index].tag = tagSelect.value;
      saveTasks();
      render();
    });

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.className = "remove";
    removeBtn.addEventListener("click", () => {
      tasks.splice(index, 1);
      saveTasks();
      render();
    });

    top.appendChild(handle);
    top.appendChild(checkbox);
    top.appendChild(span);
    top.appendChild(tagSelect);
    top.appendChild(removeBtn);

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const win = windowLabel(task.startDate, task.endDate, task.startTime, task.endTime);
    if (win.text) {
      const due = document.createElement("span");
      due.className = "due" + (win.overdue ? " overdue" : "");
      due.textContent = win.text;
      meta.appendChild(due);
    }

    if (calEnabled && (task.startDate || task.endDate)) {
      const calBtn = document.createElement("button");
      calBtn.type = "button";
      calBtn.className = "cal-btn";
      calBtn.textContent = "📅 Add to calendar";
      calBtn.title = "Download a calendar event with a reminder before this is due";
      calBtn.addEventListener("click", () => downloadICS(task));
      meta.appendChild(calBtn);
    }

    const urgencyWrap = document.createElement("label");
    urgencyWrap.className = "urgency-field";

    const urgencyLabel = document.createElement("span");
    urgencyLabel.className = "urgency-label";
    urgencyLabel.textContent = "Urgency";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(task.urgency);
    slider.className = "urgency";
    slider.title = "Slide green (almost done) → red (urgent)";
    slider.addEventListener("input", () => {
      tasks[index].urgency = Number(slider.value);
      li.style.borderLeft = `4px solid ${urgencyColor(tasks[index].urgency)}`;
    });
    slider.addEventListener("change", () => {
      saveTasks();
      if (sortMode.indexOf("urgency") === 0) render();
    });

    urgencyWrap.appendChild(urgencyLabel);
    urgencyWrap.appendChild(slider);
    meta.appendChild(urgencyWrap);

    // --- sub-list: the steps that make up this to-do ---
    const subWrap = document.createElement("div");
    subWrap.className = "subtasks-wrap";

    // Completed steps animate out and are dropped, so only pending ones show.
    const allSubs = Array.isArray(task.subtasks) ? task.subtasks : [];
    const subs = allSubs.filter((s) => !s.done);

    if (subs.length) {
      const subHead = document.createElement("div");
      subHead.className = "subtasks-head";
      subHead.textContent = `Steps · ${subs.length} to go`;
      subWrap.appendChild(subHead);

      const subList = document.createElement("ul");
      subList.className = "subtasks";

      subs.forEach((sub) => {
        const subLi = document.createElement("li");

        const subCheck = document.createElement("input");
        subCheck.type = "checkbox";
        subCheck.className = "subtask-check";
        subCheck.checked = false;
        subCheck.setAttribute("aria-label", sub.text);
        subCheck.addEventListener("change", () => {
          if (subCheck.checked) completeStep(subLi, task, sub);
        });

        const subText = document.createElement("span");
        subText.className = "subtask-text";
        subText.textContent = sub.text;
        subText.addEventListener("click", () => completeStep(subLi, task, sub));

        const subRemove = document.createElement("button");
        subRemove.type = "button";
        subRemove.className = "subtask-remove";
        subRemove.textContent = "✕";
        subRemove.title = "Remove this step";
        subRemove.addEventListener("click", () => {
          const i = allSubs.indexOf(sub);
          if (i >= 0) allSubs.splice(i, 1);
          saveTasks();
          render();
        });

        subLi.appendChild(subCheck);
        subLi.appendChild(subText);
        subLi.appendChild(subRemove);
        subList.appendChild(subLi);
      });

      subWrap.appendChild(subList);
    }

    const subForm = document.createElement("form");
    subForm.className = "subtask-form";

    const subInput = document.createElement("input");
    subInput.type = "text";
    subInput.className = "subtask-input";
    subInput.placeholder = "Add a step…";
    subInput.autocomplete = "off";

    const subAdd = document.createElement("button");
    subAdd.type = "submit";
    subAdd.className = "subtask-add";
    subAdd.textContent = "Add step";

    subForm.appendChild(subInput);
    subForm.appendChild(subAdd);
    subForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = subInput.value.trim();
      if (!text) return;
      if (!Array.isArray(tasks[index].subtasks)) tasks[index].subtasks = [];
      tasks[index].subtasks.push({ text, done: false });
      focusSubtaskIndex = index;
      saveTasks();
      render();
    });

    if (focusSubtaskIndex === index) {
      setTimeout(() => subInput.focus(), 0);
    }

    subWrap.appendChild(subForm);

    li.appendChild(top);
    li.appendChild(meta);
    li.appendChild(subWrap);
    list.appendChild(li);
  });

  focusSubtaskIndex = null;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text === "") return;

  tasks.push({
    text,
    done: false,
    startDate: startInput.value,
    startTime: startInput.value ? startTimeInput.value : "",
    endDate: endInput.value,
    endTime: endInput.value ? endTimeInput.value : "",
    urgency: 50,
    tag: tagInput.value,
    subtasks: [],
  });
  saveTasks();
  render();

  input.value = "";
  tagInput.value = "";
  startInput.value = "";
  startTimeInput.value = "";
  endInput.value = "";
  endTimeInput.value = "";
  input.focus();
});

// Bridge for sync.js (loaded as a module after this script).
if (typeof window !== "undefined") {
  window.TodoApp = {
    getTasks: () => tasks.map((t) => ({ ...t })),
    // Apply a task list received from the cloud without echoing it back up.
    applyRemoteTasks: (incoming) => {
      tasks = normalize(incoming);
      localStorage.setItem("tasks", JSON.stringify(tasks));
      render();
    },
    taskToICS,
  };
}

render();
