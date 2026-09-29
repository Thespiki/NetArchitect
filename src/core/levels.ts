// Campaign: from the intern's training day to the architect of a group's headquarters.

import { same } from '../i18n/index.ts';
import { computeAddressing } from './config.ts';
import { cabled, deviceOf, hasDevice, isKind, linked, ran, type GuideState } from './guide.ts';
import type { EndpointDef, LevelDef } from './level.ts';

const COLORS = {
  team: '#9fb3d9',
  srv: '#c0c7d4',
  crea: '#d6a6c9',
  video: '#c9b48a',
  meet: '#9fc7d9',
  rnd: '#8fd0c0',
  acct: '#e0c48c',
  staff: '#b0b8e8',
  mkt: '#e3a3a3',
  dev: '#94d4b4',
  fin: '#e0c48c',
};

function pcs(prefix: string, group: string, cells: [number, number][], kind: EndpointDef['kind'] = 'workstation'): EndpointDef[] {
  return cells.map(([x, y], i) => ({ id: `${prefix}-${i + 1}`, kind, x, y, group }));
}

const ISP = { en: 'ISP', fr: 'FAI' };
const SERVERS = { en: 'Servers', fr: 'Serveurs' };
const SERVER_ROOM = { en: 'Server room', fr: 'Salle serveurs' };
const IT_OFFICE = { en: 'IT office', fr: 'Bureau IT' };

/** Cable tool target: the tool button first, then the right end of the cable. */
function cableTarget(s: GuideState, first: string | undefined, second: string | undefined) {
  if (s.tool !== 'cable') return { ui: 'tool-rj45' };
  if (!first || !second) return null;
  if (s.cableFrom === first) return { node: second };
  if (s.cableFrom === second) return { node: first };
  return { node: first };
}

// ---------------------------------------------------------------------------
// Mission 0: training

const training: LevelDef = {
  id: 'training',
  order: 0,
  company: 'ByteCafé',
  title: { en: 'Training day', fr: 'Formation' },
  tagline: { en: 'Your first network, one step at a time.', fr: 'Ton premier réseau, pas à pas.' },
  brief: [
    {
      en: 'ByteCafé, a small coworking café, hires you as its network administrator. Four computers, a file server and an Internet line are waiting to be connected.',
      fr: 'ByteCafé, un petit café-coworking, t’embauche comme administrateur réseau. Quatre postes, un serveur de fichiers et une ligne Internet attendent d’être raccordés.',
    },
    {
      en: 'A guide walks you through every step: building, configuring, then holding a full working day.',
      fr: 'Un guide t’accompagne à chaque étape : construire, configurer, puis tenir une journée de travail complète.',
    },
  ],
  newMechanics: [
    {
      title: { en: 'Three phases', fr: 'Trois phases' },
      text: {
        en: 'Architecture (build), Configuration (settings), then the Day: packets flow from 9:00 to 18:00.',
        fr: 'Architecture (construire), Configuration (régler), puis la Journée : les paquets circulent de 9 h à 18 h.',
      },
    },
    {
      title: { en: 'Frustration', fr: 'Frustration' },
      text: {
        en: 'Every slow or lost request annoys users. At 100%, the day is lost.',
        fr: 'Chaque requête lente ou perdue agace les utilisateurs. À 100 %, la journée est perdue.',
      },
    },
    {
      title: { en: 'Stars', fr: 'Étoiles' },
      text: {
        en: 'Finishing earns one star, bonus goals two more. Each star is a skill point.',
        fr: 'Finir rapporte une étoile, les objectifs bonus deux de plus. Chaque étoile vaut un point de compétence.',
      },
    },
  ],
  size: { w: 18, h: 11 },
  rooms: [
    { id: 'floor', name: { en: 'Café floor', fr: 'Salle' }, kind: 'office', x: 1, y: 1, w: 10, h: 9 },
    { id: 'tech', name: { en: 'Tech room', fr: 'Local technique' }, kind: 'server', x: 12, y: 1, w: 5, h: 4 },
    { id: 'counter', name: { en: 'Counter', fr: 'Comptoir' }, kind: 'lobby', x: 12, y: 6, w: 5, h: 4 },
  ],
  groups: [
    { id: 'team', name: { en: 'Staff', fr: 'Équipe' }, color: COLORS.team },
    { id: 'srv', name: SERVERS, color: COLORS.srv },
  ],
  endpoints: [
    { id: 'isp', kind: 'internet', x: 17, y: 2, label: ISP, isp: 90 },
    { id: 'nas', kind: 'server', x: 15, y: 2, group: 'srv', pool: 'nas', label: same('NAS'), capacity: 16, port: 445 },
    ...pcs('pc', 'team', [
      [3, 3],
      [8, 3],
      [3, 7],
      [8, 7],
    ]),
  ],
  techBase: { x: 14, y: 8 },
  budget: 2000,
  dayLength: 75,
  features: [],
  equipment: ['switch8', 'router'],
  cables: ['rj45'],
  addressing: { mode: 'auto' },
  traffic: {
    groups: { team: { rate: 0.8, mix: { web: 0.55, stream: 0.15, data: 0.3 }, data: ['nas'] } },
    curve: 'office',
  },
  objectives: [{ kind: 'survive' }],
  stars: [
    { kind: 'avgFrustration', max: 8 },
    { kind: 'spent', max: 1500 },
  ],
  tips: [
    {
      en: 'Short cables are cheaper: put the router next to the ISP line and the switch among the computers.',
      fr: 'Les câbles courts coûtent moins cher : le routeur près de l’arrivée FAI, le switch au milieu des postes.',
    },
  ],
  tutorial: [
    {
      id: 'welcome',
      text: {
        en: 'Welcome aboard! You are ByteCafé’s new network administrator. Goal: connect the 4 computers to the Internet and to the NAS, then get through a working day.',
        fr: 'Bienvenue dans l’équipe ! Tu es le nouvel administrateur réseau de ByteCafé. Objectif : relier les 4 postes à Internet et au NAS, puis tenir une journée de travail.',
      },
    },
    {
      id: 'camera',
      text: {
        en: 'Scroll to zoom, drag an empty area to move around, press F to reset the view. Try it, or click Next.',
        fr: 'Molette pour zoomer, glisser sur une zone vide pour te déplacer, F pour recadrer. Essaie, ou clique sur Suivant.',
      },
      done: (s) => s.cameraMoved,
      skippable: true,
    },
    {
      id: 'budget',
      text: {
        en: 'Every device and every meter of cable costs money. Your remaining budget is shown here.',
        fr: 'Chaque équipement et chaque mètre de câble coûtent de l’argent. Ton budget restant s’affiche ici.',
      },
      target: () => ({ ui: 'hud-budget' }),
    },
    {
      id: 'router',
      text: {
        en: 'Pick the Router (key 3), then click a free cell in the tech room, next to the ISP line.',
        fr: 'Choisis le Routeur (touche 3), puis clique sur une case libre du local technique, près de l’arrivée FAI.',
      },
      done: (s) => hasDevice(s, 'router'),
      target: (s) => (s.tool === 'place' && s.toolKind === 'router' ? { area: { x: 12, y: 1, w: 5, h: 4 } } : { ui: 'tool-router' }),
    },
    {
      id: 'isp',
      text: {
        en: 'Pick the RJ45 cable (key 7), click the ISP line, then your router.',
        fr: 'Choisis le câble RJ45 (touche 7), clique sur l’arrivée FAI, puis sur ton routeur.',
      },
      done: (s) => linked(s, (id) => id === 'isp', isKind(s, 'router')),
      target: (s) => cableTarget(s, 'isp', deviceOf(s, 'router')),
    },
    {
      id: 'switch',
      text: {
        en: 'Now place an 8-port switch (key 1) in the middle of the café floor.',
        fr: 'Pose maintenant un switch 8 ports (touche 1) au milieu de la salle.',
      },
      done: (s) => hasDevice(s, 'switch8'),
      target: (s) => (s.tool === 'place' && s.toolKind === 'switch8' ? { area: { x: 4, y: 4, w: 3, h: 3 } } : { ui: 'tool-switch8' }),
    },
    {
      id: 'uplink',
      text: { en: 'Connect the switch to the router with an RJ45 cable.', fr: 'Relie le switch au routeur avec un câble RJ45.' },
      done: (s) => linked(s, isKind(s, 'switch8'), isKind(s, 'router')),
      target: (s) => cableTarget(s, deviceOf(s, 'switch8'), deviceOf(s, 'router')),
    },
    {
      id: 'autocable',
      text: {
        en: 'Press Esc to go back to the Select tool, click the switch, then “Cable nearby computers” in the right panel.',
        fr: 'Appuie sur Échap pour revenir à l’outil Sélection, clique sur le switch, puis sur « Câbler les postes proches » à droite.',
      },
      done: (s) => [1, 2, 3, 4].every((n) => cabled(s, `pc-${n}`)),
      target: (s) => {
        const sw = deviceOf(s, 'switch8');
        if (!sw) return null;
        return s.selected === sw && s.tool === 'select' ? { ui: 'autocable' } : { node: sw };
      },
    },
    {
      id: 'nas',
      text: {
        en: 'Last cable: connect the NAS (file server) to the switch or the router.',
        fr: 'Dernier câble : raccorde le NAS (serveur de fichiers) au switch ou au routeur.',
      },
      done: (s) => cabled(s, 'nas'),
      target: (s) => (s.tool !== 'cable' ? { ui: 'tool-rj45' } : { node: 'nas' }),
    },
    {
      id: 'diagnostics',
      text: {
        en: 'The Diagnostics panel checks your network continuously: computers left unplugged, cables too long, unreachable services. Click a problem to select what causes it.',
        fr: 'Le panneau Diagnostic vérifie ton réseau en continu : postes non raccordés, câbles trop longs, services injoignables. Clique un problème pour sélectionner l’élément en cause.',
      },
      target: () => ({ ui: 'card-diagnostics' }),
    },
    {
      id: 'topology',
      text: {
        en: 'Press Tab (or “Topology” at the top) to see the logical view of your network.',
        fr: 'Appuie sur Tab (ou « Topologie » en haut) pour voir la vue logique de ton réseau.',
      },
      done: (s) => s.view === 'topo',
      target: () => ({ ui: 'hud-topo' }),
    },
    {
      id: 'config',
      text: { en: 'Move on to phase 2 · Configuration.', fr: 'Passe à la phase 2 · Configuration.' },
      done: (s) => s.phase !== 'build',
      target: () => ({ ui: 'phase-config' }),
    },
    {
      id: 'config-info',
      text: {
        en: 'This is where you will set VLANs, subnets, firewall rules and load balancing in the next missions. For ByteCafé, automatic addressing is enough.',
        fr: 'C’est ici que tu régleras VLAN, sous-réseaux, pare-feu et répartition de charge dans les prochaines missions. Pour ByteCafé, l’adressage automatique suffit.',
      },
      target: () => ({ ui: 'card-config' }),
    },
    {
      id: 'console',
      text: {
        en: 'Open the console (² or ` key, or click “Console” at the bottom) and type: ping pc-1 internet',
        fr: 'Ouvre la console (touche ² ou `, ou clique « Console » en bas) et tape : ping pc-1 internet',
      },
      done: (s) => ran(s, 'ping') || ran(s, 'traceroute'),
      target: () => ({ ui: 'console' }),
    },
    {
      id: 'launch',
      text: {
        en: 'The path lights up on the map: your network works. Start the day with “Start the day ▶”.',
        fr: 'Le chemin s’allume sur le plan : ton réseau fonctionne. Lance la journée avec « Lancer la journée ▶ ».',
      },
      done: (s) => s.running || s.finished,
      target: () => ({ ui: 'launch' }),
    },
    {
      id: 'live',
      text: {
        en: 'Packets are flowing! Blue: web, violet: streaming, green: files. Watch the frustration gauge: at 100%, the day is lost.',
        fr: 'Les paquets circulent ! Bleu : web, violet : streaming, vert : fichiers. Surveille la jauge de frustration : à 100 %, la journée est perdue.',
      },
      pause: true,
      target: () => ({ ui: 'hud-frustration' }),
    },
    {
      id: 'speed',
      text: {
        en: 'Speed time up with ×2 or ×4. Space pauses the day.',
        fr: 'Accélère le temps avec ×2 ou ×4. Espace met la journée en pause.',
      },
      done: (s) => s.speed > 1 || s.finished,
      skippable: true,
      target: () => ({ ui: 'hud-speed' }),
    },
    {
      id: 'inspect',
      text: {
        en: 'Click the router to follow its load and temperature live.',
        fr: 'Clique sur le routeur pour suivre sa charge et sa température en direct.',
      },
      done: (s) => s.finished || (s.running && !!s.selected && s.selected === deviceOf(s, 'router')),
      skippable: true,
      target: (s) => {
        const rt = deviceOf(s, 'router');
        return rt ? { node: rt } : null;
      },
    },
    {
      id: 'finish',
      text: {
        en: 'Hold on until 18:00. Bonus goals earn stars, and each star gives a skill point.',
        fr: 'Tiens jusqu’à 18 h. Les objectifs bonus rapportent des étoiles, et chaque étoile un point de compétence.',
      },
      done: (s) => s.finished,
    },
  ],
  seed: 1001,
};

// ---------------------------------------------------------------------------
// Mission 1

const pixelbrew: LevelDef = {
  id: 'pixelbrew',
  order: 1,
  company: 'PixelBrew',
  title: { en: 'First day', fr: 'Premier jour' },
  tagline: { en: 'Six developers, one fiber box and zero cables.', fr: 'Six développeurs, une box fibre et zéro câble.' },
  brief: [
    {
      en: 'PixelBrew, an indie game studio, moves in this morning. The computers are on the desks, the ISP fiber comes into the tech room… and nothing is plugged in.',
      fr: 'PixelBrew, studio de jeux indé, emménage ce matin. Les postes sont sur les bureaux, la fibre de l’opérateur arrive dans le local technique… et rien n’est branché.',
    },
    {
      en: 'Build a simple network: a router to share the Internet, a switch to connect the open space, and the NAS where the team keeps its projects.',
      fr: 'Monte un réseau simple : un routeur pour partager Internet, un switch pour relier l’open space, et le NAS où l’équipe range ses projets.',
    },
  ],
  newMechanics: [
    {
      title: { en: 'Budget', fr: 'Budget' },
      text: {
        en: 'Every device and every meter of cable costs money. The remaining budget is shown at the top.',
        fr: 'Chaque équipement et chaque mètre de câble coûtent. Le budget restant s’affiche en haut.',
      },
    },
    {
      title: { en: 'Router', fr: 'Routeur' },
      text: {
        en: 'The ISP line plugs into a router: it shares the Internet connection (NAT).',
        fr: 'L’arrivée FAI se branche sur un routeur : c’est lui qui partage l’accès Internet (NAT).',
      },
    },
    {
      title: same('Switch'),
      text: {
        en: 'The switch connects the computers to each other and to the router. An RJ45 cable reaches 100 m at most.',
        fr: 'Le switch relie les postes entre eux et vers le routeur. Un RJ45 porte au maximum 100 m.',
      },
    },
  ],
  size: { w: 22, h: 13 },
  rooms: [
    { id: 'open', name: same('Open space'), kind: 'office', x: 1, y: 1, w: 13, h: 11 },
    { id: 'tech', name: { en: 'Tech room', fr: 'Local technique' }, kind: 'server', x: 15, y: 1, w: 6, h: 5 },
    { id: 'hall', name: { en: 'Lobby & kitchen', fr: 'Accueil & cuisine' }, kind: 'lobby', x: 15, y: 7, w: 6, h: 5 },
  ],
  groups: [
    { id: 'team', name: { en: 'Team', fr: 'Équipe' }, color: COLORS.team },
    { id: 'srv', name: SERVERS, color: COLORS.srv },
  ],
  endpoints: [
    { id: 'isp', kind: 'internet', x: 21, y: 3, label: ISP, isp: 90 },
    { id: 'nas', kind: 'server', x: 19, y: 2, group: 'srv', pool: 'nas', label: same('NAS'), capacity: 16, port: 445 },
    ...pcs('pc', 'team', [
      [3, 3],
      [6, 3],
      [9, 3],
      [3, 8],
      [6, 8],
      [9, 8],
    ]),
  ],
  techBase: { x: 17, y: 9 },
  budget: 1800,
  dayLength: 110,
  features: [],
  equipment: ['switch8', 'router'],
  cables: ['rj45'],
  addressing: { mode: 'auto' },
  traffic: {
    groups: { team: { rate: 0.9, mix: { web: 0.55, stream: 0.15, data: 0.3 }, data: ['nas'] } },
    curve: 'office',
  },
  objectives: [{ kind: 'survive' }],
  stars: [
    { kind: 'avgFrustration', max: 5 },
    { kind: 'spent', max: 1400 },
  ],
  tips: [
    {
      en: 'Put the router next to the ISP line: the longest cable costs the most.',
      fr: 'Place le routeur près de l’arrivée FAI : le câble le plus long coûte le plus cher.',
    },
    {
      en: 'A switch in the middle of the open space shortens every computer cable.',
      fr: 'Un switch au centre de l’open space raccourcit tous les câbles des postes.',
    },
  ],
  guide: [
    {
      id: 'router',
      text: {
        en: 'Place a router (key 3) in the tech room, next to the ISP line.',
        fr: 'Pose un routeur (touche 3) dans le local technique, près de l’arrivée FAI.',
      },
      done: (s) => hasDevice(s, 'router'),
    },
    {
      id: 'isp',
      text: { en: 'Run an RJ45 cable (key 7) from the ISP line to the router.', fr: 'Tire un câble RJ45 (touche 7) de l’arrivée FAI jusqu’au routeur.' },
      done: (s) => linked(s, (id) => id === 'isp', isKind(s, 'router')),
    },
    {
      id: 'switch',
      text: { en: 'Place an 8-port switch (key 1) in the middle of the open space.', fr: 'Pose un switch 8 ports (touche 1) au milieu de l’open space.' },
      done: (s) => hasDevice(s, 'switch8'),
    },
    {
      id: 'uplink',
      text: { en: 'Connect the switch to the router.', fr: 'Relie le switch au routeur.' },
      done: (s) => linked(s, isKind(s, 'switch8'), isKind(s, 'router')),
    },
    {
      id: 'autocable',
      text: {
        en: 'Select the switch, then “Cable nearby computers” (or cable each computer by hand).',
        fr: 'Sélectionne le switch puis « Câbler les postes proches » (ou câble chaque poste à la main).',
      },
      done: (s) => [1, 2, 3, 4, 5, 6].every((n) => cabled(s, `pc-${n}`)),
    },
    {
      id: 'nas',
      text: { en: 'Connect the NAS too, to the router or the switch.', fr: 'Raccorde aussi le NAS, au routeur ou au switch.' },
      done: (s) => cabled(s, 'nas'),
    },
    {
      id: 'launch',
      text: { en: 'Start the day (▶) and watch the frustration gauge.', fr: 'Lance la journée (▶) et surveille la jauge de frustration.' },
      done: (s) => s.running || s.finished,
    },
  ],
  seed: 1101,
};

// ---------------------------------------------------------------------------
// Mission 2

const kiwi: LevelDef = {
  id: 'kiwi',
  order: 2,
  company: 'Studio Kiwi',
  title: { en: 'Raw 4K footage', fr: 'Rushs en 4K' },
  tagline: { en: 'Video editors moving terabytes all day long.', fr: 'Des monteurs vidéo qui déplacent des téraoctets toute la journée.' },
  brief: [
    {
      en: 'Studio Kiwi makes music videos: designers and editors constantly pull 4K footage from the NAS. Clients in the meeting room want Wi-Fi.',
      fr: 'Studio Kiwi produit des clips : graphistes et monteurs tirent en permanence des rushs 4K depuis le NAS. Les clients en réunion veulent du Wi-Fi.',
    },
    {
      en: 'An RJ45 cable carries only 1 Gb/s. Spot the bottlenecks before they drive frustration up, and keep your hardware cool.',
      fr: 'Un câble RJ45 ne transporte que 1 Gb/s. Repère les goulots d’étranglement avant qu’ils ne fassent grimper la frustration, et garde ton matériel au frais.',
    },
  ],
  newMechanics: [
    {
      title: { en: 'Bandwidth', fr: 'Débit' },
      text: {
        en: 'A saturated link holds packets in a queue. Two cables in parallel double the bandwidth.',
        fr: 'Un lien saturé retient les paquets en file d’attente. Deux câbles en parallèle doublent le débit.',
      },
    },
    {
      title: { en: 'Heat', fr: 'Chaleur' },
      text: {
        en: 'A saturated device heats up. In the air-conditioned server room it copes; elsewhere it can overheat and shut down.',
        fr: 'Un équipement saturé chauffe. En salle serveurs climatisée il tient ; ailleurs il peut surchauffer et s’éteindre.',
      },
    },
    {
      title: same('Wi-Fi'),
      text: {
        en: 'Laptops connect to the nearest access point (30 m). Radio bandwidth is shared.',
        fr: 'Les portables se connectent à la borne la plus proche (30 m). Le débit radio est partagé.',
      },
    },
  ],
  size: { w: 30, h: 18 },
  rooms: [
    { id: 'atelier', name: { en: 'Design studio', fr: 'Atelier graphisme' }, kind: 'office', x: 1, y: 1, w: 13, h: 8 },
    { id: 'montage', name: { en: 'Editing suite', fr: 'Studio montage' }, kind: 'office', x: 1, y: 10, w: 9, h: 7 },
    { id: 'reunion', name: { en: 'Meeting room', fr: 'Salle de réunion' }, kind: 'meeting', x: 11, y: 10, w: 9, h: 7 },
    { id: 'srv', name: SERVER_ROOM, kind: 'server', x: 21, y: 1, w: 8, h: 6 },
    { id: 'it', name: IT_OFFICE, kind: 'it', x: 21, y: 8, w: 8, h: 9 },
  ],
  groups: [
    { id: 'crea', name: { en: 'Designers', fr: 'Graphistes' }, color: COLORS.crea },
    { id: 'video', name: { en: 'Editors', fr: 'Monteurs' }, color: COLORS.video },
    { id: 'meet', name: { en: 'Guests (Wi-Fi)', fr: 'Invités (Wi-Fi)' }, color: COLORS.meet },
    { id: 'srv', name: SERVERS, color: COLORS.srv },
  ],
  endpoints: [
    { id: 'isp', kind: 'internet', x: 29, y: 3, label: ISP, isp: 90 },
    {
      id: 'nas',
      kind: 'server',
      x: 26,
      y: 2,
      group: 'srv',
      pool: 'rushes',
      label: { en: 'NAS-FOOTAGE', fr: 'NAS-RUSHS' },
      capacity: 30,
      port: 445,
    },
    ...pcs('pc', 'crea', [
      [3, 3],
      [6, 3],
      [9, 3],
      [12, 3],
      [3, 6],
      [6, 6],
      [9, 6],
      [12, 6],
    ]),
    ...pcs('mt', 'video', [
      [3, 12],
      [6, 12],
      [3, 15],
      [6, 15],
    ]),
    ...pcs(
      'lap',
      'meet',
      [
        [13, 12],
        [16, 12],
        [13, 15],
        [16, 15],
      ],
      'laptop',
    ),
  ],
  techBase: { x: 24, y: 12 },
  budget: 3800,
  dayLength: 130,
  features: [],
  equipment: ['switch8', 'switch24', 'router', 'ap'],
  cables: ['rj45'],
  addressing: { mode: 'auto' },
  traffic: {
    groups: {
      crea: { rate: 1.1, mix: { web: 0.35, stream: 0.1, data: 0.55 }, data: ['rushes'] },
      video: { rate: 1.7, mix: { web: 0.1, stream: 0.05, data: 0.85 }, data: ['rushes'] },
      meet: { rate: 0.6, mix: { web: 0.6, stream: 0.4 } },
    },
    curve: 'office',
  },
  events: [
    {
      kind: 'peak',
      at: 0.36,
      duration: 22,
      factor: 2.2,
      target: 'stream',
      message: { en: '12:15 · Live final: everyone starts streaming!', fr: '12:15 · Finale en direct : tout le monde lance le streaming !' },
    },
  ],
  objectives: [{ kind: 'survive' }],
  stars: [
    { kind: 'lossRate', max: 0.02 },
    { kind: 'spent', max: 3400 },
  ],
  tips: [
    {
      en: 'The NAS has two network cards: two cables to the switch double its bandwidth.',
      fr: 'Le NAS a deux cartes réseau : deux câbles vers le switch doublent son débit.',
    },
    {
      en: 'Watch the cable colors live: orange, then red when they saturate.',
      fr: 'Regarde la couleur des câbles en direct : orange puis rouge quand ils saturent.',
    },
    {
      en: 'A central 24-port switch avoids stacking uplinks.',
      fr: 'Un switch 24 ports central évite d’empiler les liens montants.',
    },
  ],
  coach: [
    {
      id: 'saturated',
      text: {
        en: 'A cable is turning red: it is saturated and packets queue up. Next time, double that link with a second cable in parallel.',
        fr: 'Un câble vire au rouge : il est saturé et les paquets font la queue. La prochaine fois, double ce lien avec un second câble en parallèle.',
      },
      when: (s) => !!s.live?.saturated,
    },
    {
      id: 'hot',
      text: {
        en: 'A device is heating up! Outside the air-conditioned server room, a saturated device can overheat and shut down.',
        fr: 'Un équipement chauffe ! Hors de la salle serveurs climatisée, un équipement saturé peut surchauffer et s’éteindre.',
      },
      when: (s) => !!s.live?.hot,
    },
  ],
  seed: 2202,
};

// ---------------------------------------------------------------------------
// Mission 3

const bionova: LevelDef = {
  id: 'bionova',
  order: 3,
  company: 'BioNova Labs',
  title: { en: 'Virtual walls', fr: 'Cloisons virtuelles' },
  tagline: { en: 'Accounting must never see the lab’s data.', fr: 'La compta ne doit jamais voir les données du labo.' },
  brief: [
    {
      en: 'BioNova Labs is preparing a patent. The security auditor will send probes all day: from accounting to the R&D data, and from the lab to the accounting ERP.',
      fr: 'BioNova Labs prépare un brevet. L’auditeur sécurité enverra toute la journée des sondes : depuis la compta vers les données R&D, et depuis le labo vers l’ERP comptable.',
    },
    {
      en: 'Split the departments into VLANs, carve up the 10.42.0.0/27 address block provided by the ISP, then filter forbidden access on the router’s firewall.',
      fr: 'Sépare les services en VLAN, découpe le bloc d’adresses 10.42.0.0/27 fourni par le FAI, puis filtre les accès interdits au pare-feu du routeur.',
    },
  ],
  newMechanics: [
    {
      title: same('VLAN'),
      text: {
        en: 'Two computers on different VLANs only talk through a router, where the firewall applies.',
        fr: 'Deux postes de VLAN différents ne se parlent qu’à travers un routeur, où le pare-feu s’applique.',
      },
    },
    {
      title: { en: 'Subnets', fr: 'Sous-réseaux' },
      text: {
        en: 'Each VLAN needs a big enough subnet: hosts + gateway. /28 = 14 addresses, /29 = 6.',
        fr: 'Chaque VLAN a besoin d’un sous-réseau assez grand : hôtes + passerelle. /28 = 14 adresses, /29 = 6.',
      },
    },
    {
      title: { en: 'Firewall', fr: 'Pare-feu' },
      text: {
        en: 'Rules are read in order; the first match wins. By default everything passes.',
        fr: 'Les règles sont lues dans l’ordre ; la première qui correspond gagne. Par défaut tout passe.',
      },
    },
  ],
  size: { w: 32, h: 18 },
  rooms: [
    { id: 'labo', name: { en: 'R&D lab', fr: 'Laboratoire R&D' }, kind: 'office', x: 1, y: 1, w: 15, h: 9 },
    { id: 'acct', name: { en: 'Accounting', fr: 'Comptabilité' }, kind: 'office', x: 1, y: 11, w: 10, h: 6 },
    { id: 'hall', name: { en: 'Lobby', fr: 'Accueil' }, kind: 'lobby', x: 12, y: 11, w: 8, h: 6 },
    { id: 'srv', name: SERVER_ROOM, kind: 'server', x: 22, y: 1, w: 9, h: 7 },
    { id: 'it', name: IT_OFFICE, kind: 'it', x: 22, y: 9, w: 9, h: 8 },
  ],
  groups: [
    { id: 'rnd', name: same('R&D'), color: COLORS.rnd },
    { id: 'acct', name: { en: 'Accounting', fr: 'Comptabilité' }, color: COLORS.acct, aliases: ['compta', 'comptabilite', 'comptabilité'] },
    { id: 'srv', name: SERVERS, color: COLORS.srv },
  ],
  endpoints: [
    { id: 'isp', kind: 'internet', x: 31, y: 4, label: ISP, isp: 90 },
    { id: 'labdata', kind: 'server', x: 24, y: 2, group: 'srv', pool: 'labdata', label: same('LABDATA'), capacity: 24, port: 445 },
    { id: 'erp', kind: 'server', x: 27, y: 2, group: 'srv', pool: 'erp', label: same('ERP'), capacity: 16, port: 1433 },
    { id: 'intranet', kind: 'server', x: 29, y: 5, group: 'srv', pool: 'intranet', label: same('INTRANET'), capacity: 20, port: 443 },
    ...pcs('rd', 'rnd', [
      [3, 3],
      [5, 3],
      [7, 3],
      [9, 3],
      [11, 3],
      [13, 3],
      [3, 6],
      [5, 6],
      [7, 6],
      [9, 6],
      [11, 6],
      [13, 6],
      [8, 8],
    ]),
    ...pcs('ac', 'acct', [
      [3, 13],
      [5, 13],
      [7, 13],
      [3, 15],
      [5, 15],
    ]),
  ],
  techBase: { x: 25, y: 12 },
  budget: 4200,
  dayLength: 140,
  features: ['vlan', 'subnets', 'firewall'],
  equipment: ['switch8', 'switch24', 'router', 'ap'],
  cables: ['rj45'],
  addressing: { mode: 'manual', block: '10.42.0.0/27' },
  traffic: {
    groups: {
      rnd: { rate: 0.6, mix: { web: 0.45, stream: 0.1, data: 0.45 }, data: ['labdata', 'labdata', 'intranet'] },
      acct: { rate: 0.6, mix: { web: 0.45, stream: 0.05, data: 0.5 }, data: ['erp', 'erp', 'intranet'] },
    },
    curve: 'office',
  },
  audits: [
    { from: 'acct', to: 'labdata', rate: 0.25, label: { en: 'Accounting → R&D data', fr: 'Compta → données R&D' } },
    { from: 'rnd', to: 'erp', rate: 0.25, label: { en: 'R&D → accounting ERP', fr: 'R&D → ERP comptable' } },
  ],
  objectives: [{ kind: 'survive' }, { kind: 'noBreach' }],
  stars: [
    { kind: 'avgFrustration', max: 5 },
    { kind: 'spent', max: 3500 },
  ],
  tips: [
    {
      en: 'Three groups, one /27 block (32 addresses): you will need a /28 and two /29s, perfectly aligned.',
      fr: 'Trois groupes, un bloc /27 (32 adresses) : il faudra un /28 et deux /29, parfaitement alignés.',
    },
    {
      en: 'Test your rules before launching: ping acct labdata tcp/445 in the console.',
      fr: 'Teste tes règles avant de lancer : ping compta labdata tcp/445 dans la console.',
    },
    {
      en: 'A single link between the switch and the router carries all inter-VLAN traffic, both ways.',
      fr: 'Un seul lien entre le switch et le routeur porte tout le trafic inter-VLAN, dans les deux sens.',
    },
  ],
  guide: [
    {
      id: 'network',
      text: {
        en: 'Build the network: router near the ISP line, switches, every computer and server connected.',
        fr: 'Monte le réseau : routeur près de l’arrivée FAI, switchs, tous les postes et serveurs raccordés.',
      },
      done: (s) => hasDevice(s, 'router') && ['isp', 'labdata', 'erp', 'intranet', 'rd-1', 'ac-1'].every((id) => cabled(s, id)),
    },
    {
      id: 'vlans',
      text: {
        en: 'Configuration phase: give each group its own VLAN (e.g. R&D 20, Accounting 10, Servers 99).',
        fr: 'Phase Configuration : donne à chaque groupe son propre VLAN (ex. R&D 20, Comptabilité 10, Serveurs 99).',
      },
      done: (s) => new Set(Object.values(s.config.vlans)).size >= 3,
    },
    {
      id: 'subnets',
      text: {
        en: 'Assign a subnet to each VLAN inside 10.42.0.0/27: a /28 for R&D, a /29 for accounting and another for the servers.',
        fr: 'Attribue un sous-réseau à chaque VLAN dans 10.42.0.0/27 : un /28 pour la R&D, un /29 pour la compta et un autre pour les serveurs.',
      },
      done: (s) => {
        const addr = computeAddressing(bionova, s.config);
        return addr.vlans.length >= 3 && addr.vlans.every((v) => v.ok) && addr.missing.length === 0;
      },
    },
    {
      id: 'rules',
      text: {
        en: 'Firewall: block the forbidden access, “fw deny acct labdata” and “fw deny rnd erp”.',
        fr: 'Pare-feu : bloque les accès interdits, « fw deny compta labdata » et « fw deny rnd erp ».',
      },
      done: (s) => s.config.rules.filter((r) => r.action === 'deny').length >= 2,
    },
    {
      id: 'trace',
      text: {
        en: 'Check with “traceroute acct labdata tcp/445”: the packet must stop at the router.',
        fr: 'Vérifie avec « traceroute compta labdata tcp/445 » : le paquet doit s’arrêter au routeur.',
      },
      done: (s) => s.commands.some((c) => c.cmd.startsWith('traceroute') || c.cmd.startsWith('ping')),
    },
    {
      id: 'launch',
      text: { en: 'Start the day and watch the audit probes (orange) get blocked.', fr: 'Lance la journée et regarde les sondes d’audit (orange) se faire bloquer.' },
      done: (s) => s.running || s.finished,
    },
  ],
  seed: 3303,
};

// ---------------------------------------------------------------------------
// Mission 4

const shopnow: LevelDef = {
  id: 'shopnow',
  order: 4,
  company: 'ShopNow',
  title: same('Black Friday'),
  tagline: {
    en: 'Three web servers, thousands of customers and someone who doesn’t like you.',
    fr: 'Trois serveurs web, des milliers de clients et quelqu’un qui ne vous aime pas.',
  },
  brief: [
    {
      en: 'ShopNow sells online. Today is Black Friday: at 11:45 customer traffic explodes, and a single server will never hold.',
      fr: 'ShopNow vend en ligne. Aujourd’hui c’est le Black Friday : à 11 h 45 le trafic client explose, et un serveur seul ne tiendra jamais.',
    },
    {
      en: 'Spread the load across the web pool, and keep an eye on the console: successful shops attract denial-of-service attacks.',
      fr: 'Répartis la charge sur le pool web, et garde un œil sur la console : les boutiques qui marchent attirent les attaques par déni de service.',
    },
  ],
  newMechanics: [
    {
      title: { en: 'Load balancing', fr: 'Répartition de charge' },
      text: {
        en: 'Without balancing, every request goes to the first server. With round-robin, they rotate across the whole pool.',
        fr: 'Sans répartition, toutes les requêtes vont au premier serveur. En round-robin, elles tournent sur tout le pool.',
      },
    },
    {
      title: same('DDoS'),
      text: {
        en: 'An attack floods a port. Find it with “top” and block it at the firewall: “block udp 123”.',
        fr: 'Une attaque inonde un port. Repère-le avec « top » et bloque-le au pare-feu : « block udp 123 ».',
      },
    },
    {
      title: { en: 'Launch-day hardware', fr: 'Matériel du jour J' },
      text: {
        en: 'Management unlocks a high-capacity router and 10 Gb/s optical fiber.',
        fr: 'La direction débloque un routeur haute capacité et la fibre optique 10 Gb/s.',
      },
    },
  ],
  size: { w: 32, h: 18 },
  rooms: [
    { id: 'plateau', name: { en: 'Main floor', fr: 'Plateau' }, kind: 'office', x: 1, y: 1, w: 13, h: 8 },
    { id: 'support', name: { en: 'Customer service', fr: 'Service client' }, kind: 'office', x: 1, y: 10, w: 13, h: 7 },
    { id: 'srv', name: SERVER_ROOM, kind: 'server', x: 17, y: 1, w: 14, h: 8 },
    { id: 'it', name: IT_OFFICE, kind: 'it', x: 17, y: 10, w: 14, h: 7 },
  ],
  groups: [
    { id: 'staff', name: { en: 'ShopNow team', fr: 'Équipe ShopNow' }, color: COLORS.staff },
    { id: 'srv', name: SERVERS, color: COLORS.srv },
  ],
  endpoints: [
    { id: 'isp', kind: 'internet', x: 31, y: 4, label: ISP, isp: 180 },
    { id: 'web-1', kind: 'server', x: 20, y: 3, group: 'srv', pool: 'web', capacity: 11, port: 443 },
    { id: 'web-2', kind: 'server', x: 23, y: 3, group: 'srv', pool: 'web', capacity: 11, port: 443 },
    { id: 'web-3', kind: 'server', x: 26, y: 3, group: 'srv', pool: 'web', capacity: 11, port: 443 },
    ...pcs('pc', 'staff', [
      [3, 3],
      [6, 3],
      [9, 3],
      [3, 6],
      [6, 6],
      [9, 6],
      [3, 12],
      [6, 12],
      [3, 15],
      [6, 15],
    ]),
  ],
  techBase: { x: 22, y: 13 },
  budget: 6000,
  dayLength: 150,
  features: ['firewall', 'lb'],
  equipment: ['switch8', 'switch24', 'router', 'router_pro', 'ap'],
  cables: ['rj45', 'fiber'],
  addressing: { mode: 'auto' },
  traffic: {
    groups: { staff: { rate: 0.7, mix: { web: 0.6, stream: 0.1, data: 0.3 }, data: ['web'] } },
    customers: { pool: 'web', rate: 10 },
    curve: 'shop',
  },
  events: [
    {
      kind: 'peak',
      at: 0.3,
      duration: 40,
      factor: 2.2,
      target: 'customers',
      message: {
        en: '11:45 · Black Friday kicks off: customer traffic doubles!',
        fr: '11:45 · Lancement du Black Friday : le trafic client double !',
      },
    },
    {
      kind: 'ddos',
      at: 0.62,
      duration: 45,
      rate: 70,
      ramp: 4,
      target: 'web',
      proto: 'udp',
      port: 123,
      sources: '45.155.0.0/16',
      name: { en: 'NTP amplification', fr: 'Amplification NTP' },
    },
  ],
  objectives: [{ kind: 'survive' }, { kind: 'service', pool: 'web', min: 0.85 }],
  stars: [
    { kind: 'mitigation', max: 20 },
    { kind: 'avgFrustration', max: 8 },
  ],
  tips: [
    {
      en: 'Set up load balancing for the web pool before launching (Configuration phase).',
      fr: 'Configure la répartition de charge du pool web avant de lancer (phase Configuration).',
    },
    {
      en: 'During the attack, type “top”: the abnormal port stands out.',
      fr: 'Pendant l’attaque, tape « top » : le port anormal saute aux yeux.',
    },
    {
      en: 'The SMB router tops out at 2.5 Gb/s: will customer traffic get through?',
      fr: 'Le routeur PME plafonne à 2,5 Gb/s : le trafic client passera-t-il ?',
    },
  ],
  guide: [
    {
      id: 'network',
      text: {
        en: 'Connect the three web servers and the staff; a high-capacity router copes better with customers.',
        fr: 'Raccorde les trois serveurs web et l’équipe ; un routeur haute capacité encaisse mieux les clients.',
      },
      done: (s) => ['isp', 'web-1', 'web-2', 'web-3', 'pc-1'].every((id) => cabled(s, id)),
    },
    {
      id: 'lb',
      text: {
        en: 'Configuration phase: set the WEB pool to round-robin so the three servers share the load.',
        fr: 'Phase Configuration : passe le pool WEB en round-robin pour que les trois serveurs se partagent la charge.',
      },
      done: (s) => (s.config.lb.web ?? 'none') !== 'none',
    },
    {
      id: 'launch',
      text: { en: 'Start the day. At 14:35, be ready at the console.', fr: 'Lance la journée. À 14 h 35, tiens-toi prêt à la console.' },
      done: (s) => s.running || s.finished,
    },
  ],
  coach: [
    {
      id: 'ddos',
      text: {
        en: 'Attack in progress! Type “top” in the console: the port marked ⚠ is the vector. Block it with “block udp 123”, or with the Block button in the router’s inspector.',
        fr: 'Attaque en cours ! Tape « top » dans la console : le port marqué ⚠ est le vecteur. Bloque-le avec « block udp 123 », ou le bouton Bloquer de l’inspecteur du routeur.',
      },
      when: (s) => !!s.live?.active.includes('ddos'),
      done: (s) => !!s.live && !s.live.active.includes('ddos'),
      target: () => ({ ui: 'console' }),
    },
  ],
  seed: 4404,
};

// ---------------------------------------------------------------------------
// Mission 5

const helios: LevelDef = {
  id: 'helios',
  order: 5,
  company: 'Helios Group',
  title: { en: 'Perfect storm', fr: 'Tempête parfaite' },
  tagline: {
    en: 'Headquarters, three departments, and a day when everything happens at once.',
    fr: 'Le siège, trois services, et une journée où tout arrive en même temps.',
  },
  brief: [
    {
      en: 'You take over Helios Group headquarters: marketing, development and finance, a customer portal and a server room. The CISO warned you: it will be a rough day.',
      fr: 'Tu prends en main le siège d’Helios Group : marketing, développement et finance, un portail client et une salle serveurs. Le RSSI a prévenu : la journée sera agitée.',
    },
    {
      en: 'Plan ahead: a switch will fail, a marketing computer will catch a worm, and a botnet targets the customer portal in the late afternoon.',
      fr: 'Anticipe : un switch va lâcher, un poste du marketing va attraper un ver, et un botnet vise le portail client en fin d’après-midi.',
    },
  ],
  newMechanics: [
    {
      title: { en: 'Failures', fr: 'Pannes' },
      text: {
        en: 'Select the failed device, then “Send a technician”. They walk across the floor: place your racks wisely.',
        fr: 'Sélectionne l’équipement en panne puis « Envoyer un technicien ». Il traverse l’étage à pied : place bien tes baies.',
      },
    },
    {
      title: { en: 'Computer worm', fr: 'Ver informatique' },
      text: {
        en: 'An infected computer scans the network. Find it (“top src”), isolate it (“quarantine”), then have it cleaned.',
        fr: 'Un poste infecté balaye le réseau. Repère-le (« top src »), isole-le (« quarantine »), puis fais-le nettoyer.',
      },
    },
    {
      title: { en: 'HTTP flood', fr: 'Flood HTTP' },
      text: {
        en: 'You can’t block port 443 without cutting off customers: block the botnet’s address range instead.',
        fr: 'Impossible de bloquer le port 443 sans couper les clients : bloque plutôt la plage d’adresses du botnet.',
      },
    },
  ],
  size: { w: 36, h: 22 },
  rooms: [
    { id: 'mkt', name: same('Marketing'), kind: 'office', x: 1, y: 1, w: 14, h: 9 },
    { id: 'lounge', name: { en: 'Break room', fr: 'Espace détente' }, kind: 'meeting', x: 17, y: 1, w: 9, h: 9 },
    { id: 'dev', name: { en: 'Development', fr: 'Développement' }, kind: 'office', x: 1, y: 12, w: 14, h: 9 },
    { id: 'fin', name: same('Finance'), kind: 'office', x: 17, y: 12, w: 9, h: 9 },
    { id: 'srv', name: SERVER_ROOM, kind: 'server', x: 28, y: 1, w: 7, h: 10 },
    { id: 'it', name: IT_OFFICE, kind: 'it', x: 28, y: 12, w: 7, h: 9 },
  ],
  groups: [
    { id: 'mkt', name: same('Marketing'), color: COLORS.mkt },
    { id: 'dev', name: { en: 'Development', fr: 'Développement' }, color: COLORS.dev },
    { id: 'fin', name: same('Finance'), color: COLORS.fin },
    { id: 'srv', name: SERVERS, color: COLORS.srv },
  ],
  endpoints: [
    { id: 'isp', kind: 'internet', x: 35, y: 4, label: ISP, isp: 120 },
    { id: 'files', kind: 'server', x: 30, y: 2, group: 'srv', pool: 'files', label: { en: 'FILES', fr: 'FICHIERS' }, capacity: 30, port: 445 },
    { id: 'git', kind: 'server', x: 33, y: 2, group: 'srv', pool: 'git', label: same('GIT'), capacity: 24, port: 22 },
    {
      id: 'portal-1',
      kind: 'server',
      x: 30,
      y: 7,
      group: 'srv',
      pool: 'portal',
      label: { en: 'PORTAL-1', fr: 'PORTAIL-1' },
      capacity: 10,
      port: 443,
    },
    {
      id: 'portal-2',
      kind: 'server',
      x: 33,
      y: 7,
      group: 'srv',
      pool: 'portal',
      label: { en: 'PORTAL-2', fr: 'PORTAIL-2' },
      capacity: 10,
      port: 443,
    },
    ...pcs('pm', 'mkt', [
      [3, 3],
      [6, 3],
      [9, 3],
      [12, 3],
      [3, 7],
      [6, 7],
      [9, 7],
      [12, 7],
    ]),
    ...pcs(
      'lm',
      'mkt',
      [
        [19, 4],
        [23, 4],
        [19, 7],
        [23, 7],
      ],
      'laptop',
    ),
    ...pcs('pd', 'dev', [
      [3, 14],
      [6, 14],
      [9, 14],
      [12, 14],
      [3, 18],
      [6, 18],
      [9, 18],
      [12, 18],
    ]),
    ...pcs('pf', 'fin', [
      [19, 14],
      [22, 14],
      [19, 18],
      [22, 18],
    ]),
  ],
  techBase: { x: 31, y: 16 },
  budget: 9500,
  dayLength: 200,
  features: ['vlan', 'firewall', 'lb', 'quarantine'],
  equipment: ['switch8', 'switch24', 'router', 'router_pro', 'ap'],
  cables: ['rj45'],
  addressing: { mode: 'auto' },
  traffic: {
    groups: {
      mkt: { rate: 0.6, mix: { web: 0.55, stream: 0.2, data: 0.25 }, data: ['files'] },
      dev: { rate: 0.7, mix: { web: 0.4, stream: 0.05, data: 0.55 }, data: ['git', 'git', 'files'] },
      fin: { rate: 0.55, mix: { web: 0.4, stream: 0.05, data: 0.55 }, data: ['files'] },
    },
    customers: { pool: 'portal', rate: 5 },
    curve: 'office',
  },
  audits: [{ from: 'mkt', to: 'fin', rate: 0.2, label: { en: 'Marketing → Finance computers', fr: 'Marketing → postes Finance' } }],
  events: [
    { kind: 'failure', at: 0.2, target: 'auto', deadline: 40 },
    { kind: 'worm', at: 0.42, patient: 'pm-6', rate: 3.5, chance: 0.03 },
    {
      kind: 'ddos',
      at: 0.7,
      duration: 45,
      rate: 40,
      ramp: 6,
      target: 'portal',
      proto: 'tcp',
      port: 443,
      sources: '185.220.0.0/16',
      name: { en: 'HTTP flood (botnet)', fr: 'Flood HTTP (botnet)' },
    },
  ],
  objectives: [{ kind: 'survive' }, { kind: 'noBreach' }, { kind: 'incidents' }, { kind: 'infected', max: 8 }],
  stars: [
    { kind: 'avgFrustration', max: 12 },
    { kind: 'mitigation', max: 25 },
  ],
  tips: [
    {
      en: 'Per-department VLANs slow the worm down: between two VLANs, the firewall can cut TCP/445.',
      fr: 'Des VLAN par service freinent le ver : entre deux VLAN, le pare-feu peut couper TCP/445.',
    },
    {
      en: 'Keep a rack near the IT office: the technician will get there faster.',
      fr: 'Garde une baie près du Bureau IT : le technicien arrivera plus vite.',
    },
    {
      en: 'During the flood, “top src” reveals the botnet’s address range.',
      fr: 'Pendant le flood, « top src » révèle la plage d’adresses du botnet.',
    },
  ],
  coach: [
    {
      id: 'failure',
      text: {
        en: 'A switch has failed! Click it, then “Send a technician” (or type “dispatch” followed by its name). You have 40 seconds.',
        fr: 'Un switch est en panne ! Clique dessus puis « Envoyer un technicien » (ou tape « dispatch » suivi de son nom). Tu as 40 secondes.',
      },
      when: (s) => !!s.live?.active.includes('failure'),
      done: (s) => !!s.live && !s.live.active.includes('failure'),
      target: (s) => (s.live?.failed[0] ? { node: s.live.failed[0] } : null),
    },
    {
      id: 'worm',
      text: {
        en: 'A worm is spreading! “top src” flags infected computers (⚠). Isolate them with “quarantine pm-6”, then clean them with “dispatch pm-6”.',
        fr: 'Un ver se propage ! « top src » signale les postes infectés (⚠). Isole-les avec « quarantine pm-6 », puis nettoie-les avec « dispatch pm-6 ».',
      },
      when: (s) => !!s.live?.active.includes('worm'),
      done: (s) => !!s.live && !s.live.active.includes('worm'),
      target: (s) => (s.live?.infected[0] ? { node: s.live.infected[0] } : { ui: 'console' }),
    },
    {
      id: 'flood',
      text: {
        en: 'HTTP flood on the portal: blocking port 443 would cut off customers. “top src” reveals the botnet’s range; block it with “blockip”.',
        fr: 'Flood HTTP sur le portail : bloquer le port 443 couperait les clients. « top src » révèle la plage du botnet ; bloque-la avec « blockip ».',
      },
      when: (s) => !!s.live?.active.includes('ddos'),
      done: (s) => !!s.live && !s.live.active.includes('ddos'),
      target: () => ({ ui: 'console' }),
    },
  ],
  seed: 5505,
};

export const TRAINING = training;

/** Every mission, training included, in campaign order. */
export const LEVELS: LevelDef[] = [training, pixelbrew, kiwi, bionova, shopnow, helios];

/** Missions that count for stars, scores and rankings (training excluded). */
export const CAMPAIGN: LevelDef[] = LEVELS.filter((l) => l.order > 0);

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
