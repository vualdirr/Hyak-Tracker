// E:\Hyak-Tracker\src\popup\views\viewState.js
const $ = (id) => document.getElementById(id);

let currentView = "episode"; // défaut

export function getView() {
  return currentView;
}

export function setView(next) {
  const v = String(next || "");
  currentView = v || "episode";

  $("viewMain")?.classList.toggle("hidden", currentView !== "episode");
  $("viewSettings")?.classList.toggle("hidden", currentView !== "settings");
  $("viewRoot")?.classList.toggle("hidden", currentView !== "root");
  $("viewUnsupported")?.classList.toggle(
    "hidden",
    currentView !== "unsupported",
  );

  // Banner visible partout sauf settings
  $("banner")?.classList.toggle("hidden", currentView === "settings");
}
