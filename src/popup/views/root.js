// E:\Hyak-Tracker\src\popup\views\root.js
import { applyDebugVisibilityFromSettings } from "./settings.js";
import { setView } from "./viewState.js";
import { setBannerBasic } from "../components/banner.js";
import { renderPopupLogs } from "./logs.js";

const $ = (id) => document.getElementById(id);

export async function renderRootView(pctx) {
  setView("root");

  setBannerBasic({
    domain: pctx.hostname || "—",
    title: "Accueil",
    subtitle: "Calendrier Hyakanime (bientôt)",
  });

  await applyDebugVisibilityFromSettings();

  const el = $("logRoot");
  await renderPopupLogs({ tabId: pctx.tabId, el });
}
