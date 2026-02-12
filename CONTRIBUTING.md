# Contribuer à Hyak Tracker (CONTRIBUTING)

Merci de vouloir contribuer à **Hyak Tracker** 🙌  
Ce document explique comment ajouter des modules (sites de streaming / players) et proposer des améliorations **sans casser l’architecture**.

---

## Objectif du projet

Hyak Tracker est organisé autour de :

- un **core** stable,
- un **wrapper API Hyakanime** centralisé,
- un système de **modules indépendants** (streaming / player),
- une normalisation des données (entrées/sorties).

---

## Structure du projet

```txt
src/
  core/          → logique centrale
  api/           → wrapper API Hyakanime (centralisation des requêtes)
  modules/       → modules par site / player
  shared/        → utilitaires partagés
```

---

## 🚀 Démarrage rapide

1. **Fork** le repository
2. Crée une branche `feature/<nom>`  
   > ⚠️ Une feature = une Pull Request
3. Ajoute ton module dans `src/modules/`
4. Teste localement
5. Ouvre une Pull Request vers `main`
