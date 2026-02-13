// src/shared/player/norm.js

/**
 * Normalise une string pour générer des clés stables (anime/season/episode).
 */
export function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\[\(].*?[\]\)]/g, " ")
    .replace(/(vostfr|vf|multi|hd|1080p|720p|x264|x265|web|bluray)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
