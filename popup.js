const $ = (id) => document.getElementById(id);
const API_V5 = "https://api-v5.hyakanime.fr";

let selectedAnimeId = null;
let currentDomain = null;
let pageCtx = null;

let hykToken = null;
let hykUid = null;

let selectedAnimeMedia = null; // media issu de /progression/anime/:uid/:id
let selectedAnimeProgressionRow = null; // progression serveur complète (startDate/endDate/lastChange/status...)
let knownProgression = null; // progression actuelle côté serveur (number | null)
let knownTotalEpisodes = null; // NbEpisodes (number | null)

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const { lastDetected } = await chrome.storage.local.get("lastDetected");
    if (lastDetected) {
      // Met à jour l'état "page" du popup
      pageCtx = lastDetected;
      currentDomain = lastDetected.domain || currentDomain;

      renderBanner({
        media: selectedAnimeMedia, // peut être null au début
        titleFallback: lastDetected.title || "—",
        episode: lastDetected.episode || "",
        season: lastDetected.season || "",
        currentProgression: knownProgression,
        totalEpisodes: knownTotalEpisodes,
      });

      if (lastDetected.title) $("title").value = lastDetected.title;
      if (lastDetected.episode) $("episode").value = lastDetected.episode;

      updateWriteButtonState();
      log("ℹ️ Dernière détection chargée (cache).");
    }
  } catch (e) {
    // silencieux
  }

  // Token Hyakanime
  const t = await chrome.runtime.sendMessage({ type: "GET_TOKEN" });
  if (!t?.token) {
    log(
      "⚠️ Pas de token Hyakanime. Ouvre Hyakanime (connecté) dans un onglet puis réessaie.",
    );
  } else {
    hykToken = t.token;
    const payload = safeDecodeJwtPayload(hykToken);
    hykUid = payload?.uid || payload?._id || payload?.sub || null;

    if (!hykUid) {
      log(
        "⚠️ Token détecté mais uid introuvable dans le payload (attendu: uid/_id/sub).",
      );
    } else {
      log("✅ Token Hyakanime détecté (uid OK).");
    }
  }

  // Re-évaluer le verrouillage si l'utilisateur modifie l'épisode à la main
  $("episode")?.addEventListener("input", () => {
    updateWriteButtonState();
    renderBanner({
      media: selectedAnimeMedia,
      titleFallback: ($("title")?.value || "").trim() || "—",
      episode: ($("episode")?.value || "").trim(),
      season: pageCtx?.season || "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });
  });

  // Bouton recherche (fallback manuel)
  $("btnSearch")?.addEventListener("click", async () => {
    await runHyakanimeSearch({ manual: true });
  });

  // Bouton write
  $("btnWrite")?.addEventListener("click", async () => {
    const ep = parseInt($("episode")?.value || "", 10);
    if (!selectedAnimeId || !Number.isFinite(ep)) {
      return log("Il faut un animeId + un numéro d’épisode.");
    }

    // 🔒 Anti-downgrade + évite requête inutile si déjà vu
    if (Number.isFinite(knownProgression) && knownProgression >= ep) {
      updateWriteButtonState();
      return log(
        `🔒 Déjà vu: ta progression Hyakanime est à l'épisode ${knownProgression}. (Aucune action nécessaire)`,
      );
    }

    const nowISO = new Date().toISOString();

    const total = Number.isFinite(knownTotalEpisodes)
      ? knownTotalEpisodes
      : Number.isFinite(selectedAnimeMedia?.NbEpisodes)
        ? selectedAnimeMedia.NbEpisodes
        : null;

    // statut diffusion animé: 1=en cours, 2=prochainement, 3=terminé
    const isAnimeFinished = selectedAnimeMedia?.status === 3;

    // On repart de la progression serveur complète (si on l'a), pour éviter d'écraser des champs.
    const base = selectedAnimeProgressionRow
      ? { ...selectedAnimeProgressionRow }
      : {};

    // Payload minimal + champs utiles serveur
    const payload = {
      id: selectedAnimeId,
      animeID: selectedAnimeId,
      progression: ep,
      status: 1,

      // On forward start/end/lastChange si déjà connus
      ...(base.lastChange != null ? { lastChange: base.lastChange } : {}),
      ...(base.startDate != null ? { startDate: base.startDate } : {}),
      ...(base.endDate != null ? { endDate: base.endDate } : {}),
    };

    // startDate: uniquement quand on marque vu l'épisode 1
    if (ep === 1 && !payload.startDate) {
      payload.startDate = nowISO;
    }

    // endDate: uniquement si dernier épisode ET animé terminé (pas en diffusion)
    if (
      total != null &&
      total > 0 &&
      ep === total &&
      isAnimeFinished &&
      !payload.endDate
    ) {
      if (!payload.startDate && base.startDate) {
        payload.startDate = base.startDate;
      }
      payload.endDate = nowISO;

      // ✅ Marquer la progression comme "terminé"
      payload.status = 3;
    }

    log("Envoi progression:\n" + JSON.stringify(payload, null, 2));

    const res = await chrome.runtime.sendMessage({
      type: "WRITE_PROGRESSION",
      ...payload,
    });

    if (!res?.ok) {
      return log(
        `Erreur write (${res?.status || "?"}): ${JSON.stringify(res?.data)}`,
      );
    }

    log("✅ Progression mise à jour.");

    // Met à jour notre état local + UI (sans attendre une refetch)
    if (!Number.isFinite(knownProgression) || ep > knownProgression) {
      knownProgression = ep;
    }
    updateWriteButtonState();
    renderBanner({
      media: selectedAnimeMedia,
      titleFallback: ($("title")?.value || "").trim() || "—",
      episode: ($("episode")?.value || "").trim(),
      season: pageCtx?.season || "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });
  });

  const { lastDetected } = await chrome.storage.local.get("lastDetected");
  pageCtx = lastDetected || null;

  if (!pageCtx) {
    showSearchButton(true);
    return log(
      "ℹ️ Ouvre une page supportée (anime-sama) pour détecter titre/épisode.",
    );
  }

  renderBanner({
    media: null,
    titleFallback: pageCtx.title || "—",
    episode: pageCtx.episode || "",
    season: pageCtx.season || "",
    currentProgression: null,
    totalEpisodes: null,
  });

  if (pageCtx.title) $("title").value = pageCtx.title;
  if (pageCtx.episode) $("episode").value = pageCtx.episode;

  // Si titre absent => mode manuel
  if (!hasTitle()) {
    showSearchButton(true);
    log("ℹ️ Titre manquant. Ce site n’est pas encore supporté.");
    return;
  }

  // Si épisode absent => on peut chercher mais pas écrire
  if (!hasEpisode()) {
    $("btnWrite").disabled = true;
    showSearchButton(true);
    log("ℹ️ Épisode non détecté sur ce site.");
    // on ne return pas: on peut quand même lancer la recherche auto
  }

  // Auto-search (si titre OK)
  await runHyakanimeSearch({ manual: false });
})();

// ---------- JWT helpers ----------

function safeDecodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;

    // base64url -> base64
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );

    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---------- UI / State ----------
function hasTitle() {
  return !!($("title")?.value || "").trim();
}

function hasEpisode() {
  return !!($("episode")?.value || "").trim();
}

function showSearchButton(show) {
  $("btnSearch")?.classList.toggle("hidden", !show);
}

function updateWriteButtonState() {
  const ep = parseInt($("episode")?.value || "", 10);
  const btn = $("btnWrite");

  // état par défaut
  let disabled = !selectedAnimeId || !hasEpisode();
  let label = "Marquer “vu”";
  let title = "";

  // 🔒 Déjà vu ou downgrade → bouton désactivé
  if (
    !disabled &&
    Number.isFinite(ep) &&
    Number.isFinite(knownProgression) &&
    knownProgression >= ep
  ) {
    disabled = true;
    label = "Déjà vu";
    title = `Progression Hyakanime : épisode ${knownProgression}`;
  }

  btn.disabled = disabled;
  btn.textContent = label;
  btn.title = title;
}

function buildSearchQueries(title, seasonHint) {
  const q = String(title || "").trim();
  const n = parseInt(seasonHint, 10);

  // Saison 1 / inconnue → recherche simple
  if (!Number.isFinite(n) || n <= 1) return [q];

  // Saison > 1 → templates progressifs
  return [`${q} saison ${n}`, `${q} season ${n}`, `${q} s${n}`, q];
}

async function runHyakanimeSearch({ manual }) {
  selectedAnimeId = null;
  selectedAnimeMedia = null;
  knownProgression = null;
  knownTotalEpisodes = null;

  updateWriteButtonState();
  clearChoices();

  const title = ($("title")?.value || "").trim();
  if (!title) {
    showSearchButton(true);
    return log("Entre un titre valide pour rechercher l’animé.");
  }

  // Hint saison interne (jamais affiché en champ UI)
  const seasonHint = pageCtx?.season ? parseInt(pageCtx.season, 10) : null;
  const queries = buildSearchQueries(title, seasonHint);

  log(
    `Recherche Hyakanime${Number.isFinite(seasonHint) ? ` (hint saison=${seasonHint})` : ""}: ${queries.join(" | ")} …`,
  );

  let allItems = [];
  const seen = new Set();

  for (const q of queries) {
    const res = await chrome.runtime.sendMessage({
      type: "SEARCH_ANIME",
      query: q,
    });

    if (!res?.ok) continue;

    const items = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.data)
        ? res.data.data
        : Array.isArray(res.data?.results)
          ? res.data.results
          : [];

    for (const it of items) {
      const id = it?.id;
      if (id == null) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      allItems.push(it);
    }
  }

  if (!allItems.length) {
    showSearchButton(true);
    return log("Aucun résultat Hyakanime. Modifie le titre puis relance.");
  }

  let ranked = rank(allItems, title).slice(0, 6);
  if (!ranked.length) {
    showSearchButton(true);
    return log("Aucun résultat exploitable (ranking vide).");
  }

  if (Number.isFinite(seasonHint) && seasonHint > 1) {
    const sTok = String(seasonHint);

    ranked.sort((a, b) => {
      const aHas =
        norm(a.matchedOn || "").includes(`saison ${sTok}`) ||
        norm(a.matchedOn || "").includes(`season ${sTok}`) ||
        norm(a.matchedOn || "").includes(`s${sTok}`);
      const bHas =
        norm(b.matchedOn || "").includes(`saison ${sTok}`) ||
        norm(b.matchedOn || "").includes(`season ${sTok}`) ||
        norm(b.matchedOn || "").includes(`s${sTok}`);

      if (aHas !== bHas) return aHas ? -1 : 1;
      return b.score - a.score;
    });
  }

  // Si on a un hint de saison > 1, on évite le "root exact"
  if (Number.isFinite(seasonHint) && seasonHint > 1) {
    const rootNorm = norm(title);
    const filtered = ranked.filter((r) => norm(r.matchedOn || "") !== rootNorm);
    if (filtered.length) ranked = filtered;
  }

  if (ranked[0]?.perfect) {
    await selectAnime(ranked[0].it);
    showSearchButton(false);
    clearChoices();
    log(`✅ Match parfait sur: ${ranked[0].matchedOn}`);
    return;
  }

  // Si auto et score faible, on montre le bouton + choix
  if (!manual && ranked[0].score < 0.72) {
    showSearchButton(true);
    renderChoices(ranked);
    log(
      `Debug match: best on "${ranked[0].matchedOn}" score=${(ranked[0].score * 100).toFixed(0)}%`,
    );
    log(
      `⚠️ Match incertain (${(ranked[0].score * 100).toFixed(0)}%). Choisis un résultat ou ajuste le titre.`,
    );
    return;
  }

  // Sinon on auto-select le top
  await selectAnime(ranked[0].it);
  showSearchButton(false);

  // Laisse quand même les alternatives visibles
  renderChoices(ranked);
}

// ---------- Ranking (inchangé) ----------

function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\[\(].*?[\]\)]/g, " ")
    .replace(/(vostfr|vf|multi|hd|1080p|720p|x264|x265|web|bluray)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getAllTitles(anime) {
  const arr = [];
  if (anime.title) arr.push(anime.title);
  if (anime.titleEN) arr.push(anime.titleEN);
  if (anime.titleJP) arr.push(anime.titleJP);
  if (anime.romanji) arr.push(anime.romanji);
  if (Array.isArray(anime.alt)) arr.push(...anime.alt);
  return arr.filter(Boolean);
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  const jacc = union ? inter / union : 0;

  let i = 0;
  for (; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) break;
  const prefix = i / Math.max(a.length, b.length);

  return Math.max(jacc, prefix * 0.85);
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function editSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const d = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen ? 1 - d / maxLen : 0;
}

function rank(items, query) {
  const q = norm(query);

  const ranked = items.map((it) => {
    const titles = getAllTitles(it)
      .map((raw) => ({ raw, n: norm(raw) }))
      .filter((x) => x.n);

    // 1) Perfect match exact
    for (const t of titles) {
      if (t.n === q) {
        return { it, score: 1.0, matchedOn: t.raw, perfect: true };
      }
    }

    // 2) Sinon: meilleur score
    let best = 0;
    let matchedOn = null;

    for (const t of titles) {
      if (t.n.includes(q) || q.includes(t.n)) {
        if (0.95 > best) {
          best = 0.95;
          matchedOn = t.raw;
        }
        continue;
      }

      const s1 = similarity(q, t.n);
      const s2 = editSimilarity(q, t.n);
      const s = Math.max(s1, s2);

      if (s > best) {
        best = s;
        matchedOn = t.raw;
      }
    }

    const quasiPerfect = best >= 0.92;
    return { it, score: best, matchedOn, perfect: quasiPerfect };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

// ---------- UI helpers ----------

function clearChoices() {
  $("choices").innerHTML = "";
}

function renderChoices(ranked) {
  clearChoices();
  ranked.forEach(({ it, score }) => {
    const btn = document.createElement("button");
    btn.className = "choiceBtn";
    const display =
      it.title || it.titleEN || it.romanji || it.titleJP || "(sans titre)";
    btn.textContent = `Choisir ${(score * 100).toFixed(0)}% — ${display.slice(0, 36)}`;
    btn.addEventListener("click", () => selectAnime(it));
    $("choices").appendChild(btn);
  });
}

async function selectAnime(anime) {
  selectedAnimeId = anime?.id ?? null;
  selectedAnimeMedia = null;
  knownProgression = null;
  knownTotalEpisodes = null;

  updateWriteButtonState();

  // Render immédiat (fallback texte)
  renderBanner({
    media: null,
    titleFallback:
      (
        anime?.title ||
        anime?.titleEN ||
        anime?.romanji ||
        anime?.titleJP ||
        $("title")?.value ||
        ""
      ).trim() || "—",
    episode: ($("episode")?.value || "").trim(),
    season: pageCtx?.season || "",
    currentProgression: null,
    totalEpisodes: null,
  });

  log(`✅ Sélectionné: id=${selectedAnimeId}`);

  if (!selectedAnimeId) return;

  // ✅ Nouvelle source de vérité: progression/anime/:uid/:id
  if (!hykToken || !hykUid) {
    log("ℹ️ Détails progression non chargés: token/uid manquant.");
    return;
  }

  try {
    const data = await fetchProgressionAnime(hykUid, selectedAnimeId, hykToken);

    // data: { media, progression, isFavorite }
    selectedAnimeMedia = data?.media || null;
    selectedAnimeProgressionRow = data?.progression || null;
    knownProgression = Number.isFinite(data?.progression?.progression)
      ? data.progression.progression
      : null;
    knownTotalEpisodes = Number.isFinite(selectedAnimeMedia?.NbEpisodes)
      ? selectedAnimeMedia.NbEpisodes
      : null;

    renderBanner({
      media: selectedAnimeMedia,
      titleFallback: ($("title")?.value || "").trim() || "—",
      episode: ($("episode")?.value || "").trim(),
      season: pageCtx?.season || "",
      currentProgression: knownProgression,
      totalEpisodes: knownTotalEpisodes,
    });

    updateWriteButtonState();

    const t = getDisplayTitleMedia(selectedAnimeMedia);
    log(`🎴 Media+progression chargés: ${t}`);
    if (Number.isFinite(knownProgression)) {
      log(`📊 Progression Hyakanime: ${knownProgression}`);
    }
    if (Number.isFinite(knownTotalEpisodes)) {
      log(`📺 Total épisodes: ${knownTotalEpisodes}`);
    }
  } catch (e) {
    log(
      `⚠️ Impossible de charger /progression/anime/${hykUid}/${selectedAnimeId}: ${String(
        e?.message || e,
      )}`,
    );
  }
}

function log(s) {
  $("log").textContent = (s + "\n\n" + $("log").textContent).slice(0, 4000);
}

// ---------- API ----------

const progCache = new Map(); // key `${uid}:${animeId}` -> data

async function fetchProgressionAnime(uid, animeId, token) {
  const key = `${uid}:${animeId}`;
  if (progCache.has(key)) return progCache.get(key);

  const res = await fetch(`${API_V5}/progression/anime/${uid}/${animeId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(
      `GET /progression/anime/${uid}/${animeId} failed: ${res.status}`,
    );
  }

  const data = await res.json();
  progCache.set(key, data);
  return data;
}

// ---------- Banner rendering ----------

function getDisplayTitleMedia(m) {
  const t = (m?.title || "").trim();
  if (t) return t;

  return (
    (m?.titleEN || "").trim() ||
    (m?.romanji || "").trim() ||
    (m?.titleJP || "").trim() ||
    "—"
  );
}

function getAnimeDiffusionStatus(media) {
  // status diffusion de l'anime (vu dans /anime/:id)
  // 1 = en cours, 2 = prochainement, 3 = terminé
  const s = media?.status;

  if (s === 1) return { label: "En cours", cls: "pill--blue" };
  if (s === 2) return { label: "Prochainement", cls: "pill--yellow" };
  if (s === 3) return { label: "Terminé", cls: "pill--green" };

  return { label: "Inconnu", cls: "pill--muted" };
}

function setPill(el, { label, cls }) {
  if (!el) return;
  el.textContent = label;

  // reset classes
  el.classList.remove(
    "pill--blue",
    "pill--yellow",
    "pill--green",
    "pill--muted",
  );
  el.classList.add("pill", cls);
  el.classList.toggle("hidden", !label);
}

function renderBanner({
  media,
  titleFallback,
  episode,
  season,
  currentProgression,
  totalEpisodes,
} = {}) {
  const bannerTitleEl = $("bannerTitle");
  const bannerSubEl = $("bannerSub");
  const animeStatusEl = $("animeStatusPill");
  const bannerBgEl = $("bannerBg");
  const posterEl = $("poster");
  const pageDomainEl = $("pageDomain");

  if (pageDomainEl) pageDomainEl.textContent = currentDomain || "—";

  if (media) {
    setPill(animeStatusEl, getAnimeDiffusionStatus(media));
  } else if (animeStatusEl) {
    animeStatusEl.classList.add("hidden");
  }

  const title = media ? getDisplayTitleMedia(media) : titleFallback || "—";
  bannerTitleEl.textContent = title;

  const parts = [];

  if (season) parts.push(`Saison ${season}`);
  if (episode) parts.push(`Épisode ${episode}`);

  // Affichage progression/total si dispo
  const p = Number.isFinite(currentProgression) ? currentProgression : null;
  const tEp = Number.isFinite(totalEpisodes) ? totalEpisodes : null;

  if (p != null && tEp != null && tEp > 0) {
    parts.push(`Progression ${p}/${tEp}`);
  } else if (p != null) {
    parts.push(`Progression ${p}`);
  } else if (tEp != null && tEp > 0) {
    parts.push(`${tEp} épisodes`);
  }

  bannerSubEl.textContent = parts.length
    ? parts.join(" • ")
    : "Sélectionne un animé…";

  // ✅ bannerURL prioritaire, fallback image
  const bannerImg = media?.bannerURL || media?.image || "";
  const posterImg = media?.image || "";

  bannerBgEl.style.backgroundImage = bannerImg ? `url("${bannerImg}")` : "";
  posterEl.src = posterImg || "";
  posterEl.style.display = posterImg ? "block" : "none";
}
