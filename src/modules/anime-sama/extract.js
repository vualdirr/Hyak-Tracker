// src/modules/anime-sama/extract.js

function text(el) {
  return (el?.textContent || "").trim() || null;
}

function parseNumberFromText(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseEpisode(optionText) {
  // ex: "Episode 5" / "Épisode 5" / "EP 5"
  return parseNumberFromText(optionText);
}

function parseSeason(seasonText) {
  // ex: "Saison 1"
  return parseNumberFromText(seasonText);
}

export function extractAnimeSamaContext() {
  const titleEl = document.querySelector("#titreOeuvre");
  const seasonEl = document.querySelector("#avOeuvre");
  const episodeOpt = document.querySelector("#selectEpisodes option:checked");

  const title = text(titleEl);
  const seasonRaw = text(seasonEl);
  const episodeRaw = text(episodeOpt);

  const season = parseSeason(seasonRaw);
  const episode = parseEpisode(episodeRaw);

  // Confidence: basé sur ce qu'on a réussi à lire
  let confidence = 0;
  if (title) confidence += 0.5;
  if (season != null) confidence += 0.25;
  if (episode != null) confidence += 0.25;

  /** @type {any} */
  const ctx = {
    domain: location.hostname,
    pageUrl: location.href,
    title,
    season,
    episode,
    confidence: /** @type {0|0.25|0.5|0.75|1} */ (confidence),
    hasRules: true, // pour que le popup ne dise pas "pas de règles"
  };

  return ctx;
}
