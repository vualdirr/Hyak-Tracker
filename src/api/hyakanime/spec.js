// src/api/hyakanime/spec.js
import {
  normalizeAnimeSearch,
  normalizeProgressionDetail,
  unwrapData,
} from "./normalize.js";

/**
 * Spec d’endpoints Hyakanime — filtrée selon tes exclusions.
 * Chaque endpoint fournit: method, path, auth, normalize
 */
export const HYAK_SPEC = {
  // -------------------------
  // Public / lecture
  // -------------------------
  news_list: {
    method: "GET",
    path: "/news",
    auth: "none",
    // query: { limit?: number }
    normalize: unwrapData,
  },

  explore_anime: {
    method: "GET",
    path: "/explore/anime",
    auth: "none",
    normalize: unwrapData,
  },

  search_anime: {
    method: "GET",
    path: "/search/anime/:query",
    auth: "token", // tu l'utilises avec token actuellement
    normalize: normalizeAnimeSearch,
  },

  search_user: {
    method: "GET",
    path: "/search/user/:query",
    auth: "none",
    normalize: unwrapData,
  },

  user_get: {
    method: "GET",
    path: "/user/:username",
    auth: "none",
    normalize: unwrapData,
  },

  social_followers: {
    method: "GET",
    path: "/social/follower/:uid",
    auth: "none",
    normalize: unwrapData,
  },

  social_following: {
    method: "GET",
    path: "/social/following/:uid",
    auth: "none",
    normalize: unwrapData,
  },

  favorites_list: {
    method: "GET",
    path: "/favorite/anime/:uid",
    auth: "none",
    normalize: unwrapData,
  },

  progression_list: {
    method: "GET",
    path: "/progression/anime/:uid",
    auth: "none",
    normalize: unwrapData,
  },

  progression_detail: {
    method: "GET",
    path: "/progression/anime/:uid/:animeId",
    auth: "token",
    normalize: normalizeProgressionDetail,
  },

  progression_stats_status: {
    method: "GET",
    path: "/progression/anime/stats/status/:uid",
    auth: "none",
    normalize: unwrapData,
  },

  agenda_week: {
    method: "GET",
    path: "/agenda/week",
    auth: "none",
    normalize: unwrapData,
  },

  episode_list: {
    method: "GET",
    path: "/episode",
    auth: "none",
    // query: { animeID: number }
    normalize: unwrapData,
  },

  request_list: {
    method: "GET",
    path: "/request",
    auth: "none",
    normalize: unwrapData,
  },

  request_get: {
    method: "GET",
    path: "/request/:id",
    auth: "none",
    normalize: unwrapData,
  },

  // -------------------------
  // Actions user (token) — OK
  // -------------------------
  progression_write: {
    method: "POST",
    path: "/progression/anime/write",
    auth: "token",
    normalize: unwrapData,
  },

  progression_delete: {
    method: "DELETE",
    path: "/progression/anime/delete",
    auth: "token",
    normalize: unwrapData,
  },

  favorite_add: {
    method: "POST",
    path: "/favorite",
    auth: "token",
    normalize: unwrapData,
  },

  favorite_remove: {
    method: "DELETE",
    path: "/favorite",
    auth: "token",
    normalize: unwrapData,
  },

  edit_list: {
    method: "GET",
    path: "/edit",
    auth: "token",
    normalize: unwrapData,
  },

  edit_create: {
    method: "POST",
    path: "/edit/create",
    auth: "token",
    normalize: unwrapData,
  },

  edit_patch: {
    method: "PATCH",
    path: "/edit/:id",
    auth: "token",
    normalize: unwrapData,
  },

  request_create: {
    method: "POST",
    path: "/request",
    auth: "token",
    normalize: unwrapData,
  },

  request_patch: {
    method: "PATCH",
    path: "/request",
    auth: "token",
    normalize: unwrapData,
  },
};
