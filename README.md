# Hyak Tracker

Extension navigateur qui **détecte l’anime/saison/épisode** sur les sites de streaming, puis **track la lecture vidéo** pour déclencher un **auto-marquage "vu"** sur Hyakanime au bon moment (fin d’épisode / seuil de progression).

## Fonctionnalités (actuelles)

- ✅ Extraction depuis la page : **Titre / Saison / Épisode**
- ✅ Tracking vidéo : détection d’état (play/pause), progression, fin de vidéo (selon player)
- ✅ Auto-marquage : envoie du “marquer comme vu” sur Hyakanime
- ✅ Anti-downgrade : verrouille le bouton / auto-write si la progression Hyakanime est déjà >= épisode courant
- ✅ Architecture modulaire : 1 module par site

---

## Sites de streaming supportés

> Légende : **OK** = fonctionnel, **Partiel** = dépend du cas / player / SPA, **KO** = non implémenté ou non fiable.

| Site             | Module                    | Extraction (titre/saison/ep) | Tracking vidéo | Auto-marquage | Notes                                                                                           |
| ---------------- | ------------------------- | ---------------------------: | -------------: | ------------: | ----------------------------------------------------------------------------------------------- |
| anime-sama       | `src/modules/anime-sama/` |                           OK |             OK |            OK | Base de référence, fonctionne actuellement.                                                     |
| VoirAnime (v6)   | `src/modules/voiranime/`  |                           OK |      (à venir) |     (à venir) | Site parfois **SPA** : changement d’épisode sans reload → dépend de l’observation DOM + events. |
| Netflix          | (à venir)                 |                    (à venir) |      (à venir) |     (à venir) | Non intégré.                                                                                    |
| YouTube          | (à venir)                 |                    (à venir) |      (à venir) |     (à venir) | Non intégré.                                                                                    |
| Prime Video      | (à venir)                 |                    (à venir) |      (à venir) |     (à venir) | Non intégré.                                                                                    |
| Crunchyroll      | (à venir)                 |                    (à venir) |      (à venir) |     (à venir) | Non intégré.                                                                                    |
| ADN              | (à venir)                 |                    (à venir) |      (à venir) |     (à venir) | Non intégré.                                                                                    |
| Hyakanime (site) | `src/modules/hyakanime/`  |                          N/A |            N/A |           N/A | Sert uniquement à récupérer le token/uid & appeler l’API.                                       |

---

## Players vidéo supportés

> Objectif : rendre les **players génériques** et réutilisables sur plusieurs sites (même player, plusieurs hosts).

| Player            | Détection play/pause | Progression (timeupdate) | Détection fin (ended) | Robustesse (SPA / iframes) | Notes             |
| ----------------- | -------------------: | -----------------------: | --------------------: | -------------------------: | ----------------- |
| Vidmoly (embed)   |                   ok |                  Partiel |               Partiel |                    Partiel | En phase de teste |
| smoothpre (embed) |                   ok |                  Partiel |               Partiel |                    Partiel | En phase de teste |
| embed4me (embed)  |                   ok |                  Partiel |               Partiel |                    Partiel | En phase de teste |
| sibnet (embed)    |                   ok |                  Partiel |               Partiel |                    Partiel | En phase de teste |
| sendvid (embed)   |                   ok |                  Partiel |               Partiel |                    Partiel | En phase de teste |

---

Make by VualDirr
