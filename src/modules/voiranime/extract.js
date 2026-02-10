// src/modules/voiranime/extract.js

function text(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim() || null;
}

/**
 * Parse breadcrumb text from voiranime v6.
 *
 * Examples:
 * - "Noble Reincarnation Born Blessed So I'll Obtain Ultimate Power - 05 VOSTFR - 05"
 *   -> title: "...Ultimate Power", season: null, episode: 5
 * - "Jigokuraku 2 - 04 VOSTFR - 04"
 *   -> title: "Jigokuraku", season: 2, episode: 4
 */
export function parseVoiranimeBreadcrumb(raw) {
  const s = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { title: null, season: null, episode: null };

  // Tail format: " - 04 VOSTFR - 04" or " - 02 VF - 02"
  const tailRe = /\s*-\s*(\d{1,3})\s*(?:VOSTFR|VF|MULTI)?\s*-\s*\d{1,3}\s*$/i;

  const m = s.match(tailRe);

  // Episode (prefer the one before VOSTFR/VF)
  let episode = null;
  if (m) episode = parseInt(m[1], 10);
  if (!Number.isFinite(episode)) episode = null;

  // Head: remove tail if present
  let head = m ? s.replace(tailRe, "").trim() : s;

  // Season: if head ends with " <number>" (ex: "Jigokuraku 2")
  let season = null;
  const sm = head.match(/^(.*\S)\s+(\d{1,2})$/);
  if (sm) {
    const maybeSeason = parseInt(sm[2], 10);
    // heuristique: saison 2..30 (évite de manger un "86" ou un titre numéroté étrange)
    if (Number.isFinite(maybeSeason) && maybeSeason >= 2 && maybeSeason <= 30) {
      season = maybeSeason;
      head = sm[1].trim();
    }
  }

  const title = head || null;

  return { title, season, episode };
}

export function extractVoiranimeContext() {
  // Sélecteur robuste (moins fragile que toute la chaîne de div)
  const li = document.querySelector(
    "#manga-reading-nav-head .c-breadcrumb li.active",
  );

  const raw = text(li);
  const { title, season, episode } = parseVoiranimeBreadcrumb(raw);

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
    hasRules: true,
  };

  return ctx;
}
