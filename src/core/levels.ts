// Campagne : du technicien support de start-up à l'architecte du siège d'un groupe.

import type { EndpointDef, GuideState, LevelDef } from './level.ts';

const COLORS = {
  team: '#9fb3d9',
  srv: '#c0c7d4',
  crea: '#d6a6c9',
  video: '#c9b48a',
  meet: '#9fc7d9',
  rnd: '#8fd0c0',
  compta: '#e0c48c',
  staff: '#b0b8e8',
  mkt: '#e3a3a3',
  dev: '#94d4b4',
  fin: '#e0c48c',
};

function pcs(prefix: string, group: string, cells: [number, number][], kind: EndpointDef['kind'] = 'workstation'): EndpointDef[] {
  return cells.map(([x, y], i) => ({ id: `${prefix}-${i + 1}`, kind, x, y, group }));
}

const has = (s: GuideState, kind: string) => s.devices.some((d) => d.kind === kind);
const linked = (s: GuideState, a: (id: string) => boolean, b: (id: string) => boolean) =>
  s.cables.some((c) => (a(c.a) && b(c.b)) || (a(c.b) && b(c.a)));
const isKind = (s: GuideState, kind: string) => (id: string) => s.devices.some((d) => d.id === id && d.kind === kind);
const cabled = (s: GuideState, id: string) => s.cables.some((c) => c.a === id || c.b === id);

// ---------------------------------------------------------------------------
// Mission 1

const pixelbrew: LevelDef = {
  id: 'pixelbrew',
  order: 1,
  company: 'PixelBrew',
  title: 'Premier jour',
  rank: 'Technicien support',
  tagline: 'Six développeurs, une box fibre et zéro câble.',
  brief: [
    'PixelBrew, studio de jeux indé, emménage ce matin. Les postes sont sur les bureaux, la fibre de l’opérateur arrive dans le local technique… et rien n’est branché.',
    'Monte un réseau simple : un routeur pour partager Internet, un switch pour relier l’open space, et le NAS où l’équipe range ses projets.',
  ],
  newMechanics: [
    { title: 'Budget', text: 'Chaque équipement et chaque mètre de câble coûtent. Le budget restant s’affiche en haut.' },
    { title: 'Routeur', text: 'L’arrivée FAI se branche sur un routeur : c’est lui qui partage l’accès Internet (NAT).' },
    { title: 'Switch', text: 'Le switch relie les postes entre eux et vers le routeur. Un RJ45 porte au maximum 100 m.' },
  ],
  size: { w: 22, h: 13 },
  rooms: [
    { id: 'open', name: 'Open space', kind: 'office', x: 1, y: 1, w: 13, h: 11 },
    { id: 'tech', name: 'Local technique', kind: 'server', x: 15, y: 1, w: 6, h: 5 },
    { id: 'hall', name: 'Accueil & cuisine', kind: 'lobby', x: 15, y: 7, w: 6, h: 5 },
  ],
  groups: [
    { id: 'team', name: 'Équipe', color: COLORS.team },
    { id: 'srv', name: 'Serveurs', color: COLORS.srv },
  ],
  endpoints: [
    { id: 'fai', kind: 'internet', x: 21, y: 3, label: 'FAI', isp: 90 },
    { id: 'nas', kind: 'server', x: 19, y: 2, group: 'srv', pool: 'nas', label: 'NAS', capacity: 16, port: 445 },
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
    'Place le routeur près de l’arrivée FAI : le câble le plus long coûte le plus cher.',
    'Un switch au centre de l’open space raccourcit tous les câbles des postes.',
  ],
  guide: [
    { text: 'Pose un routeur (touche 3) dans le local technique, près de l’arrivée FAI.', done: (s) => has(s, 'router') },
    {
      text: 'Tire un câble RJ45 (touche 7) de l’arrivée FAI jusqu’au routeur.',
      done: (s) => linked(s, (id) => id === 'fai', isKind(s, 'router')),
    },
    { text: 'Pose un switch 8 ports (touche 1) au milieu de l’open space.', done: (s) => has(s, 'switch8') },
    { text: 'Relie le switch au routeur.', done: (s) => linked(s, isKind(s, 'switch8'), isKind(s, 'router')) },
    {
      text: 'Sélectionne le switch puis « Câbler les postes proches » (ou câble chaque poste à la main).',
      done: (s) => [1, 2, 3, 4, 5, 6].every((n) => cabled(s, `pc-${n}`)),
    },
    { text: 'Raccorde aussi le NAS, au routeur ou au switch.', done: (s) => cabled(s, 'nas') },
    { text: 'Lance la journée (▶) et surveille la jauge de frustration.', done: (s) => s.running },
  ],
  seed: 1101,
};

// ---------------------------------------------------------------------------
// Mission 2

const kiwi: LevelDef = {
  id: 'kiwi',
  order: 2,
  company: 'Studio Kiwi',
  title: 'Rushs en 4K',
  rank: 'Technicien réseau',
  tagline: 'Des monteurs vidéo qui déplacent des téraoctets toute la journée.',
  brief: [
    'Studio Kiwi produit des clips : graphistes et monteurs tirent en permanence des rushs 4K depuis le NAS. Les clients en réunion veulent du Wi-Fi.',
    'Un câble RJ45 ne transporte que 1 Gb/s. Repère les goulots d’étranglement avant qu’ils ne fassent grimper la frustration, et garde ton matériel au frais.',
  ],
  newMechanics: [
    { title: 'Débit', text: 'Un lien saturé retient les paquets en file d’attente. Deux câbles en parallèle doublent le débit.' },
    { title: 'Chaleur', text: 'Un équipement saturé chauffe. En salle serveurs climatisée il tient ; ailleurs il peut surchauffer et s’éteindre.' },
    { title: 'Wi-Fi', text: 'Les portables se connectent à la borne la plus proche (30 m). Le débit radio est partagé.' },
  ],
  size: { w: 30, h: 18 },
  rooms: [
    { id: 'atelier', name: 'Atelier graphisme', kind: 'office', x: 1, y: 1, w: 13, h: 8 },
    { id: 'montage', name: 'Studio montage', kind: 'office', x: 1, y: 10, w: 9, h: 7 },
    { id: 'reunion', name: 'Salle de réunion', kind: 'meeting', x: 11, y: 10, w: 9, h: 7 },
    { id: 'srv', name: 'Salle serveurs', kind: 'server', x: 21, y: 1, w: 8, h: 6 },
    { id: 'it', name: 'Bureau IT', kind: 'it', x: 21, y: 8, w: 8, h: 9 },
  ],
  groups: [
    { id: 'crea', name: 'Graphistes', color: COLORS.crea },
    { id: 'video', name: 'Monteurs', color: COLORS.video },
    { id: 'meet', name: 'Invités (Wi-Fi)', color: COLORS.meet },
    { id: 'srv', name: 'Serveurs', color: COLORS.srv },
  ],
  endpoints: [
    { id: 'fai', kind: 'internet', x: 29, y: 3, label: 'FAI', isp: 90 },
    { id: 'nas', kind: 'server', x: 26, y: 2, group: 'srv', pool: 'rushs', label: 'NAS-RUSHS', capacity: 30, port: 445 },
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
      crea: { rate: 1.1, mix: { web: 0.35, stream: 0.1, data: 0.55 }, data: ['rushs'] },
      video: { rate: 1.7, mix: { web: 0.1, stream: 0.05, data: 0.85 }, data: ['rushs'] },
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
      message: '12:15 · Finale en direct : tout le monde lance le streaming !',
    },
  ],
  objectives: [{ kind: 'survive' }],
  stars: [
    { kind: 'lossRate', max: 0.02 },
    { kind: 'spent', max: 3400 },
  ],
  tips: [
    'Le NAS a deux cartes réseau : deux câbles vers le switch doublent son débit.',
    'Regarde la couleur des câbles en direct : orange puis rouge quand ils saturent.',
    'Un switch 24 ports central évite d’empiler les liens montants.',
  ],
  seed: 2202,
};

// ---------------------------------------------------------------------------
// Mission 3

const bionova: LevelDef = {
  id: 'bionova',
  order: 3,
  company: 'BioNova Labs',
  title: 'Cloisons virtuelles',
  rank: 'Administrateur système',
  tagline: 'La compta ne doit jamais voir les données du labo.',
  brief: [
    'BioNova Labs prépare un brevet. L’auditeur sécurité enverra toute la journée des sondes : depuis la compta vers les données R&D, et depuis le labo vers l’ERP comptable.',
    'Sépare les services en VLAN, découpe le bloc d’adresses 10.42.0.0/27 fourni par le FAI, puis filtre les accès interdits au pare-feu du routeur.',
  ],
  newMechanics: [
    { title: 'VLAN', text: 'Deux postes de VLAN différents ne se parlent qu’à travers un routeur, où le pare-feu s’applique.' },
    { title: 'Sous-réseaux', text: 'Chaque VLAN a besoin d’un sous-réseau assez grand : hôtes + passerelle. /28 = 14 adresses, /29 = 6.' },
    { title: 'Pare-feu', text: 'Les règles sont lues dans l’ordre ; la première qui correspond gagne. Par défaut tout passe.' },
  ],
  size: { w: 32, h: 18 },
  rooms: [
    { id: 'labo', name: 'Laboratoire R&D', kind: 'office', x: 1, y: 1, w: 15, h: 9 },
    { id: 'compta', name: 'Comptabilité', kind: 'office', x: 1, y: 11, w: 10, h: 6 },
    { id: 'hall', name: 'Accueil', kind: 'lobby', x: 12, y: 11, w: 8, h: 6 },
    { id: 'srv', name: 'Salle serveurs', kind: 'server', x: 22, y: 1, w: 9, h: 7 },
    { id: 'it', name: 'Bureau IT', kind: 'it', x: 22, y: 9, w: 9, h: 8 },
  ],
  groups: [
    { id: 'rnd', name: 'R&D', color: COLORS.rnd },
    { id: 'compta', name: 'Comptabilité', color: COLORS.compta },
    { id: 'srv', name: 'Serveurs', color: COLORS.srv },
  ],
  endpoints: [
    { id: 'fai', kind: 'internet', x: 31, y: 4, label: 'FAI', isp: 90 },
    { id: 'labdata', kind: 'server', x: 24, y: 2, group: 'srv', pool: 'labdata', label: 'LABDATA', capacity: 24, port: 445 },
    { id: 'erp', kind: 'server', x: 27, y: 2, group: 'srv', pool: 'erp', label: 'ERP', capacity: 16, port: 1433 },
    { id: 'intranet', kind: 'server', x: 29, y: 5, group: 'srv', pool: 'intranet', label: 'INTRANET', capacity: 20, port: 443 },
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
    ...pcs('cp', 'compta', [
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
      compta: { rate: 0.6, mix: { web: 0.45, stream: 0.05, data: 0.5 }, data: ['erp', 'erp', 'intranet'] },
    },
    curve: 'office',
  },
  audits: [
    { from: 'compta', to: 'labdata', rate: 0.25, label: 'Compta → données R&D' },
    { from: 'rnd', to: 'erp', rate: 0.25, label: 'R&D → ERP comptable' },
  ],
  objectives: [{ kind: 'survive' }, { kind: 'noBreach' }],
  stars: [
    { kind: 'avgFrustration', max: 5 },
    { kind: 'spent', max: 3500 },
  ],
  tips: [
    'Trois groupes, un bloc /27 (32 adresses) : il faudra un /28 et deux /29, parfaitement alignés.',
    'Teste tes règles avant de lancer : ping compta labdata tcp/445 dans la console.',
    'Un seul lien entre le switch et le routeur porte tout le trafic inter-VLAN, dans les deux sens.',
  ],
  seed: 3303,
};

// ---------------------------------------------------------------------------
// Mission 4

const shopnow: LevelDef = {
  id: 'shopnow',
  order: 4,
  company: 'ShopNow',
  title: 'Black Friday',
  rank: 'Ingénieur réseau',
  tagline: 'Trois serveurs web, des milliers de clients et quelqu’un qui ne vous aime pas.',
  brief: [
    'ShopNow vend en ligne. Aujourd’hui c’est le Black Friday : à 11 h 45 le trafic client explose, et un serveur seul ne tiendra jamais.',
    'Répartis la charge sur le pool web, et garde un œil sur la console : les boutiques qui marchent attirent les attaques par déni de service.',
  ],
  newMechanics: [
    { title: 'Répartition de charge', text: 'Sans répartition, toutes les requêtes vont au premier serveur. En round-robin, elles tournent sur tout le pool.' },
    { title: 'DDoS', text: 'Une attaque inonde un port. Repère-le avec « top » et bloque-le au pare-feu : « block udp 123 ».' },
    { title: 'Matériel du jour J', text: 'La direction débloque un routeur haute capacité et la fibre optique 10 Gb/s.' },
  ],
  size: { w: 32, h: 18 },
  rooms: [
    { id: 'plateau', name: 'Plateau', kind: 'office', x: 1, y: 1, w: 13, h: 8 },
    { id: 'support', name: 'Service client', kind: 'office', x: 1, y: 10, w: 13, h: 7 },
    { id: 'srv', name: 'Salle serveurs', kind: 'server', x: 17, y: 1, w: 14, h: 8 },
    { id: 'it', name: 'Bureau IT', kind: 'it', x: 17, y: 10, w: 14, h: 7 },
  ],
  groups: [
    { id: 'staff', name: 'Équipe ShopNow', color: COLORS.staff },
    { id: 'srv', name: 'Serveurs', color: COLORS.srv },
  ],
  endpoints: [
    { id: 'fai', kind: 'internet', x: 31, y: 4, label: 'FAI', isp: 180 },
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
      message: '11:45 · Lancement du Black Friday : le trafic client double !',
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
      name: 'Amplification NTP',
    },
  ],
  objectives: [{ kind: 'survive' }, { kind: 'service', pool: 'web', min: 0.85 }],
  stars: [
    { kind: 'mitigation', max: 20 },
    { kind: 'avgFrustration', max: 8 },
  ],
  tips: [
    'Configure la répartition de charge du pool web avant de lancer (phase Configuration).',
    'Pendant l’attaque, tape « top » : le port anormal saute aux yeux.',
    'Le routeur PME plafonne à 2,5 Gb/s : le trafic client passera-t-il ?',
  ],
  seed: 4404,
};

// ---------------------------------------------------------------------------
// Mission 5

const helios: LevelDef = {
  id: 'helios',
  order: 5,
  company: 'Helios Group',
  title: 'Tempête parfaite',
  rank: 'Architecte réseau',
  tagline: 'Le siège, trois services, et une journée où tout arrive en même temps.',
  brief: [
    'Tu prends en main le siège d’Helios Group : marketing, développement et finance, un portail client et une salle serveurs. Le RSSI a prévenu : la journée sera agitée.',
    'Anticipe : un switch va lâcher, un poste du marketing va attraper un ver, et un botnet vise le portail client en fin d’après-midi.',
  ],
  newMechanics: [
    { title: 'Pannes', text: 'Sélectionne l’équipement en panne puis « Envoyer un technicien ». Il traverse l’étage à pied : place bien tes baies.' },
    { title: 'Ver informatique', text: 'Un poste infecté balaye le réseau. Repère-le (« top src »), isole-le (« quarantine »), puis fais-le nettoyer.' },
    { title: 'Flood HTTP', text: 'Impossible de bloquer le port 443 sans couper les clients : bloque plutôt la plage d’adresses du botnet.' },
  ],
  size: { w: 36, h: 22 },
  rooms: [
    { id: 'mkt', name: 'Marketing', kind: 'office', x: 1, y: 1, w: 14, h: 9 },
    { id: 'lounge', name: 'Espace détente', kind: 'meeting', x: 17, y: 1, w: 9, h: 9 },
    { id: 'dev', name: 'Développement', kind: 'office', x: 1, y: 12, w: 14, h: 9 },
    { id: 'fin', name: 'Finance', kind: 'office', x: 17, y: 12, w: 9, h: 9 },
    { id: 'srv', name: 'Salle serveurs', kind: 'server', x: 28, y: 1, w: 7, h: 10 },
    { id: 'it', name: 'Bureau IT', kind: 'it', x: 28, y: 12, w: 7, h: 9 },
  ],
  groups: [
    { id: 'mkt', name: 'Marketing', color: COLORS.mkt },
    { id: 'dev', name: 'Développement', color: COLORS.dev },
    { id: 'fin', name: 'Finance', color: COLORS.fin },
    { id: 'srv', name: 'Serveurs', color: COLORS.srv },
  ],
  endpoints: [
    { id: 'fai', kind: 'internet', x: 35, y: 4, label: 'FAI', isp: 120 },
    { id: 'files', kind: 'server', x: 30, y: 2, group: 'srv', pool: 'files', label: 'FICHIERS', capacity: 30, port: 445 },
    { id: 'git', kind: 'server', x: 33, y: 2, group: 'srv', pool: 'git', label: 'GIT', capacity: 24, port: 22 },
    { id: 'portal-1', kind: 'server', x: 30, y: 7, group: 'srv', pool: 'portal', label: 'PORTAIL-1', capacity: 10, port: 443 },
    { id: 'portal-2', kind: 'server', x: 33, y: 7, group: 'srv', pool: 'portal', label: 'PORTAIL-2', capacity: 10, port: 443 },
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
  audits: [{ from: 'mkt', to: 'fin', rate: 0.2, label: 'Marketing → postes Finance' }],
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
      name: 'Flood HTTP (botnet)',
    },
  ],
  objectives: [{ kind: 'survive' }, { kind: 'noBreach' }, { kind: 'incidents' }, { kind: 'infected', max: 8 }],
  stars: [
    { kind: 'avgFrustration', max: 12 },
    { kind: 'mitigation', max: 25 },
  ],
  tips: [
    'Des VLAN par service freinent le ver : entre deux VLAN, le pare-feu peut couper TCP/445.',
    'Garde une baie près du Bureau IT : le technicien arrivera plus vite.',
    'Pendant le flood, « top src » révèle la plage d’adresses du botnet.',
  ],
  seed: 5505,
};

export const LEVELS: LevelDef[] = [pixelbrew, kiwi, bionova, shopnow, helios];

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}
