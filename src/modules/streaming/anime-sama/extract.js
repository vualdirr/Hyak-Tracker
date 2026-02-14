// src/modules/streaming/anime-sama/extract.js

import { createLogger } from "../../../core/logger.js";

const logger = createLogger({
  scope: "extract:anime-sama",
  originHost: location.hostname,
  originUrl: location.href,
});

function text(el) {
  return (el?.textContent || "").trim() || null;
}

function parseNumberFromText(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function parseEpisode(optionText) {
  return parseNumberFromText(optionText);
}

function parseSeason(seasonText) {
  return parseNumberFromText(seasonText);
}

export function extractAnimeSamaContext() {
  logger.debug("Début extraction contexte");

  const titleEl = document.querySelector("#titreOeuvre");
  const seasonEl = document.querySelector("#avOeuvre");
  const episodeOpt = document.querySelector("#selectEpisodes option:checked");

  logger.debug("Elements DOM récupérés", {
    hasTitleEl: !!titleEl,
    hasSeasonEl: !!seasonEl,
    hasEpisodeOpt: !!episodeOpt,
  });

  const title = text(titleEl);
  const seasonRaw = text(seasonEl);
  const episodeRaw = text(episodeOpt);

  logger.debug("Valeurs brutes extraites", {
    title,
    seasonRaw,
    episodeRaw,
  });

  const season = parseSeason(seasonRaw);
  const episode = parseEpisode(episodeRaw);

  logger.debug("Valeurs parsées", {
    season,
    episode,
  });

  let confidence = 0;
  if (title) confidence += 0.5;
  if (season != null) confidence += 0.25;
  if (episode != null) confidence += 0.25;

  const ctx = {
    domain: location.hostname,
    pageUrl: location.href,
    title,
    season,
    episode,
    confidence: /** @type {0|0.25|0.5|0.75|1} */ (confidence),
    hasRules: true,
  };

  logger.info("Contexte extrait", {
    title: ctx.title,
    season: ctx.season,
    episode: ctx.episode,
    confidence: ctx.confidence,
  });

  if (!ctx.title || ctx.episode == null) {
    logger.warn("Contexte partiel détecté", {
      title: ctx.title,
      episode: ctx.episode,
    });
  }

  return ctx;
}
