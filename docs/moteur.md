# Choix du moteur

> Décision : **TypeScript + technologies web** (Canvas 2D pour la scène, DOM/CSS pour l'interface,
> Web Audio pour le son), empaqueté plus tard avec **Tauri** (ou Electron) pour Steam.
> Repli prévu : **Godot 4** si une sortie console devient prioritaire.

Ce document explique pourquoi, ce que le prototype a permis de vérifier, et à quel moment
revoir la décision.

## Ce que le jeu demande vraiment

NetArchitect n'est pas un jeu d'action. En listant ce que le concept exige, cinq besoins
ressortent, par ordre de poids :

| Besoin | Pourquoi | Conséquence technique |
| --- | --- | --- |
| **Une interface dense** | Console, formulaires de VLAN, tables de règles, inspecteur, arbre de compétences : la moitié de l'écran est de l'interface. | Il faut le meilleur outil d'UI disponible, pas un moteur de rendu. |
| **Une simulation de graphe déterministe** | Files d'attente, routage, pare-feu, chaleur, frustration. Aucune physique. | Du code pur, testable hors rendu, rejouable à l'identique. |
| **Beaucoup de petits sprites lumineux** | Des centaines, puis des milliers de paquets néon sur des lignes. | Du 2D simple ; WebGL seulement quand le volume l'impose. |
| **Un audio adaptatif** | La synthwave accélère pendant les pannes ; ronronnement des baies. | Couches pilotées en temps réel, idéalement génératives. |
| **Des retours de joueurs très tôt** | Un jeu de réflexion vit de son équilibrage. | Pouvoir partager un lien jouable en une minute. |

## Options étudiées

| Critère | Web TypeScript | Godot 4 | Unity | MonoGame / FNA |
| --- | --- | --- | --- | --- |
| Interface dense (console, formulaires, tableaux) | ★★★ HTML/CSS natif | ★★ nœuds Control, thèmes | ★★ UI Toolkit | ★ tout à coder |
| Simulation pure et testable | ★★★ modules TS + Vitest | ★★ GDScript/C# | ★★ C# + NUnit | ★★★ C# |
| Rendu de milliers de sprites 2D | ★★ Canvas, ★★★ WebGL/PixiJS | ★★★ | ★★★ | ★★★ |
| Audio adaptatif | ★★ Web Audio (génératif) | ★★★ AudioStreamInteractive | ★★★ FMOD/Wwise | ★ |
| Partage d'une démo jouable | ★★★ un fichier HTML, itch.io | ★★ export web plus lourd | ★ WebGL lourd | ★ |
| Steam (PC/Mac/Linux) | ★★ via Tauri/Electron | ★★★ | ★★★ | ★★★ |
| Consoles | ★ | ★★ via prestataires | ★★★ | ★★ |
| Mobile / tablette | ★★ via Capacitor | ★★★ | ★★★ | ★ |
| Licence et coût | Libre | Libre (MIT) | Propriétaire | Libre |

Hacknet a été écrit en XNA et Mini Metro en Unity : ces outils conviennent au genre. Mais
aucun des deux jeux n'a l'interface de configuration que demande NetArchitect.
Plusieurs jeux de gestion réseau ou d'automatisation sortis sur Steam (shapez, Bitburner)
montrent qu'une base web tient la distance commerciale.

## Pourquoi le web l'emporte ici

1. **L'interface est le cœur du jeu.** Un tableau de règles de pare-feu, une saisie CIDR
   avec validation, une console avec historique et complétion : en HTML/CSS c'est l'affaire
   de quelques heures. Dans un moteur, ce sont des jours, et le résultat est moins accessible
   (lecteurs d'écran, zoom navigateur, navigation clavier).
2. **La simulation n'a pas besoin d'un moteur.** C'est un graphe, des files et des
   équations. Le dossier `src/core/` n'importe rien du DOM : il tourne dans Node pour les
   tests, dans le navigateur pour le jeu, et demain dans un Web Worker si la charge grimpe.
3. **L'itération est immédiate.** Le build produit un seul `index.html` de 350 ko qui
   s'ouvre sans serveur. N'importe quel testeur joue en un clic, ce qui compte pour
   l'équilibrage d'un jeu de réflexion.
4. **Le rendu reste modeste.** Des lignes, des pictogrammes, des points lumineux en mode
   additif : Canvas 2D suffit pour le prototype (centaines de paquets à 60 i/s). Le moteur
   de rendu est isolé derrière `src/render/`, remplaçable par PixiJS sans toucher au reste.

## Ce que le prototype a validé

| Hypothèse | Vérification |
| --- | --- |
| Simulation déterministe et testable | 48 tests Vitest, dont une solution de référence par mission jouée en entier (≈ 0,1 s la journée). |
| Équilibrage outillé | `npm run balance` rejoue chaque mission et des variantes dégradées, avec charges et températures. |
| Rendu fluide | Plan physique ⇄ vue topologique en morphing animé, paquets néon additifs, files d'attente visibles. |
| Interface riche | Console avec historique/complétion, formulaires VLAN/CIDR validés en direct, pare-feu éditable, tiroir mobile. |
| Audio adaptatif sans fichiers | Synthwave générée (pad, basse, arpège, batterie) dont le tempo passe de 84 à 120 BPM selon la tension. |
| Distribution | Un seul fichier HTML autonome (polices embarquées, aucune requête réseau). |

## Architecture retenue

```
src/core/     Simulation pure : graphe, routage VLAN/L3, pare-feu, trafic, chaleur,
              frustration, incidents, console, objectifs. Aucune dépendance au DOM.
src/render/   Canvas 2D : caméra, mise en page topologique, pictogrammes, paquets.
src/app/      Écrans DOM, contrôleur de mission, entrées souris/clavier/tactile.
src/audio/    Web Audio procédural.
```

La règle d'or : **le cœur ne connaît ni l'écran ni le temps réel**. Il avance par pas fixes
de 1/60 s avec une graine aléatoire fixe ; l'interface ne fait que lire son état et lui
envoyer des commandes, exactement comme la console.

## Feuille de route technique

| Déclencheur | Action |
| --- | --- |
| Plus de ~3 000 paquets à l'écran (missions « cloud ») | Passer `src/render/` sur PixiJS (WebGL) ; garder l'API `Renderer`. |
| Simulation > 4 ms par image | Déplacer `Simulation` dans un Web Worker (le cœur est déjà sérialisable). |
| Sortie Steam | Tauri (binaire léger) + intégration Steamworks, sauvegardes sur disque. |
| Version tablette | Capacitor ; le tactile (pincement, tiroir) est déjà en place. |
| Consoles confirmées | Réévaluer Godot 4 : porter `src/core/` en C# ou GDScript avec les mêmes tests de référence. |

## Risques

- **Performances du Canvas 2D** sur de très grands réseaux : mesuré et contenu, avec une
  porte de sortie claire (PixiJS).
- **Audio web** : l'autoplay impose un premier clic ; le moteur démarre au premier geste.
- **Consoles** : c'est la vraie limite du choix. Si elle devient un objectif commercial,
  la séparation cœur/rendu rend un portage réaliste.
