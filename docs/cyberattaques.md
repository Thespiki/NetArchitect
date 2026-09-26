# Mécaniques de cyberattaque

Chaque crise est un **puzzle en temps réel** : un symptôme visible, un indice à trouver,
une parade précise, et un coût si l'on frappe trop large. Le vocabulaire et les ports sont
réels ; les ordres de grandeur sont compressés pour qu'une journée de 9 h à 18 h tienne en
deux à trois minutes.

## La boucle de crise

| Étape | Ce que voit le joueur | Outils |
| --- | --- | --- |
| **1. Détecter** | Jauge de frustration qui monte, câble qui vire au rouge, file de paquets qui tourne autour d'un équipement, alerte dans le panneau. | Alertes, couleurs de charge, son qui s'accélère. |
| **2. Diagnostiquer** | Quel port ? Quelle source ? Quel poste ? | `top`, `top src`, `tcpdump`, survol d'un paquet (en-tête), inspecteur du routeur (« trafic observé »). |
| **3. Neutraliser** | Poser la bonne règle, isoler le bon poste, envoyer le technicien. | `block`, `blockip`, `fw`, `ratelimit`, `quarantine`, `dispatch`, ou les boutons équivalents. |
| **4. Rétablir** | Vérifier que la frustration redescend, nettoyer, retirer une règle trop large. | `status`, `ping`, `traceroute`, `release`. |

Le jeu mesure le **temps de neutralisation** (étoile bonus de ShopNow et Helios) et
pénalise les parades qui cassent le trafic légitime (requêtes bloquées = frustration).

## Règles communes

- **Le pare-feu filtre le trafic routé.** Il s'applique quand un paquet change de VLAN ou
  sort vers Internet. Deux postes du même VLAN se parlent sans filtrage : sans segmentation,
  aucune règle ne protège la compta.
- **Pare-feu à état.** Les réponses aux connexions établies passent toujours : bloquer
  « internet → tout » ne coupe pas la navigation des employés.
- **Première règle qui correspond.** L'ordre compte ; `fw up n` remonte une règle.
- **Filtrer coûte moins cher que router.** Un paquet rejeté consomme 25 % du temps de
  traitement du routeur : bloquer tôt soulage vraiment l'équipement.

## Catalogue implémenté

### Sondes d'audit (déplacement latéral) · BioNova, Helios

- **Scénario.** L'auditeur envoie en continu des tentatives d'accès interdites : compta →
  données R&D (TCP/445), R&D → ERP (TCP/1433), marketing → postes finance.
- **Signature.** Points orange. Une sonde qui passe déclenche une alarme « BRÈCHE » sur la
  cible et un message critique.
- **Parade.** VLAN distincts pour forcer le passage par le routeur, puis règle de refus
  (`fw deny compta labdata`). La console permet de vérifier avant la journée :
  `traceroute compta labdata tcp/445` affiche le saut où le paquet est bloqué.
- **Piège.** Poser les règles sans VLAN : les sondes restent commutées et passent.
- **Objectif.** Zéro brèche.

### DDoS volumétrique par amplification NTP · ShopNow

- **Scénario.** À 14 h 35, des milliers de réponses NTP (UDP/123) venues de `45.155.0.0/16`
  inondent le pool web, en pleine journée de soldes.
- **Signature.** Points rouges depuis Internet, serveurs web à 100 %, files d'attente
  autour des serveurs, clients qui abandonnent.
- **Diagnostic.** `top` : `UDP/123` apparaît avec un débit anormal, marqué ⚠. Le survol
  d'un paquet rouge donne son en-tête complet.
- **Parade.** `block udp 123`, ou le bouton « Bloquer » à côté de la ligne dans l'inspecteur
  du routeur. Aucun trafic légitime n'utilise ce port.
- **Piège.** Bloquer `tcp/443` : l'attaque continue et les clients sont coupés.
- **Mesure.** Neutralisation déclarée quand 90 % des paquets d'attaque sont rejetés en
  bordure ; étoile si c'est fait en moins de 20 s.

### Flood HTTP par botnet · Helios

- **Scénario.** À 15 h 18, un botnet envoie de vraies requêtes HTTPS (TCP/443) au portail
  client depuis `185.220.0.0/16`.
- **Signature.** Le portail sature ; `top` montre seulement `TCP/443`, comme le trafic
  normal.
- **Diagnostic.** `top src` regroupe les sources par /16 : une plage domine, marquée ⚠.
- **Parade.** `blockip 185.220.0.0/16` (ou champ « Plage » du pare-feu en direct).
  Alternative avec la compétence Limitation de débit : `ratelimit tcp/443 40`, qui
  plafonne aussi les vrais clients.
- **Piège.** Bloquer le port 443, ce qui revient à fermer la boutique.

### Ver informatique (SMB) · Helios

- **Scénario.** À 12 h 47, le poste `PM-6` du marketing est compromis. Il balaye le réseau
  en TCP/445 ; chaque poste touché peut être infecté à son tour.
- **Signature.** Anneau rouge pulsant sur les postes infectés, trafic rouge interne,
  messages « … est infecté par le ver ».
- **Diagnostic.** `top src` classe les sources : les postes infectés émettent plusieurs fois
  plus que les autres et sont marqués ⚠.
- **Parade.** `quarantine pm-6` (ou bouton « Isoler ») sur chaque poste infecté, puis
  `dispatch pm-6` : le technicien réinstalle le poste, qui devient immunisé.
- **Prévention.** Des VLAN par service et une règle `fw deny vlan10 vlan20 tcp/445`
  limitent la propagation au service d'origine, parce qu'entre deux VLAN le routeur filtre.
- **Piège.** `block tcp 445` partout : le ver s'arrête, mais les serveurs de fichiers
  aussi, et les utilisateurs perdent leurs documents.
- **Coût.** Un poste en quarantaine ne travaille plus : laisser des postes isolés toute la
  journée fait monter la frustration.
- **Objectif.** Au plus 8 postes infectés sur la journée.

### Panne matérielle · Helios

- **Scénario.** À 10 h 48, le switch d'accès qui dessert le plus de postes tombe en panne.
- **Parade.** « Envoyer un technicien » : il marche depuis le Bureau IT sur le plan
  physique. Placer les baies près du bureau IT ou prévoir un chemin redondant (deuxième
  switch, double lien) réduit l'impact.
- **Objectif.** Réparation avant 40 s, sinon +15 % de frustration et objectif manqué.

### Surchauffe · toutes les missions

Un équipement saturé chauffe. En salle serveurs climatisée il plafonne vers 75 °C ; dans
un bureau il atteint 85 °C et s'arrête le temps de refroidir. Ce n'est pas une attaque,
mais une attaque qui sature un routeur mal placé finit souvent en surchauffe.

## Compétences liées

| Compétence | Effet sur les crises |
| --- | --- |
| Sonde IDS | Nomme le vecteur (port, plage, poste) dès la première alerte et propose un bouton de parade. |
| Limitation de débit | Commande `ratelimit` : amortir sans couper. |
| Script d'auto-mitigation | Pose la règle de blocage six secondes après la détection. |
| Second technicien | Deux interventions en parallèle (panne + nettoyage). |
| Trottinette électrique | Techniciens 60 % plus rapides. |

## Pistes pour la suite

| Idée | Mécanique | Leçon |
| --- | --- | --- |
| Amplification DNS piégée | L'attaque vient de `udp/53`, que la navigation utilise aussi. `block udp 53` casse Internet ; il faut une règle ciblée (`fw deny internet web udp/53`). | Précision des règles. |
| Rançongiciel | Un serveur se chiffre ; restaurer depuis une sauvegarde prend du temps de technicien, sauf si un serveur de sauvegarde isolé a été prévu. | Sauvegardes hors ligne. |
| Hameçonnage | Des identifiants volés ouvrent des connexions sortantes la nuit ; les repérer dans `tcpdump`. | Surveillance des flux sortants. |
| ARP spoofing | Un poste se fait passer pour la passerelle dans son VLAN ; seul un switch « niveau 3 » avec inspection le bloque. | Sécurité de couche 2. |
| Attaque en vagues | Le botnet change de port quand on le bloque. | Automatisation (IDS + scripts). |
| Exfiltration lente | Petits flux chiffrés vers une adresse inhabituelle, invisibles dans `top`. | Analyse fine des sources. |

Les paramètres de chaque crise (instant, débit, port, plage source, délai) sont décrits
dans `src/core/levels.ts` ; le comportement est dans `src/core/simulation.ts`
(`startDdos`, `startWorm`, `startFailure`).
