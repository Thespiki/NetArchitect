// Arbre de compétences : points gagnés avec les étoiles des missions.

import type { SkillId } from './types.ts';

export type Branch = 'infra' | 'secu' | 'ops';

export interface SkillDef {
  id: SkillId;
  name: string;
  branch: Branch;
  tier: number;
  cost: number;
  requires: SkillId[];
  desc: string;
}

export const BRANCHES: { id: Branch; name: string; blurb: string }[] = [
  { id: 'infra', name: 'Infrastructure', blurb: 'Plus de débit, plus de fraîcheur.' },
  { id: 'secu', name: 'Sécurité', blurb: 'Voir venir les attaques et les couper net.' },
  { id: 'ops', name: 'Exploitation', blurb: 'Automatiser le quotidien du SysAdmin.' },
];

export const SKILLS: SkillDef[] = [
  {
    id: 'fiber',
    name: 'Fibre optique 10 Gb/s',
    branch: 'infra',
    tier: 0,
    cost: 1,
    requires: [],
    desc: 'Débloque la fibre : dix fois le débit du RJ45 et jusqu’à 500 m de portée.',
  },
  {
    id: 'cooling',
    name: 'Climatisation de précision',
    branch: 'infra',
    tier: 0,
    cost: 1,
    requires: [],
    desc: 'Refroidissement +35 % dans toutes les pièces : le matériel chauffe moins vite.',
  },
  {
    id: 'switch_l3',
    name: 'Switch niveau 3',
    branch: 'infra',
    tier: 1,
    cost: 2,
    requires: ['fiber'],
    desc: 'Routage inter-VLAN et pare-feu à 11 Gb/s, directement dans le switch de cœur.',
  },
  {
    id: 'router_pro',
    name: 'Routeur haute capacité',
    branch: 'infra',
    tier: 2,
    cost: 2,
    requires: ['switch_l3'],
    desc: '8 ports et 8 Gb/s de routage avec NAT : fini les goulots vers Internet.',
  },
  {
    id: 'ids',
    name: 'Sonde IDS',
    branch: 'secu',
    tier: 0,
    cost: 1,
    requires: [],
    desc: 'Identifie seule le vecteur d’une attaque (port, plage source, poste compromis) et propose la parade.',
  },
  {
    id: 'ratelimit',
    name: 'Limitation de débit',
    branch: 'secu',
    tier: 1,
    cost: 1,
    requires: ['ids'],
    desc: 'Commande ratelimit : plafonne un port sans le couper complètement.',
  },
  {
    id: 'autoblock',
    name: 'Script d’auto-mitigation',
    branch: 'secu',
    tier: 2,
    cost: 2,
    requires: ['ids'],
    desc: 'Six secondes après la détection, le script pose lui-même la règle de blocage.',
  },
  {
    id: 'snmp',
    name: 'Supervision SNMP',
    branch: 'ops',
    tier: 0,
    cost: 1,
    requires: [],
    desc: 'Charge et température de chaque équipement affichées en permanence sur le plan.',
  },
  {
    id: 'tech_speed',
    name: 'Trottinette électrique',
    branch: 'ops',
    tier: 0,
    cost: 1,
    requires: [],
    desc: 'Les techniciens traversent l’étage 60 % plus vite.',
  },
  {
    id: 'autovlan',
    name: 'Script Auto-VLAN & IPAM',
    branch: 'ops',
    tier: 1,
    cost: 2,
    requires: ['snmp'],
    desc: 'Un clic : un VLAN par service et un plan d’adressage VLSM calculé pour toi.',
  },
  {
    id: 'lb_least',
    name: 'Répartition adaptative',
    branch: 'ops',
    tier: 1,
    cost: 1,
    requires: ['snmp'],
    desc: 'Algorithme « moins de connexions » : chaque requête va au serveur le moins chargé.',
  },
  {
    id: 'tech2',
    name: 'Second technicien',
    branch: 'ops',
    tier: 2,
    cost: 2,
    requires: ['tech_speed'],
    desc: 'Un deuxième technicien rejoint l’équipe : deux incidents traités en parallèle.',
  },
];

export function skillById(id: SkillId): SkillDef {
  return SKILLS.find((s) => s.id === id)!;
}

export function canBuy(id: SkillId, owned: ReadonlySet<SkillId>, points: number): boolean {
  const s = skillById(id);
  return !owned.has(id) && points >= s.cost && s.requires.every((r) => owned.has(r));
}

export function spentPoints(owned: Iterable<SkillId>): number {
  let n = 0;
  for (const id of owned) n += skillById(id).cost;
  return n;
}
