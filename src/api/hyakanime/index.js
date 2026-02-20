// E:\Hyak-Tracker\src\api\hyakanime\index.js
import { createHyakanimeClient } from "./client.js";

export function createHyakApi({
  getToken,
  baseUrl = "https://api-v5.hyakanime.fr",
}) {
  const client = createHyakanimeClient({ baseUrl, getToken });

  return {
    news: {
      list: ({ limit = 12 } = {}) =>
        client.requestByKey("news_list", { query: { limit } }),
    },

    search: {
      anime: (query) =>
        client.requestByKey("search_anime", { params: { query } }),
      user: (query) =>
        client.requestByKey("search_user", { params: { query } }),
    },

    progression: {
      listByUid: (uid) =>
        client.requestByKey("progression_list", { params: { uid } }),

      detail: ({ uid, animeId }) =>
        client.requestByKey("progression_detail", { params: { uid, animeId } }),

      /**
       * writeSafe = anti-downgrade global
       */
      writeSafe: async ({ uid, animeId, episode, status = 1, extra = {} }) => {
        const current = await client.requestByKey("progression_detail", {
          params: { uid, animeId },
        });
        if (!current.ok) return current;

        const known = current.data?.progress?.currentEpisode ?? null;
        if (Number.isFinite(known) && known >= episode) {
          return {
            ok: true,
            data: {
              skipped: true,
              reason: "ALREADY_UP_TO_DATE",
              known,
              wanted: episode,
            },
          };
        }

        return client.requestByKey("progression_write", {
          __allowUnsafe: true,
          body: {
            id: animeId,
            animeID: animeId,
            progression: episode,
            status,
            ...extra,
          },
        });
      },

      /**
       * writeUnsafe = write direct (downgrade possible)
       * ⚠️ À utiliser uniquement pour la feature Undo (historique)
       */
      writeUnsafe: async ({ uid, animeId, episode, status, extra = {} }) => {
        // note: uid n'est pas dans le body de l'endpoint, il est porté par le token
        return client.requestByKey("progression_write", {
          __allowUnsafe: true,
          body: {
            id: animeId,
            animeID: animeId,
            progression: episode,
            ...(status != null ? { status } : {}),
            ...extra,
          },
        });
      },

      delete: async ({ animeId }) => {
        const id = Number.parseInt(animeId, 10);
        if (!Number.isFinite(id)) {
          return {
            ok: false,
            error: { code: "BAD_ARGS", status: 0, message: "animeId invalid" },
          };
        }

        // ✅ Payload réel confirmé : { id: 4694 }
        return client.requestByKey("progression_delete", {
          body: { id },
        });
      },
    },

    favorite: {
      list: (uid) => client.requestByKey("favorites_list", { params: { uid } }),
      add: (animeId) =>
        client.requestByKey("favorite_add", { body: { id: animeId } }),
      remove: (animeId) =>
        client.requestByKey("favorite_remove", { body: { id: animeId } }),
    },

    social: {
      followers: (uid) =>
        client.requestByKey("social_followers", { params: { uid } }),
      following: (uid) =>
        client.requestByKey("social_following", { params: { uid } }),
      // follow/unfollow exclus
    },

    agenda: {
      week: () => client.requestByKey("agenda_week"),
    },

    episode: {
      listByAnimeId: (animeID) =>
        client.requestByKey("episode_list", { query: { animeID } }),
    },

    request: {
      list: (query = {}) => client.requestByKey("request_list", { query }),
      get: (id) => client.requestByKey("request_get", { params: { id } }),
      create: (body) => client.requestByKey("request_create", { body }),
      patch: (body) => client.requestByKey("request_patch", { body }),
    },

    edit: {
      list: (query = {}) => client.requestByKey("edit_list", { query }),
      create: (body) => client.requestByKey("edit_create", { body }),
      patch: (id, body) =>
        client.requestByKey("edit_patch", { params: { id }, body }),
    },
  };
}
