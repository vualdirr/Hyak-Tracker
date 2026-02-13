// E:\Hyak-Tracker\src\popup\index.js
import { resolvePopupContext } from "./context.js";
import { renderByContext } from "./router.js";
import { getView } from "./views/viewState.js";
import { initSettingsHandlers, openSettings } from "./views/settings.js";

const $ = (id) => document.getElementById(id);

function wireSettingsButtons() {
  const onOpen = async () => {
    const from = getView();
    await openSettings(from);
  };

  $("btnSettings")?.addEventListener("click", onOpen);
  $("btnSettingsRoot")?.addEventListener("click", onOpen);
  $("btnSettingsUnsupported")?.addEventListener("click", onOpen);
}

(async function main() {
  initSettingsHandlers();
  wireSettingsButtons();

  const pctx = await resolvePopupContext();
  await renderByContext(pctx);
})();
