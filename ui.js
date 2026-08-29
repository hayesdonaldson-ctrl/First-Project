// Settings drawer + theme switching. (Task logic lives in script.js.)
(function () {
  const root = document.documentElement;
  const toggle = document.getElementById("menu-toggle");
  const panel = document.getElementById("settings-panel");
  const backdrop = document.getElementById("settings-backdrop");
  const closeBtn = document.getElementById("settings-close");
  const seg = document.getElementById("theme-seg");
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');

  // Colour that the browser chrome / iOS status bar picks up per theme.
  const THEME_COLOR = { light: "#efe9fb", dark: "#141019", glass: "#7d5bd6" };

  function currentTheme() {
    return root.getAttribute("data-theme") || "light";
  }

  function reflectTheme() {
    const t = currentTheme();
    seg.querySelectorAll("button[data-theme-value]").forEach((b) => {
      const on = b.dataset.themeValue === t;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (themeColorMeta) themeColorMeta.setAttribute("content", THEME_COLOR[t] || "#6d5bff");
  }

  function setTheme(t) {
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch (e) {}
    reflectTheme();
  }

  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-theme-value]");
    if (b) setTheme(b.dataset.themeValue);
  });
  reflectTheme();

  // --- drawer open / close ---
  let open = false;

  function setOpen(next) {
    open = next;
    panel.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
    if (open) {
      const first = panel.querySelector("button, select");
      if (first) first.focus();
    } else {
      toggle.focus();
    }
  }

  toggle.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) setOpen(false);
  });
})();
