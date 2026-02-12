// src/api/hyakanime/normalize.js

export function unwrapData(raw) {
  if (raw && typeof raw === "object" && "data" in raw) return raw.data;
  return raw;
}

/**
 * Canonicalise un objet progression/anime/:uid/:animeId
 * On garde le brut dans `raw` pour debug si besoin.
 */
export function normalizeProgressionDetail(raw, { debug = false } = {}) {
  const x = unwrapData(raw) || {};

  // Réponse brute API attendue: { media, progression, isFavorite }
  const mediaRaw = x.media ?? x.anime ?? x.data?.media ?? null;
  const progRaw = x.progression ?? x.data?.progression ?? null;

  // --- Media ---
  const titleFr = mediaRaw?.title ? String(mediaRaw.title).trim() : "";
  const titleRomaji = mediaRaw?.romanji ? String(mediaRaw.romanji).trim() : "";
  const titleEn = mediaRaw?.titleEN ? String(mediaRaw.titleEN).trim() : "";
  const titleJp = mediaRaw?.titleJP ? String(mediaRaw.titleJP).trim() : "";

  const displayTitle =
    titleFr ||
    titleRomaji ||
    titleEn ||
    titleJp ||
    `Anime #${mediaRaw?.id ?? "?"}`;

  const totalEpisodes =
    mediaRaw?.NbEpisodes ??
    mediaRaw?.totalEpisodes ??
    mediaRaw?.totalEpisodesCount ??
    null;

  const posterUrl =
    mediaRaw?.image ?? mediaRaw?.poster ?? mediaRaw?.posterURL ?? null;
  const bannerUrl = mediaRaw?.bannerURL ?? mediaRaw?.banner ?? null;

  const media = mediaRaw
    ? {
        id: mediaRaw.id ?? mediaRaw.animeID ?? null,
        status: mediaRaw.status ?? null, // 1/2/3
        displayTitle,
        titles: {
          fr: titleFr || null,
          romaji: titleRomaji || null,
          en: titleEn || null,
          jp: titleJp || null,
        },
        posterUrl,
        bannerUrl,
        totalEpisodes: Number.isFinite(totalEpisodes)
          ? totalEpisodes
          : totalEpisodes != null
            ? Number(totalEpisodes)
            : null,
      }
    : null;

  // --- Progress ---
  const cur = progRaw?.progression ?? progRaw?.episode ?? null;

  const progress = progRaw
    ? {
        id: progRaw._id ?? progRaw.id ?? null,
        currentEpisode: Number.isFinite(cur)
          ? cur
          : cur != null
            ? Number(cur)
            : null,
        status: progRaw.status ?? null,
        startDate: progRaw.startDate ?? null,
        endDate: progRaw.endDate ?? null,
        lastChange: progRaw.lastChange ?? null,
      }
    : null;

  return {
    media,
    progress,
    isFavorite: x.isFavorite ?? null,
    raw: debug ? a : undefined,
  };
}

export function normalizeAnimeSearch(raw, { debug = false } = {}) {
  const list = unwrapData(raw);
  if (!Array.isArray(list)) return [];

  return list.map((a) => {
    const titleFr = a?.title ? String(a.title).trim() : "";
    const titleRomaji = a?.romanji ? String(a.romanji).trim() : "";
    const titleEn = a?.titleEN ? String(a.titleEN).trim() : "";
    const titleJp = a?.titleJP ? String(a.titleJP).trim() : "";

    const displayTitle =
      titleFr || titleRomaji || titleEn || titleJp || `Anime #${a?.id ?? "?"}`;

    return {
      id: a?.id ?? null,
      titles: {
        fr: titleFr || null,
        romaji: titleRomaji || null,
        en: titleEn || null,
        jp: titleJp || null,
      },
      displayTitle,
      poster: a?.poster ?? a?.image ?? null,
      status: a?.status ?? null,
      totalEpisodes: a?.NbEpisodes ?? a?.totalEpisodes ?? null,
      raw: debug ? a : undefined,
    };
  });
}
