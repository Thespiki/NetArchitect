// Console de commandes simplifiée (inspirée de Hacknet) : configuration, diagnostic et gestion de crise.

import { tempCelsius } from './catalog.ts';
import {
  autoPlan,
  cloneConfig,
  computeAddressing,
  formatRule,
  formatService,
  parseSelector,
  parseService,
  type NetConfig,
} from './config.ts';
import { ICMP, probe, resolveHost, type Issue, type Service } from './diagnostics.ts';
import { formatCidr, formatIp, networkOf, parseCidr } from './ip.ts';
import { clockLabel, groupName, hasFeature, type LevelDef } from './level.ts';
import type { Network } from './network.ts';
import type { Simulation } from './simulation.ts';
import type { Feature, LbMode, Phase, Proto, SkillId } from './types.ts';

export type Tone = 'ok' | 'err' | 'warn' | 'dim' | 'head' | 'cmd' | 'clear';

export interface Line {
  text: string;
  tone?: Tone;
}

export interface ConsoleHost {
  level: LevelDef;
  skills: ReadonlySet<SkillId>;
  phase(): Phase;
  network(): Network;
  config(): NetConfig;
  setConfig(next: NetConfig): void;
  sim(): Simulation | null;
  issues(): Issue[];
  showPath?(path: string[], ok: boolean): void;
}

interface Command {
  names: string[];
  usage: string;
  help: string;
  run(args: string[], host: ConsoleHost): Line[];
}

const ok = (text: string): Line => ({ text, tone: 'ok' });
const err = (text: string): Line => ({ text, tone: 'err' });
const warn = (text: string): Line => ({ text, tone: 'warn' });
const dim = (text: string): Line => ({ text, tone: 'dim' });
const head = (text: string): Line => ({ text, tone: 'head' });

const FEATURE_NAMES: Record<Feature, string> = {
  vlan: 'les VLAN',
  subnets: 'l’adressage manuel',
  firewall: 'le pare-feu',
  lb: 'la répartition de charge',
  quarantine: 'la quarantaine',
};

function needFeature(host: ConsoleHost, f: Feature): Line[] | null {
  if (hasFeature(host.level, f)) return null;
  return [err(`Cette mission ne permet pas encore de configurer ${FEATURE_NAMES[f]}.`)];
}

function needSkill(host: ConsoleHost, s: SkillId, name: string): Line[] | null {
  if (host.skills.has(s)) return null;
  return [err(`Compétence requise : « ${name} » (arbre de compétences).`)];
}

function needLive(host: ConsoleHost): Line[] | null {
  if (host.sim()) return null;
  return [err('Disponible pendant la simulation (phase 3 · Live).')];
}

function pad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? `${str} ` : str + ' '.repeat(n - str.length);
}

function mutate(host: ConsoleHost, fn: (c: NetConfig) => void): void {
  const next = cloneConfig(host.config());
  fn(next);
  host.setConfig(next);
}

/** « udp 123 », « udp/123 », « 123 » → service. */
function serviceArgs(args: string[]): { proto: Proto | 'any'; port: number | null } | null {
  if (args.length >= 2 && /^(tcp|udp)$/i.test(args[0]) && /^\d+$/.test(args[1])) {
    return parseService(`${args[0]}/${args[1]}`);
  }
  return args[0] ? parseService(args[0]) : null;
}

function probeService(raw: string | undefined): Service | null {
  if (!raw) return ICMP;
  const s = parseService(raw);
  if (!s || s.proto === 'any' || s.port === null) return null;
  return { proto: s.proto, port: s.port };
}

function nodeLabel(net: Network, id: string): string {
  return net.byId.get(id)?.label ?? id;
}

const COMMANDS: Command[] = [
  {
    names: ['aide', 'help', '?'],
    usage: 'aide [commande]',
    help: 'Liste les commandes, ou détaille l’une d’elles.',
    run(args) {
      if (args[0]) {
        const c = find(args[0]);
        if (!c) return [err(`Commande inconnue : ${args[0]}`)];
        return [head(c.usage), { text: c.help }, dim(`Alias : ${c.names.join(', ')}`)];
      }
      return [head('Commandes disponibles'), ...COMMANDS.map((c) => ({ text: `${pad(c.usage, 34)}${c.help}` }))];
    },
  },
  {
    names: ['clear', 'effacer', 'cls'],
    usage: 'clear',
    help: 'Efface la console.',
    run: () => [{ text: '', tone: 'clear' }],
  },
  {
    names: ['status', 'etat', 'état'],
    usage: 'status',
    help: 'État du réseau : charge, température et alertes.',
    run(_args, host) {
      const sim = host.sim();
      const net = host.network();
      if (!sim) {
        const issues = host.issues();
        const eq = net.nodes.filter((n) => n.transit).length;
        const lines: Line[] = [head(`Conception : ${eq} équipement(s), ${net.links.filter((l) => l.kind !== 'wifi').length} câble(s)`)];
        if (!issues.length) lines.push(ok('Aucun problème détecté. Prêt pour le lancement.'));
        for (const i of issues) lines.push(i.level === 'info' ? dim(i.text) : i.level === 'error' ? err(i.text) : warn(i.text));
        return lines;
      }
      const lines: Line[] = [head(`${pad('ÉQUIPEMENT', 12)}${pad('CHARGE', 9)}${pad('TEMP.', 8)}ÉTAT`)];
      for (const s of sim.states.values()) {
        const n = s.node;
        if (!n.transit && n.kind !== 'server') continue;
        const state = s.down === 'failure' ? 'EN PANNE' : s.down === 'overheat' ? 'SURCHAUFFE' : s.heat > 0.8 ? 'CHAUD' : 'OK';
        const line = `${pad(n.label, 12)}${pad(`${Math.round(s.load * 100)} %`, 9)}${pad(`${tempCelsius(s.heat)} °C`, 8)}${state}`;
        lines.push(state === 'OK' ? { text: line } : state === 'CHAUD' ? warn(line) : err(line));
      }
      const hot = net.links.filter((l) => sim.linkUtil(l.id) > 0.9);
      if (hot.length) lines.push(warn(`${hot.length} lien(s) saturé(s) : ${hot.map((l) => `${nodeLabel(net, l.a)}↔${nodeLabel(net, l.b)}`).join(', ')}`));
      lines.push(dim(`Frustration ${Math.round(sim.frustration)} % · ${sim.clock}`));
      return lines;
    },
  },
  {
    names: ['hosts', 'ip', 'postes'],
    usage: 'hosts [groupe]',
    help: 'Liste les postes avec leur VLAN et leur adresse IP.',
    run(args, host) {
      const addr = computeAddressing(host.level, host.config());
      const filter = args[0]?.toLowerCase();
      const lines: Line[] = [head(`${pad('POSTE', 12)}${pad('GROUPE', 16)}${pad('VLAN', 6)}IP`)];
      for (const e of host.level.endpoints) {
        if (e.kind === 'internet') continue;
        if (filter && e.group !== filter && e.pool !== filter) continue;
        const ip = addr.ipOf.get(e.id);
        const ipText = ip === undefined ? 'aucune' : formatIp(ip);
        const line = `${pad(e.label ?? e.id.toUpperCase(), 12)}${pad(groupName(host.level, e.group), 16)}${pad(addr.vlanOf.get(e.id) ?? '-', 6)}${ipText}`;
        lines.push(ip === undefined ? warn(line) : { text: line });
      }
      return lines;
    },
  },
  {
    names: ['vlan'],
    usage: 'vlan [groupe id]',
    help: 'Affiche ou attribue le VLAN d’un groupe (ex. vlan compta 10).',
    run(args, host) {
      const lvl = host.level;
      if (!args.length) {
        const lines: Line[] = [head(`${pad('GROUPE', 18)}${pad('ID', 6)}${pad('VLAN', 6)}POSTES`)];
        for (const g of lvl.groups) {
          const n = lvl.endpoints.filter((e) => e.group === g.id).length;
          lines.push({ text: `${pad(g.name, 18)}${pad(g.id, 6)}${pad(host.config().vlans[g.id] ?? 1, 6)}${n}` });
        }
        return lines;
      }
      const gate = needFeature(host, 'vlan');
      if (gate) return gate;
      const g = lvl.groups.find((x) => x.id === args[0].toLowerCase());
      if (!g) return [err(`Groupe inconnu : ${args[0]}. Groupes : ${lvl.groups.map((x) => x.id).join(', ')}`)];
      const id = Number(args[1]);
      if (!Number.isInteger(id) || id < 1 || id > 4094) return [err('Un VLAN est un nombre entre 1 et 4094.')];
      mutate(host, (c) => (c.vlans[g.id] = id));
      return [ok(`${g.name} → VLAN ${id}`)];
    },
  },
  {
    names: ['subnet', 'sousreseau', 'sous-reseau'],
    usage: 'subnet [vlan cidr|none]',
    help: 'Affiche ou attribue le sous-réseau d’un VLAN (ex. subnet 10 10.42.0.16/29).',
    run(args, host) {
      const lvl = host.level;
      if (lvl.addressing.mode !== 'manual') {
        return [dim('Adressage automatique (DHCP) dans cette mission : chaque VLAN reçoit un /24 en 10.0.x.0.')];
      }
      const addr = computeAddressing(lvl, host.config());
      if (!args.length) {
        const lines: Line[] = [head(`Bloc attribué : ${lvl.addressing.block}`), head(`${pad('VLAN', 6)}${pad('SOUS-RÉSEAU', 18)}${pad('HÔTES', 10)}ÉTAT`)];
        for (const v of addr.vlans) {
          const line = `${pad(v.vlan, 6)}${pad(v.cidr ?? '—', 18)}${pad(`${v.hosts}/${Math.max(0, v.usable - 1)}`, 10)}${v.ok ? '✔' : `✖ ${v.error}`}`;
          lines.push(v.ok ? { text: line } : warn(line));
        }
        return lines;
      }
      const gate = needFeature(host, 'subnets');
      if (gate) return gate;
      const vlan = Number(args[0]);
      if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return [err('Usage : subnet <vlan> <cidr>, ex. subnet 10 10.42.0.16/29')];
      if (!args[1]) return [err('Précise un sous-réseau CIDR, ou « none » pour le retirer.')];
      if (args[1].toLowerCase() === 'none' || args[1].toLowerCase() === 'aucun') {
        mutate(host, (c) => delete c.subnets[String(vlan)]);
        return [ok(`VLAN ${vlan} : sous-réseau retiré.`)];
      }
      const c = parseCidr(args[1]);
      if (!c) return [err(`Format invalide : ${args[1]}. Exemple : 10.42.0.16/29`)];
      mutate(host, (cfg) => (cfg.subnets[String(vlan)] = formatCidr(c)));
      const st = computeAddressing(lvl, host.config()).vlans.find((v) => v.vlan === vlan);
      if (!st) return [warn(`VLAN ${vlan} : sous-réseau enregistré, mais aucun groupe n’utilise ce VLAN.`)];
      return st.ok
        ? [ok(`VLAN ${vlan} → ${formatCidr(c)} (${st.hosts} hôte(s), ${st.usable - 1 - st.hosts} adresse(s) libre(s)).`)]
        : [err(`VLAN ${vlan} → ${formatCidr(c)} : ${st.error}${st.hint ? ` ${st.hint}` : ''}`)];
    },
  },
  {
    names: ['fw', 'firewall', 'parefeu'],
    usage: 'fw [deny|allow src dst [svc] | del n | up n | flush]',
    help: 'Pare-feu : liste ou modifie les règles (première règle qui correspond gagne).',
    run(args, host) {
      const cfg = host.config();
      const sub = (args[0] ?? 'list').toLowerCase();
      if (sub === 'list' || sub === 'ls') {
        if (!cfg.rules.length) return [dim('Aucune règle : tout est autorisé.')];
        const hits = host.sim()?.ruleHits;
        const lines: Line[] = [head(`${pad('#', 4)}${pad('RÈGLE', 52)}IMPACTS`)];
        cfg.rules.forEach((r, i) => lines.push({ text: `${pad(i + 1, 4)}${pad(formatRule(r), 52)}${hits?.get(r.id) ?? 0}` }));
        lines.push(dim('Politique par défaut : autoriser. Les réponses des connexions établies passent toujours.'));
        return lines;
      }
      const gate = needFeature(host, 'firewall');
      if (gate) return gate;
      if (sub === 'deny' || sub === 'allow' || sub === 'bloquer' || sub === 'autoriser') {
        const action = sub === 'deny' || sub === 'bloquer' ? 'deny' : 'allow';
        if (args.length < 3) return [err('Usage : fw deny <source> <destination> [tcp/445]')];
        const src = parseSelector(args[1], host.level);
        if ('error' in src) return [err(src.error)];
        const dst = parseSelector(args[2], host.level);
        if ('error' in dst) return [err(dst.error)];
        const svc = parseService(args[3]);
        if (!svc) return [err(`Service invalide : ${args[3]}. Exemples : tcp/445, udp/123, 443`)];
        let text = '';
        mutate(host, (c) => {
          const rule = { id: c.seq++, action, src: args[1].toLowerCase(), dst: args[2].toLowerCase(), ...svc } as const;
          c.rules.push({ ...rule });
          text = `Règle #${c.rules.length} ajoutée : ${formatRule(rule)}`;
        });
        return [ok(text)];
      }
      if (sub === 'del' || sub === 'rm' || sub === 'suppr') {
        const n = Number(args[1]);
        if (!Number.isInteger(n) || n < 1 || n > cfg.rules.length) return [err('Numéro de règle invalide (voir « fw list »).')];
        mutate(host, (c) => c.rules.splice(n - 1, 1));
        return [ok(`Règle #${n} supprimée.`)];
      }
      if (sub === 'up' || sub === 'monter') {
        const n = Number(args[1]);
        if (!Number.isInteger(n) || n < 2 || n > cfg.rules.length) return [err('Numéro de règle invalide (2 minimum).')];
        mutate(host, (c) => {
          const [r] = c.rules.splice(n - 1, 1);
          c.rules.splice(n - 2, 0, r);
        });
        return [ok(`Règle #${n} remontée en position ${n - 1}.`)];
      }
      if (sub === 'flush' || sub === 'vider') {
        mutate(host, (c) => (c.rules = []));
        return [ok('Toutes les règles ont été supprimées.')];
      }
      return [err(`Sous-commande inconnue : ${args[0]}. Voir « aide fw ».`)];
    },
  },
  {
    names: ['block', 'bloquer'],
    usage: 'block <proto> <port>',
    help: 'Bloque un port partout, en tête du pare-feu (ex. block udp 123).',
    run(args, host) {
      const gate = needFeature(host, 'firewall');
      if (gate) return gate;
      const svc = serviceArgs(args);
      if (!svc || svc.port === null) return [err('Usage : block udp 123   (ou block tcp/23)')];
      const exists = host.config().rules.some(
        (r) => r.action === 'deny' && r.src === 'any' && r.dst === 'any' && r.proto === svc.proto && r.port === svc.port,
      );
      if (exists) return [dim(`${formatService(svc.proto, svc.port)} est déjà bloqué.`)];
      mutate(host, (c) => c.rules.unshift({ id: c.seq++, action: 'deny', src: 'any', dst: 'any', proto: svc.proto, port: svc.port }));
      return [ok(`${formatService(svc.proto, svc.port)} bloqué sur tous les routeurs (règle #1).`)];
    },
  },
  {
    names: ['unblock', 'debloquer', 'débloquer'],
    usage: 'unblock <proto> <port>',
    help: 'Retire le blocage global d’un port.',
    run(args, host) {
      const gate = needFeature(host, 'firewall');
      if (gate) return gate;
      const svc = serviceArgs(args);
      if (!svc || svc.port === null) return [err('Usage : unblock udp 123')];
      const before = host.config().rules.length;
      mutate(host, (c) => {
        c.rules = c.rules.filter(
          (r) => !(r.action === 'deny' && r.src === 'any' && r.dst === 'any' && r.proto === svc.proto && r.port === svc.port),
        );
      });
      const removed = before - host.config().rules.length;
      return removed ? [ok(`${formatService(svc.proto, svc.port)} débloqué.`)] : [dim('Aucun blocage correspondant.')];
    },
  },
  {
    names: ['blockip', 'bloquerip'],
    usage: 'blockip <plage/cidr>',
    help: 'Bloque tout le trafic venant d’une plage d’adresses (ex. blockip 185.220.0.0/16).',
    run(args, host) {
      const gate = needFeature(host, 'firewall');
      if (gate) return gate;
      const c = args[0] ? parseCidr(args[0].includes('/') ? args[0] : `${args[0]}/32`) : null;
      if (!c) return [err('Usage : blockip 185.220.0.0/16')];
      const cidr = formatCidr(networkOf(c));
      mutate(host, (cfg) => cfg.rules.unshift({ id: cfg.seq++, action: 'deny', src: cidr, dst: 'any', proto: 'any', port: null }));
      return [ok(`Trafic venant de ${cidr} bloqué (règle #1).`)];
    },
  },
  {
    names: ['ratelimit', 'limiter'],
    usage: 'ratelimit [tcp/443 60 | off tcp/443]',
    help: 'Plafonne le nombre de requêtes par seconde sur un port.',
    run(args, host) {
      const gate = needSkill(host, 'ratelimit', 'Limitation de débit');
      if (gate) return gate;
      const cfg = host.config();
      if (!args.length) {
        if (!cfg.rateLimits.length) return [dim('Aucune limitation active.')];
        return cfg.rateLimits.map((r) => ({ text: `${formatService(r.proto, r.port)} : ${r.pps} paquets/s max` }));
      }
      const off = args[0].toLowerCase() === 'off';
      const svc = parseService(off ? args[1] : args[0]);
      if (!svc || svc.proto === 'any' || svc.port === null) return [err('Usage : ratelimit tcp/443 60   ou   ratelimit off tcp/443')];
      const proto = svc.proto;
      const port = svc.port;
      if (off) {
        mutate(host, (c) => (c.rateLimits = c.rateLimits.filter((r) => !(r.proto === proto && r.port === port))));
        return [ok(`Limitation retirée sur ${formatService(proto, port)}.`)];
      }
      const pps = Number(args[1]);
      if (!Number.isFinite(pps) || pps <= 0) return [err('Précise un plafond en paquets par seconde, ex. ratelimit tcp/443 60')];
      mutate(host, (c) => {
        c.rateLimits = c.rateLimits.filter((r) => !(r.proto === proto && r.port === port));
        c.rateLimits.push({ id: c.seq++, proto, port, pps });
      });
      return [ok(`${formatService(proto, port)} plafonné à ${pps} paquets/s.`)];
    },
  },
  {
    names: ['lb', 'repartition'],
    usage: 'lb [pool none|rr|least]',
    help: 'Répartition de charge d’un pool de serveurs (aucune, round-robin, moins de connexions).',
    run(args, host) {
      const pools = [...new Set(host.level.endpoints.filter((e) => e.pool).map((e) => e.pool!))];
      const names: Record<LbMode, string> = { none: 'aucune (tout au premier serveur)', rr: 'round-robin', least: 'moins de connexions' };
      if (!args.length) {
        return pools.map((p) => {
          const n = host.level.endpoints.filter((e) => e.pool === p).length;
          return { text: `${pad(p, 12)}${pad(`${n} serveur(s)`, 14)}${names[host.config().lb[p] ?? 'none']}` };
        });
      }
      const gate = needFeature(host, 'lb');
      if (gate) return gate;
      const pool = args[0].toLowerCase();
      if (!pools.includes(pool)) return [err(`Pool inconnu : ${args[0]}. Pools : ${pools.join(', ')}`)];
      const raw = (args[1] ?? '').toLowerCase();
      const mode: LbMode | null =
        raw === 'none' || raw === 'aucune' ? 'none' : raw === 'rr' || raw === 'round-robin' ? 'rr' : raw === 'least' || raw === 'moins' ? 'least' : null;
      if (!mode) return [err('Mode : none, rr ou least.')];
      if (mode === 'least') {
        const g = needSkill(host, 'lb_least', 'Répartition adaptative');
        if (g) return g;
      }
      mutate(host, (c) => (c.lb[pool] = mode));
      return [ok(`${pool} : répartition ${names[mode]}.`)];
    },
  },
  {
    names: ['quarantine', 'isoler', 'quarantaine'],
    usage: 'quarantine <poste>',
    help: 'Isole un poste compromis du réseau.',
    run(args, host) {
      const gate = needFeature(host, 'quarantine');
      if (gate) return gate;
      const e = host.level.endpoints.find((x) => x.id === (args[0] ?? '').toLowerCase());
      if (!e || (e.kind !== 'workstation' && e.kind !== 'laptop')) return [err('Précise un poste ou un portable, ex. quarantine pc-m3')];
      if (host.config().quarantine.includes(e.id)) return [dim(`${e.id.toUpperCase()} est déjà isolé.`)];
      mutate(host, (c) => c.quarantine.push(e.id));
      return [ok(`${e.id.toUpperCase()} isolé. Envoie un technicien pour le nettoyer : dispatch ${e.id}`)];
    },
  },
  {
    names: ['release', 'liberer', 'libérer'],
    usage: 'release <poste>',
    help: 'Sort un poste de quarantaine (sans le nettoyer).',
    run(args, host) {
      const id = (args[0] ?? '').toLowerCase();
      if (!host.config().quarantine.includes(id)) return [err(`${id || '?'} n’est pas en quarantaine.`)];
      mutate(host, (c) => (c.quarantine = c.quarantine.filter((x) => x !== id)));
      const infected = host.sim()?.states.get(id)?.infected;
      return infected ? [warn(`${id.toUpperCase()} est toujours infecté !`)] : [ok(`${id.toUpperCase()} reconnecté.`)];
    },
  },
  {
    names: ['dispatch', 'tech', 'technicien'],
    usage: 'dispatch <équipement>',
    help: 'Envoie un technicien réparer un équipement en panne ou nettoyer un poste.',
    run(args, host) {
      const gate = needLive(host);
      if (gate) return gate;
      const id = (args[0] ?? '').toLowerCase();
      if (!id) return [err('Usage : dispatch sw-2')];
      const r = host.sim()!.dispatch(id);
      return [r.ok ? ok(r.message) : err(r.message)];
    },
  },
  {
    names: ['ping'],
    usage: 'ping <a> <b> [tcp/445]',
    help: 'Teste l’accès de a vers b (poste, groupe, service ou internet).',
    run: (args, host) => runProbe(args, host, false),
  },
  {
    names: ['traceroute', 'tracert', 'trace'],
    usage: 'traceroute <a> <b> [tcp/445]',
    help: 'Affiche le chemin saut par saut et le verdict du pare-feu.',
    run: (args, host) => runProbe(args, host, true),
  },
  {
    names: ['top'],
    usage: 'top [src]',
    help: 'Trafic de la dernière seconde par port, ou par source (top src).',
    run(args, host) {
      const gate = needLive(host);
      if (gate) return gate;
      const sim = host.sim()!;
      if ((args[0] ?? '').toLowerCase().startsWith('src')) {
        const rows = sim.topSources().slice(0, 10);
        if (!rows.length) return [dim('Pas encore de mesure : patiente une seconde.')];
        return [
          head(`${pad('SOURCE', 20)}PAQ/S`),
          ...rows.map((r) => {
            const line = `${pad(r.label, 20)}${r.pps}`;
            return r.anomalous ? warn(`${line}   ⚠ anormal`) : { text: line };
          }),
        ];
      }
      const rows = sim.topPorts().slice(0, 10);
      if (!rows.length) return [dim('Pas encore de mesure : patiente une seconde.')];
      return [
        head(`${pad('PROTO/PORT', 13)}${pad('PAQ/S', 8)}DESTINATIONS`),
        ...rows.map((r) => {
          const line = `${pad(r.key.toUpperCase(), 13)}${pad(r.pps, 8)}${r.dsts.join(', ')}`;
          return r.anomalous ? warn(`${line}   ⚠ anormal`) : { text: line };
        }),
      ];
    },
  },
  {
    names: ['tcpdump', 'capture'],
    usage: 'tcpdump [n]',
    help: 'Affiche les derniers paquets observés (en-têtes).',
    run(args, host) {
      const gate = needLive(host);
      if (gate) return gate;
      const sim = host.sim()!;
      const n = Math.min(40, Math.max(1, Number(args[0]) || 12));
      const rows = sim.recentPackets(n);
      if (!rows.length) return [dim('Rien à capturer pour l’instant.')];
      return rows.map((r) => ({
        text: `${clockLabel(r.t / sim.dayLength)}  ${pad(r.proto.toUpperCase(), 4)}${sim.ipLabel(r.src, r.srcIp)} → ${sim.ipLabel(r.dst, r.dstIp)}:${r.port}`,
      }));
    },
  },
  {
    names: ['autovlan'],
    usage: 'autovlan',
    help: 'Script : un VLAN par groupe et un plan d’adressage VLSM automatique.',
    run(_args, host) {
      const gate = needSkill(host, 'autovlan', 'Script Auto-VLAN & IPAM') ?? needFeature(host, 'vlan');
      if (gate) return gate;
      const plan = autoPlan(host.level);
      if (typeof plan === 'string') return [err(plan)];
      mutate(host, (c) => {
        c.vlans = { ...c.vlans, ...plan.vlans };
        c.subnets = { ...plan.subnets };
      });
      const lines: Line[] = [ok('Plan appliqué :')];
      for (const g of host.level.groups) {
        const v = plan.vlans[g.id];
        lines.push({ text: `  ${pad(g.name, 18)}VLAN ${pad(v, 6)}${plan.subnets[String(v)] ?? 'DHCP auto'}` });
      }
      return lines;
    },
  },
];

function find(name: string): Command | undefined {
  const n = name.toLowerCase();
  return COMMANDS.find((c) => c.names.includes(n));
}

function runProbe(args: string[], host: ConsoleHost, verbose: boolean): Line[] {
  if (args.length < 2) return [err('Usage : ping <source> <destination> [tcp/445]  (ex. ping compta internet)')];
  const a = resolveHost(host.level, args[0]);
  const b = resolveHost(host.level, args[1]);
  if (!a) return [err(`Source inconnue : ${args[0]}`)];
  if (!b) return [err(`Destination inconnue : ${args[1]}`)];
  const svc = probeService(args[2]);
  if (!svc) return [err(`Service invalide : ${args[2]}. Exemple : tcp/445`)];
  const sim = host.sim();
  const result = probe(host.level, host.network(), host.config(), a, b, svc, sim ? (id) => sim.isUp(id) : undefined);
  host.showPath?.(result.path ?? [a], result.ok);
  const lines = verbose ? result.lines : [result.lines[0], result.lines[result.lines.length - 1]];
  return lines.map((text, i) => (i === lines.length - 1 ? (result.ok ? ok(text) : err(text)) : i === 0 ? head(text) : { text }));
}

export function execute(input: string, host: ConsoleHost): Line[] {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const cmd = find(words[0]);
  if (!cmd) return [err(`Commande inconnue : ${words[0]}. Tape « aide ».`)];
  try {
    return cmd.run(words.slice(1), host);
  } catch (e) {
    return [err(`Erreur interne : ${(e as Error).message}`)];
  }
}

export function commandNames(): string[] {
  return COMMANDS.flatMap((c) => c.names);
}
