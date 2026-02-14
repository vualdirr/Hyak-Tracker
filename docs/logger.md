# 🧠 Hyak Tracker — Logger Global

Ce document décrit le fonctionnement officiel du système de logs global de l’extension.

---

# 🎯 Objectifs du Logger

Le logger doit :

- Centraliser **tous les logs en RAM** (background, scoped par onglet)
- Fusionner streaming + player dans une même session
- Séparer **debug technique** et **milestones UX**
- Permettre un clipboard complet
- Rendre le popup lisible et non verbeux

---

# 📊 Matrice de comportement des niveaux

| Niveau | Stockage RAM | Console (debug OFF) | Console (debug ON) | Clipboard | Popup `<pre>` |
| ------ | ------------ | ------------------- | ------------------ | --------- | ------------- |
| error  | ✅           | ✅                  | ✅                 | ✅        | ✅            |
| warn   | ✅           | ❌                  | ✅                 | ✅        | ❌            |
| info   | ✅           | ❌                  | ✅                 | ✅        | ❌            |
| debug  | ✅           | ❌                  | ✅                 | ✅        | ❌            |
| step   | ✅           | ❌                  | ✅                 | ✅        | ✅            |

---

# 🔎 Définition des niveaux

## 🔴 error

Utilisé lorsque le flow est cassé ou invalide.

**Exemples :**

- Exception non gérée
- API KO
- Write progression échoué
- Contexte manquant critique

> Visible partout, même debug OFF.

---

## 🟠 warn

Comportement inattendu mais non bloquant.

**Exemples :**

- Fallback activé
- Donnée partiellement incohérente

> Visible uniquement en console si debug ON.

---

## 🔵 info

Événements techniques importants mais normaux.

**Exemples :**

- Module initialisé
- Requête API réussie
- Message runtime reçu

> Technique uniquement (pas affiché popup).

---

## 🟣 debug

Détails internes.

**Règles :**

- Jamais dans des boucles fréquentes
- Pas de spam
- Sert au support / clipboard

**Exemples :**

- Payloads détaillés
- Tick autoMark
- Mutation observer

---

## ⭐ step (Milestone UX)

⚠️ Niveau spécial destiné au popup.

Doit être utilisé **uniquement** pour :

- Grandes étapes du flow
- Chemin critique utilisateur
- Injection modules
- Player détecté
- Token détecté
- Automark déclenché
- Commit progression
- Skip anti-downgrade
- Erreur critique visible utilisateur

❌ Ne jamais utiliser `step` pour :

- Debug technique
- Logs répétitifs
- Informations internes
- Logs de boucle

---

# 🧩 Architecture

## Logger (`createLogger`)

- Disponible côté content et popup.
- Envoie toujours les logs au background (`LOG_PUSH`).
- Le mode debug contrôle uniquement l’affichage console.
- Le stockage reste actif même si debug OFF.

## Background

- Stockage en RAM par `tabId`.
- Session basée sur le hostname du **top frame**.
- Fusion streaming + player.
- Purge uniquement lors d’un changement de hostname top.

## Popup

- Récupère les logs via `LOG_GET_CURRENT`.
- Affiche uniquement :
  - `kind === "step"`
  - `level === "error"`

---

# 📌 Philosophie

Le logger doit répondre à deux besoins distincts :

### 🔧 Support / Debug technique

→ `debug`, `info`, `warn`, `error`

### 👁️ UX / Compréhension utilisateur

→ `step` + `error`

Un bon milestone doit répondre à la question :

> “Qu’est-ce que l’utilisateur a besoin de savoir à ce moment précis ?”

Et non :

> “Qu’est-ce que le développeur veut voir ?”

---

# 🚀 État actuel

Le système actuel respecte :

- Séparation stricte debug / milestone
- Anti-spam
- Anti-downgrade instrumenté
- Automark instrumenté
- Intégration modules instrumentée

Le logger est désormais considéré comme stable.
