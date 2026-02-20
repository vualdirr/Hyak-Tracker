// E:\Hyak-Tracker\src\popup\index.js
import { resolvePopupContext } from "./context.js";
import { renderByContext } from "./router.js";
import { getView } from "./views/viewState.js";
import { openHistory } from "./views/history.js";
import { initSettingsHandlers, openSettings } from "./views/settings.js";

const $ = (id) => document.getElementById(id);

function wireSettingsButtons() {
  const onOpenSettings = async () => {
    const from = getView();
    await openSettings(from);
  };

  $("btnSettings")?.addEventListener("click", onOpenSettings);
  $("btnSettingsRoot")?.addEventListener("click", onOpenSettings);
  $("btnSettingsUnsupported")?.addEventListener("click", onOpenSettings);

  const onOpenHistory = async () => {
    const from = getView();
    // stocker tabId global pour logs history
    // (resolvePopupContext le donnera déjà après, mais ici on le mettra à jour dans main)
    await openHistory(from);
  };

  $("btnHistory")?.addEventListener("click", onOpenHistory);
  $("btnHistoryRoot")?.addEventListener("click", onOpenHistory);
  $("btnHistoryUnsupported")?.addEventListener("click", onOpenHistory);
}

(async function main() {
  initSettingsHandlers();
  wireSettingsButtons();

  const pctx = await resolvePopupContext();
  window.__activeTabId = pctx.tabId || null;
  await renderByContext(pctx);
})();
