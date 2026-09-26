# Concept

## Pitch

**NetArchitect : L'Art du Routage** est un jeu de réflexion et de gestion en 2D avec une
forte composante interface, à la croisée de *Mini Metro* pour le flux visuel et de
*Hacknet* pour l'immersion technique. Le joueur incarne un administrateur réseau qui doit
concevoir, maintenir et défendre l'infrastructure d'entreprises de plus en plus complexes.

## Piliers

1. **Un système bien ordonné procure du plaisir.** Des câbles propres, des paquets qui
   circulent sans bouchon, une jauge de frustration à zéro.
2. **La tension naît du temps réel.** La conception se fait au calme ; la journée, elle,
   ne s'arrête pas.
3. **Le vrai vocabulaire, à dose lisible.** VLAN, CIDR, pare-feu, ports, DDoS, ver : les
   concepts sont exacts, les chiffres sont compressés.
4. **Chaque crise a une parade identifiable.** Un symptôme, un indice, une réponse précise ;
   frapper trop large a un coût.

## La boucle de jeu

| Phase | Concept d'origine | Dans le prototype |
| --- | --- | --- |
| **Architecture** | Placer routeurs, switchs, points d'accès Wi-Fi, tirer les câbles (RJ45, fibre) avec un budget fixe. | Pose sur grille, câbles orthogonaux mesurés en mètres (RJ45 100 m max), coût au mètre, ports limités, câbles parallèles, Wi-Fi à portée, annulation, câblage automatique d'une pièce. |
| **Configuration** | Sous-réseaux, adresses IP, règles de pare-feu, par mini-puzzles ou console. | VLAN par service, découpage VLSM validé en direct, éditeur de règles ordonnées, répartition de charge ; tout aussi faisable à la console, avec `ping`/`traceroute` qui tracent le chemin sur le plan. |
| **Tension (live)** | Paquets lumineux en temps réel, goulots d'étranglement, frustration, surchauffe. | Paquets néon par type de trafic, files visibles autour des équipements, câbles qui virent à l'orange puis au rouge, chaleur selon la pièce, pièces teintées selon l'humeur des utilisateurs. |

L'écran alterne entre le **plan d'étage physique** et la **vue topologique** : touche Tab,
avec un morphing animé où les câbles se redressent en liens logiques.

## Progression

| Mission | Entreprise | Rang | Nouveauté |
| --- | --- | --- | --- |
| 1 | PixelBrew, start-up | Technicien support | Budget, routeur, switch |
| 2 | Studio Kiwi, agence vidéo | Technicien réseau | Débit, chaleur, Wi-Fi |
| 3 | BioNova Labs, biotech | Administrateur système | VLAN, sous-réseaux, pare-feu |
| 4 | ShopNow, e-commerce | Ingénieur réseau | Répartition de charge, DDoS |
| 5 | Helios Group, siège | Architecte réseau | Pannes, ver, flood HTTP |

L'étape suivante du concept, *architecte cloud pour des multinationales* (multi-sites,
VPN, cloud hybride), est prévue dans la feuille de route du README.

**Arbre de compétences** : douze améliorations en trois branches (Infrastructure,
Sécurité, Exploitation), dont les trois citées dans le concept : switch niveau 3,
câblage 10 Gb/s et scripts d'automatisation (auto-VLAN, auto-mitigation).

## Direction artistique

- **Visuels** : interface sombre, neutres bleutés, néons réservés au trafic : bleu pour le
  web, violet pour le streaming, rouge pour le trafic malveillant ou bloqué. Vert pour les
  fichiers internes et orange pour les sondes d'audit complètent la palette.
- **Typographie** : Oxanium pour les titres, IBM Plex Sans pour l'interface, IBM Plex Mono
  pour la console et les données.
- **Audio** : synthwave lente et concentrée, générée en direct, qui accélère avec la
  frustration et les incidents, sur le ronronnement des baies de brassage.

## Documents liés

- [Choix du moteur](moteur.md)
- [Mécaniques de cyberattaque](cyberattaques.md)
- [Systèmes de simulation](systemes.md)
