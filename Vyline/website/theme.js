// Runs before the stylesheet so a saved choice applies on the first paint.
(() => {
  const root = document.documentElement;
  root.classList.add("js");
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const key = "vyline-docs-theme";
  let choice = "system";
  try {
    const saved = localStorage.getItem(key);
    if (saved === "light" || saved === "dark") choice = saved;
  } catch {
    // Private or restricted storage must not prevent theme switching.
  }
  const apply = () => {
    const theme = choice === "system" ? (system.matches ? "dark" : "light") : choice;
    root.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#172126" : "#ffffff");
    const select = document.querySelector("[data-theme-select]");
    if (select) select.value = choice;
  };
  apply();
  system.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    choice = event.newValue === "light" || event.newValue === "dark" ? event.newValue : "system";
    apply();
  });
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.querySelector("[data-theme-select]")?.addEventListener("change", (event) => {
      choice = event.target.value;
      try {
        if (choice === "system") localStorage.removeItem(key);
        else localStorage.setItem(key, choice);
      } catch {
        // The current page still follows the choice when storage is unavailable.
      }
      apply();
    });
  });
})();
