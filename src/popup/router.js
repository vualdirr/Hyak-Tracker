import { renderEpisodeView } from "./views/episode.js";
import { renderRootView } from "./views/root.js";
import { renderUnsupportedView } from "./views/unsupported.js";

export async function renderByContext(pctx) {
  // Non supporté (host)
  if (!pctx.supported) {
    return renderUnsupportedView(pctx);
  }

  // Racine streaming => calendrier (plus tard)
  if (pctx.isRoot) {
    return renderRootView(pctx);
  }

  // Page “épisode” : si on a un streamCtx exploitable
  if (pctx.streamCtx?.title) {
    return renderEpisodeView(pctx);
  }

  // Fallback: host supporté mais pas de contexte (ou extraction vide) => root
  return renderRootView(pctx);
}
