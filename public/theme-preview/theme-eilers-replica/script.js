// Eilers Theme — Minimal Interactivity

document.addEventListener("DOMContentLoaded", () => {
  // Mobile Nav Toggle
  const burger = document.getElementById("burger");
  const navLinks = document.getElementById("nav-links");
  if (burger && navLinks) {
    burger.addEventListener("click", () => navLinks.classList.toggle("is-open"));
    navLinks.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => navLinks.classList.remove("is-open")),
    );
  }

  // Footer year
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Services list: aktive Zeile per Klick wechseln
  const rows = document.querySelectorAll(".service-row");
  rows.forEach((row) => {
    row.addEventListener("click", () => {
      rows.forEach((r) => r.classList.remove("active"));
      row.classList.add("active");
    });
  });
});
