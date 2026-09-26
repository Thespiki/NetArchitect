# Systèmes de simulation

Référence des règles du prototype, pour concevoir de nouvelles missions et comprendre
l'équilibrage. Tout est dans `src/core/`.

## Temps et unités

- **Pas fixe** de 1/60 s (`STEP`), graine aléatoire fixe par mission : une même conception
  rejoue exactement la même journée.
- La journée (9 h → 18 h) dure `dayLength` secondes réelles à ×1 (110 à 200 s).
- **Débit** : 30 u/s = 1 Gb/s. Un paquet de taille 1 ≈ 33 Mb.
- **Distance** : une case = 5 m.

| Élément | Débit | Ports | Coût |
| --- | --- | --- | --- |
| Switch 8 ports | 2 Gb/s | 8 | 250 € |
| Switch 24 ports | 5 Gb/s | 24 | 650 € |
| Routeur PME | 2,5 Gb/s | 4 | 700 € |
| Borne Wi-Fi | 0,8 Gb/s partagés, portée 30 m, 8 portables | 1 | 220 € |
| Switch niveau 3 *(compétence)* | 11 Gb/s | 24 | 1 500 € |
| Routeur haute capacité *(compétence)* | 8 Gb/s | 8 | 1 900 € |
| Câble RJ45 Cat6 | 1 Gb/s, 100 m max | | 20 € + 1 €/m |
| Fibre OM4 *(compétence)* | 10 Gb/s, 500 m max | | 120 € + 2,4 €/m |

Le lien vers la box opérateur est limité par l'abonnement (`isp`), pas par le cordon.

## Trafic

| Type | Couleur | Service | Requête → réponse |
| --- | --- | --- | --- |
| Navigation web | bleu | TCP/443 | 1 → 2 |
| Streaming vidéo | violet | UDP/443 | 1 → 4 |
| Fichiers et applis internes | vert | port du serveur | 1 → 3 |
| Clients e-commerce (entrants) | bleu clair | TCP/443 | 1 → 2 |
| Sonde d'audit | orange | port de la cible | 1 → rien |
| Attaque, ver | rouge | selon l'attaque | 1 → rien |

Chaque poste émet des requêtes selon un processus de Poisson :
`taux du groupe × courbe de la journée × pics d'événements`. La courbe « bureau » monte de
35 % à 9 h à 100 % vers 11 h, creuse à l'heure du déjeuner (où le streaming est multiplié
par 2,2), puis retombe à 40 % à 18 h. Les clients suivent une courbe « boutique ».

## Commutation et files d'attente

1. Un paquet arrive dans la **file d'entrée** d'un équipement (taille limitée : au-delà,
   il est perdu).
2. L'équipement le traite si son **seau de jetons** le permet (débit de commutation).
3. Le paquet passe dans la **file de sortie** du lien choisi, puis part quand le lien a
   assez de jetons (débit du câble, dans chaque sens).
4. Le temps passé en file s'accumule dans `waited`.

Une transaction (requête + réponse) est **bonne** si `waited` ≤ 0,8 s, **lente**
jusqu'à 2,5 s, **ratée** au-delà ou si un paquet est perdu, bloqué, ou sans route.

## Routage et VLAN

- Les liens entre équipements sont des trunks : tous les VLAN y circulent.
- Un paquet dont le VLAN source diffère du VLAN destination (ou qui va vers Internet)
  doit traverser un **équipement de niveau 3** (routeur ou switch L3). Le routage calcule
  deux distances par destination : avant et après ce passage.
- Chemin le plus court en sauts ; à coût égal, le lien le moins chargé est choisi
  (**ECMP**) : deux câbles en parallèle doublent le débit.
- Un équipement en panne ou un poste en quarantaine sort du graphe ; les tables sont
  recalculées.

## Adressage

- Mode automatique : chaque VLAN reçoit `10.0.<vlan>.0/24`.
- Mode manuel (BioNova) : chaque VLAN utilisé doit recevoir un sous-réseau aligné, inclus
  dans le bloc du FAI, sans chevauchement, et assez grand pour ses hôtes plus la
  passerelle (`.1`). Un poste sans adresse ne communique pas.

## Chaleur

```
dT/dt = 0,12 × facteur_chaleur × charge² − refroidissement_pièce × T
```

`T = 1` correspond à 85 °C (arrêt de sécurité, redémarrage à 57 °C). Refroidissement :
0,10 dans un bureau, 0,17 en salle serveurs (+35 % avec la compétence). À pleine charge,
un routeur tient en salle serveurs (≈ 78 °C) et surchauffe ailleurs en une dizaine de
secondes.

## Frustration

Les issues des transactions récentes sont mémorisées avec un oubli exponentiel (5 s).
Avec `r` la part de transactions ratées (une transaction lente compte pour moitié) :

```
dF/dt = 8 × r − 1,5 × (1 − r)
```

La frustration monte dès que plus de 16 % des transactions échouent, et redescend sinon.
À 100 %, la mission est perdue. Un délai d'intervention dépassé ajoute 15 points. Chaque
pièce se teinte de rouge selon l'humeur de son service.

## Incidents

| Incident | Déclencheur | Résolu quand |
| --- | --- | --- |
| Panne | instant fixé, cible « auto » = switch d'accès le plus chargé | le technicien a réparé |
| DDoS | instant, débit croissant (rampe), port, plage source | 90 % des paquets d'attaque rejetés en bordure |
| Ver | poste patient zéro, taux de balayage, probabilité d'infection | plus aucun poste infecté hors quarantaine |

Les techniciens marchent sur le plan (3,5 cases/s), réparent en 4 s et réinstallent un
poste en 6 s ; un poste réinstallé est immunisé.

## Objectifs et étoiles

- 1ʳᵉ étoile : tous les objectifs obligatoires (tenir la journée, zéro brèche, délais de
  panne, ver contenu, disponibilité du service).
- 2ᵉ et 3ᵉ étoiles : critères bonus par mission (frustration moyenne, dépense, pertes,
  temps de neutralisation).
- Chaque étoile rapporte un point de compétence.

## Équilibrage

`npm run balance` joue chaque mission avec sa solution de référence
(`tests/solutions.ts`) et des variantes dégradées, puis affiche frustration, pertes,
charges et températures maximales. Ajouter `DETAIL=1` pour le détail, ou un identifiant
de mission (`npm run balance -- helios`). Les tests Vitest vérifient que chaque mission
se gagne sans compétence et se perd avec une conception vide.
