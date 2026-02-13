import { applyDebugVisibilityFromSettings } from "./settings.js";
import { setView } from "./viewState.js";
import { setBannerBasic } from "../components/banner.js";

const $ = (id) => document.getElementById(id);

export async function renderRootView(pctx) {
  setView("root");

  // Banner minimal
  setBannerBasic({
    domain: pctx.hostname || "—",
    title: "Accueil",
    subtitle: "Calendrier Hyakanime (bientôt)",
  });

  await applyDebugVisibilityFromSettings();

  // Logs root (debug)
  const el = $("logRoot");
  if (el) el.textContent = `Root view\nurl=${pctx.url}\n`;
}
