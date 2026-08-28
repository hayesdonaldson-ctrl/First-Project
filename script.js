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
      endDate: task.endDate || task.dueDate || "",
      urgency: typeof task.urgency === "number" ? task.urgency : 50,
      tag: TAGS.indexOf(task.tag) >= 0 ? task.tag : "",
    }));
}

let tasks = normalize(JSON.parse(localStorage.getItem("tasks") || "[]"));

const form = document.getElementById("task-form");
const input = document.getElementById("task-input");
const tagInput = document.getElementById("task-tag");
const startInput = document.getElementById("task-start");
const endInput = document.getElementById("task-end");
const list = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");

let dragFrom = null;

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

function daysBetween(a, b) {
  return Math.round((a - b) / 86400000);
}

// Describe the due-date window and whether it's overdue.
function windowLabel(start, end) {
  let range = "";
  if (start && end) range = `${fmtShort(start)} – ${fmtShort(end)}`;
  else if (end) range = `by ${fmtShort(end)}`;
  else if (start) range = `from ${fmtShort(start)}`;
  else return { text: "", overdue: false };

  const today = startOfToday();
  let status = "";
  let overdue = false;

  if (start && today < asDate(start)) {
    status = ` · starts in ${daysBetween(asDate(start), today)}d`;
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

function render() {
  list.innerHTML = "";
  emptyState.style.display = tasks.length === 0 ? "block" : "none";

  tasks.forEach((task, index) => {
    const li = document.createElement("li");
    if (task.done) li.classList.add("done");
    li.style.borderLeft = `4px solid ${urgencyColor(task.urgency)}`;

    // --- drag to reorder (only when grabbed by the handle) ---
    const handle = document.createElement("span");
    handle.className = "handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
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

    const top = document.createElement("div");
    top.className = "task-top";

    const span = document.createElement("span");
    span.className = "task-text";
    span.textContent = task.text;
    span.addEventListener("click", () => {
      tasks[index].done = !tasks[index].done;
      saveTasks();
      render();
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
    top.appendChild(span);
    top.appendChild(tagSelect);
    top.appendChild(removeBtn);

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const win = windowLabel(task.startDate, task.endDate);
    if (win.text) {
      const due = document.createElement("span");
      due.className = "due" + (win.overdue ? " overdue" : "");
      due.textContent = win.text;
      meta.appendChild(due);
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
    slider.addEventListener("change", saveTasks);

    urgencyWrap.appendChild(urgencyLabel);
    urgencyWrap.appendChild(slider);
    meta.appendChild(urgencyWrap);

    li.appendChild(top);
    li.appendChild(meta);
    list.appendChild(li);
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text === "") return;

  tasks.push({
    text,
    done: false,
    startDate: startInput.value,
    endDate: endInput.value,
    urgency: 50,
    tag: tagInput.value,
  });
  saveTasks();
  render();

  input.value = "";
  tagInput.value = "";
  startInput.value = "";
  endInput.value = "";
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
  };
}

render();
