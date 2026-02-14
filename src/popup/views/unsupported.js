// E:\Hyak-Tracker\src\popup\views\unsupported.js
import { applyDebugVisibilityFromSettings } from "./settings.js";
import { setView } from "./viewState.js";
import { setBannerBasic } from "../components/banner.js";
import { renderPopupLogs } from "./logs.js";

const $ = (id) => document.getElementById(id);

export async function renderUnsupportedView(pctx) {
  setView("unsupported");

  setBannerBasic({
    domain: pctx.hostname || "—",
    title: "Site non supporté",
    subtitle: "",
  });

  const msg = $("unsupportedMessage");
  if (msg) {
    msg.innerHTML = `
      <div><strong>Proposer un site</strong></div>
      <div style="margin-top:6px;">
        Rejoins le serveur Discord Hyakanime et mentionne <strong>@VualDirr</strong> pour proposer un site à ajouter.
      </div>
      <div style="margin-top:6px;">
        Note : l’équipe Hyakanime n’est pas créatrice de l’extension.
      </div>
      <div style="margin-top:6px;">
        <a href="https://discord.gg/EnS4xgX5kU" target="_blank" rel="noreferrer">https://discord.gg/EnS4xgX5kU</a>
      </div>
    `;
  }

  await applyDebugVisibilityFromSettings();

  const el = $("logUnsupported");
  await renderPopupLogs({ tabId: pctx.tabId, el });
}
