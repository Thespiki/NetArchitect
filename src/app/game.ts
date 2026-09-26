// Écran de mission : phases Architecture → Configuration → Journée, boucle de jeu et interactions.

import { CABLES, DEVICES, EQUIPMENT_ORDER, euros, meters, TRAFFIC } from '../core/catalog.ts';
import { cloneConfig, defaultConfig, type NetConfig } from '../core/config.ts';
import type { ConsoleHost, Line } from '../core/console.ts';
import {
  autoCable,
  availableKit,
  cableLength,
  canConnect,
  canMove,
  canPlace,
  cloneDesign,
  connect,
  designCost,
  emptyDesign,
  isEquipment,
  moveDevice,
  nodeRef,
  placeDevice,
  portsUsed,
  removeCable,
  removeDevice,
  type Design,
} from '../core/design.ts';
import { preflight, type Issue } from '../core/diagnostics.ts';
import type { GuideState, LevelDef } from '../core/level.ts';
import { LEVELS } from '../core/levels.ts';
import { buildNetwork, type Network } from '../core/network.ts';
import { evaluate } from '../core/objectives.ts';
import { Simulation, STEP } from '../core/simulation.ts';
import type { CableKind, EquipmentKind, Phase, SkillId, Vec } from '../core/types.ts';
import { topologyLayout } from '../render/layout.ts';
import { Renderer, type CablePreview, type Ghost, type Hover, type PathHighlight } from '../render/renderer.ts';
import type { App } from './app.ts';
import { ConsoleView } from './consoleView.ts';
import { h, reducedMotion } from './dom.ts';
import { helpBody } from './help.ts';
import { showBriefing, showDebrief } from './missionModals.ts';
import { modalOpen, openModal } from './modal.ts';
import * as P from './panels.ts';
import { currentRank, isUnlocked, planFor } from './save.ts';
import type { Screen } from './screens.ts';

type Tool = { t: 'select' } | { t: 'place'; kind: EquipmentKind } | { t: 'cable'; kind: CableKind; from?: string } | { t: 'delete' };

const SHORT: Record<EquipmentKind, string> = {
  switch8: 'Switch 8',
  switch24: 'Switch 24',
  router: 'Routeur',
  ap: 'Borne Wi-Fi',
  switch_l3: 'Switch L3',
  router_pro: 'Routeur pro',
};

const PHASES: { id: Phase; label: string }[] = [
  { id: 'build', label: 'Architecture' },
  { id: 'config', label: 'Configuration' },
  { id: 'live', label: 'Journée' },
];

export class GameScreen implements Screen {
  readonly el: HTMLElement;
  private readonly app: App;
  private readonly level: LevelDef;
  private readonly skills: Set<SkillId>;
  private design: Design;
  private config: NetConfig;
  private net!: Network;
  private topo = new Map<string, Vec>();
  private topoDirty = true;
  private issues: Issue[] = [];
  private warnNodes = new Set<string>();
  private phase: Phase = 'build';
  private view: 'phys' | 'topo' = 'phys';
  private morph = 0;
  private sim: Simulation | null = null;
  private paused = false;
  private speed = 1;
  private acc = 0;
  private tool: Tool = { t: 'select' };
  private selected: { node?: string; link?: string } = {};
  private hover: Hover = {};
  private ghost: Ghost | null = null;
  private cablePreview: CablePreview | null = null;
  private path: PathHighlight | null = null;
  private pointer = { x: 0, y: 0, inside: false };
  private drag: { id: string; cell: Vec; moved: boolean } | null = null;
  private panning: { x: number; y: number; moved: boolean } | null = null;
  private readonly touches = new Map<number, Vec>();
  private pinch = 0;
  private undoStack: Design[] = [];
  private redoStack: Design[] = [];
  private readonly renderer: Renderer;
  private readonly roomGroups = new Map<string, string>();
  private raf = 0;
  private lastFrame = 0;
  private lastUi = 0;
  private destroyed = false;
  private started = false;
  private fitted = false;
  private cfgSeen = 0;
  private logSeen = 0;
  private saveTimer = 0;
  private toastTimer = 0;
  private cards: P.Card[] = [];
  private readonly reduced = reducedMotion();
  private readonly ctx: P.PanelCtx;
  private readonly host: ConsoleHost;
  private readonly resizeObs: ResizeObserver;

  private readonly canvas: HTMLCanvasElement;
  private readonly stage: HTMLElement;
  private readonly sideBody: HTMLElement;
  private readonly sideFoot: HTMLElement;
  private readonly side: HTMLElement;
  private readonly tools: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly consoleView: ConsoleView;
  private readonly hud: {
    phases: Map<Phase, HTMLButtonElement>;
    budget: HTMLElement;
    budgetLabel: HTMLElement;
    budgetSub: HTMLElement;
    budgetBox: HTMLElement;
    clock: HTMLElement;
    frustBox: HTMLElement;
    frustBar: HTMLElement;
    frustVal: HTMLElement;
    security: HTMLElement;
    securityBox: HTMLElement;
    speedBox: HTMLElement;
    speedBtns: Map<number, HTMLButtonElement>;
    pauseBtn: HTMLButtonElement;
    viewPhys: HTMLButtonElement;
    viewTopo: HTMLButtonElement;
    sound: HTMLButtonElement;
  };

  constructor(app: App, level: LevelDef) {
    this.app = app;
    this.level = level;
    this.skills = app.skills;
    const plan = planFor(app.save, level);
    this.design = plan ? cloneDesign(plan.design) : emptyDesign();
    this.config = plan ? cloneConfig(plan.config) : defaultConfig(level);
    this.config.quarantine = [];

    for (const r of level.rooms) {
      const count = new Map<string, number>();
      for (const e of level.endpoints) {
        if (!e.group || e.kind === 'internet' || e.kind === 'server') continue;
        if (e.x >= r.x && e.x < r.x + r.w && e.y >= r.y && e.y < r.y + r.h) count.set(e.group, (count.get(e.group) ?? 0) + 1);
      }
      const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) this.roomGroups.set(r.id, best[0]);
    }

    // --- HUD
    const phaseBtns = new Map<Phase, HTMLButtonElement>();
    const phaseNav = h(
      'nav',
      { class: 'phases', aria: { label: 'Phases' } },
      ...PHASES.map((p, i) => {
        const b = h(
          'button',
          { class: 'phase', type: 'button', on: { click: () => this.goPhase(p.id) } },
          h('span', { class: 'phase-num' }, String(i + 1)),
          h('span', { class: 'phase-label' }, p.label),
        );
        phaseBtns.set(p.id, b);
        return b;
      }),
    );
    const budget = h('b', null, '');
    const budgetLabel = h('span', { class: 'lbl' }, 'Budget restant');
    const budgetSub = h('small', null, '');
    const budgetBox = h('div', { class: 'stat budget' }, budgetLabel, h('span', { class: 'val' }, budget, budgetSub));
    const clock = h('b', null, '09:00');
    const frustBar = h('i', null);
    const frustVal = h('b', null, '0 %');
    const frustBox = h(
      'div',
      { class: 'stat frustration', role: 'meter', aria: { label: 'Frustration des utilisateurs', valuemin: '0', valuemax: '100', valuenow: '0' } },
      h('span', { class: 'lbl' }, 'Frustration'),
      h('span', { class: 'val' }, h('span', { class: 'gauge' }, frustBar), frustVal),
    );
    const security = h('b', null, '—');
    const securityBox = h('div', { class: 'stat security' }, h('span', { class: 'lbl' }, 'Sécurité'), h('span', { class: 'val' }, security));
    const speedBtns = new Map<number, HTMLButtonElement>();
    const pauseBtn = h('button', { class: 'seg', type: 'button', title: 'Pause (Espace)', on: { click: () => this.togglePause() } }, '❚❚');
    const speedBox = h(
      'div',
      { class: 'segmented speed', role: 'group', aria: { label: 'Vitesse' } },
      pauseBtn,
      ...[1, 2, 4].map((s) => {
        const b = h('button', { class: 'seg', type: 'button', on: { click: () => this.setSpeed(s) } }, `×${s}`);
        speedBtns.set(s, b);
        return b;
      }),
    );
    const viewPhys = h('button', { class: 'seg', type: 'button', on: { click: () => this.setView('phys') } }, 'Plan');
    const viewTopo = h('button', { class: 'seg', type: 'button', on: { click: () => this.setView('topo') } }, 'Topologie');
    const sound = h('button', { class: 'icon-btn', type: 'button', on: { click: () => this.toggleSound() } }, '');
    this.hud = {
      phases: phaseBtns,
      budget,
      budgetLabel,
      budgetSub,
      budgetBox,
      clock,
      frustBox,
      frustBar,
      frustVal,
      security,
      securityBox,
      speedBox,
      speedBtns,
      pauseBtn,
      viewPhys,
      viewTopo,
      sound,
    };
    const header = h(
      'header',
      { class: 'hud' },
      h(
        'div',
        { class: 'hud-left' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Menu', aria: { label: 'Menu' }, on: { click: () => this.openMenu() } }, '☰'),
        h('div', { class: 'mission-id' }, h('b', null, level.company), h('span', null, level.title)),
      ),
      phaseNav,
      h('div', { class: 'hud-stats' }, budgetBox, h('div', { class: 'stat clock' }, h('span', { class: 'lbl' }, 'Heure'), h('span', { class: 'val' }, clock)), frustBox, securityBox),
      h(
        'div',
        { class: 'hud-right' },
        speedBox,
        h('div', { class: 'segmented view', role: 'group', aria: { label: 'Vue (Tab)' } }, viewPhys, viewTopo),
        sound,
        h('button', { class: 'icon-btn panel-toggle', type: 'button', aria: { label: 'Panneau' }, on: { click: () => this.side.classList.toggle('open') } }, '▤'),
      ),
    );

    // --- Scène
    this.canvas = h('canvas', { class: 'stage-canvas', tabindex: 0, aria: { label: 'Plan du réseau' } });
    this.tooltip = h('div', { class: 'tooltip', hidden: true, role: 'status' });
    this.toastEl = h('div', { class: 'toast', hidden: true, role: 'status', aria: { live: 'polite' } });
    this.hint = h('div', { class: 'stage-hint' });
    this.stage = h('main', { class: 'stage' }, this.canvas, this.tooltip, this.toastEl, this.hint);
    this.tools = h('aside', { class: 'tools', aria: { label: 'Outils' } });
    this.sideBody = h('div', { class: 'side-body' });
    this.sideFoot = h('div', { class: 'side-foot-wrap' });
    this.side = h('aside', { class: 'side', aria: { label: 'Panneau de mission' } }, this.sideBody, this.sideFoot);

    // --- Console
    const self = this;
    this.host = {
      level,
      skills: this.skills,
      phase: () => self.phase,
      network: () => self.net,
      config: () => self.config,
      setConfig: (c) => self.applyConfig(c),
      sim: () => self.sim,
      issues: () => self.issues,
      showPath: (path, ok) => {
        self.path = { nodes: path, ok, start: performance.now() / 1000 };
      },
    };
    const prompt = `admin@${level.company.toLowerCase().replace(/[^a-z0-9]/g, '')}:~$`;
    this.consoleView = new ConsoleView(this.host, prompt, (cmd, lines) => this.afterCommand(cmd, lines), window.innerWidth < 900);

    this.el = h('div', { class: 'game' }, header, h('div', { class: 'game-body' }, this.tools, this.stage, this.side), this.consoleView.el);

    this.ctx = {
      get level() {
        return self.level;
      },
      get skills() {
        return self.skills;
      },
      get phase() {
        return self.phase;
      },
      get design() {
        return self.design;
      },
      get config() {
        return self.config;
      },
      get net() {
        return self.net;
      },
      get sim() {
        return self.sim;
      },
      get issues() {
        return self.issues;
      },
      get selected() {
        return self.selected;
      },
      get guide() {
        return self.guideState();
      },
      setConfig: (c) => {
        self.applyConfig(c);
        self.refreshDiagnostics();
      },
      run: (cmd) => self.consoleView.run(cmd),
      select: (node, link) => self.select(node, link),
      autoCable: (hub) => self.doAutoCable(hub),
      removeNode: (id) => self.deleteAt(id, undefined),
      removeLink: (id) => self.deleteAt(undefined, id),
      goPhase: (p) => self.goPhase(p),
      launch: () => self.launch(),
      stop: () => self.stop(),
    };

    this.renderer = new Renderer(this.canvas);
    this.onDesignChanged(false);
    this.renderTools();
    this.renderSide();
    this.updateHud();
    this.updateHint();

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(this.stage);
    this.raf = requestAnimationFrame(this.frame);

    this.consoleView.print([
      { text: `NetArchitect · session ouverte sur ${level.company}`, tone: 'head' },
      { text: 'Tape « aide » pour la liste des commandes.', tone: 'dim' },
    ]);

    requestAnimationFrame(() =>
      showBriefing(
        app.root,
        level,
        !!plan,
        () => {
          this.started = true;
          this.app.audio.setMode('build');
          this.canvas.focus();
        },
        () => this.app.go('campaign'),
      ),
    );
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.resizeObs.disconnect();
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.toastTimer);
    this.app.audio.setMode('menu');
  }

  // -------------------------------------------------------------------------
  // État dérivé

  private guideState(): GuideState {
    return {
      phase: this.phase,
      devices: this.design.devices,
      cables: this.design.cables,
      running: !!this.sim,
    };
  }

  private onDesignChanged(persist = true): void {
    this.net = buildNetwork(this.level, this.design);
    this.topoDirty = true;
    if (this.morph > 0) this.relayout();
    this.recomputeIssues();
    if (this.selected.node && !this.net.byId.has(this.selected.node)) this.selected = {};
    if (this.selected.link && !this.net.linkById.has(this.selected.link)) this.selected = {};
    if (this.tool.t === 'cable' && this.tool.from && !this.net.byId.has(this.tool.from)) this.tool.from = undefined;
    this.renderSide();
    this.updateHud();
    if (persist) this.schedulePersist();
  }

  private recomputeIssues(): void {
    this.issues = preflight(this.level, this.design, this.net, this.config);
    this.warnNodes = new Set(this.issues.flatMap((i) => i.nodes ?? []));
  }

  private relayout(): void {
    this.topo = topologyLayout(this.net, this.level.size);
    this.topoDirty = false;
  }

  private applyConfig(c: NetConfig): void {
    this.config = c;
    if (this.sim) {
      this.sim.applyConfig(c);
      this.cfgSeen = this.sim.configVersion;
    }
    this.recomputeIssues();
    this.schedulePersist();
  }

  private schedulePersist(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.app.save.plans[this.level.id] = {
        design: cloneDesign(this.design),
        config: { ...cloneConfig(this.config), quarantine: [] },
      };
      this.app.persist();
    }, 400);
  }

  private pushUndo(): void {
    this.undoStack.push(cloneDesign(this.design));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    if (this.phase === 'live') return;
    const prev = this.undoStack.pop();
    if (!prev) return this.toast('Rien à annuler.');
    this.redoStack.push(cloneDesign(this.design));
    this.design = prev;
    this.app.audio.sfx('remove');
    this.onDesignChanged();
  }

  private redo(): void {
    if (this.phase === 'live') return;
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneDesign(this.design));
    this.design = next;
    this.onDesignChanged();
  }

  // -------------------------------------------------------------------------
  // Actions de conception

  private select(node?: string, link?: string): void {
    this.selected = { node, link };
    if (node || link) this.app.audio.sfx('click');
    this.renderSide();
    if (window.innerWidth < 900 && (node || link)) this.side.classList.add('open');
  }

  private setTool(tool: Tool): void {
    if (this.phase === 'live' && tool.t !== 'select') {
      this.toast('La journée est lancée : arrête-la pour modifier le câblage.');
      return;
    }
    this.tool = tool;
    this.renderTools();
    this.updateHint();
  }

  private cancelTool(): void {
    if (this.tool.t === 'cable' && this.tool.from) {
      this.tool.from = undefined;
      this.updateHint();
      return;
    }
    if (this.tool.t !== 'select') this.setTool({ t: 'select' });
    else if (this.selected.node || this.selected.link) this.select();
  }

  private placeAt(cell: Vec): void {
    if (this.tool.t !== 'place') return;
    const kind = this.tool.kind;
    const check = canPlace(this.level, this.design, kind, cell.x, cell.y, this.skills);
    if (!check.ok) {
      this.app.audio.sfx('error');
      return this.toast(check.reason, 'crit');
    }
    this.pushUndo();
    const dev = placeDevice(this.level, this.design, kind, cell.x, cell.y, this.skills);
    if (typeof dev === 'string') return this.toast(dev, 'crit');
    this.app.audio.sfx('place');
    this.selected = { node: dev.id };
    this.onDesignChanged();
  }

  private cableClick(nodeId: string): void {
    if (this.tool.t !== 'cable') return;
    const tool = this.tool;
    const ref = nodeRef(this.level, this.design, nodeId);
    if (!ref) return;
    if (!tool.from) {
      if (ref.kind === 'laptop') return this.toast('Les portables se connectent en Wi-Fi : place une borne à portée.', 'crit');
      if (portsUsed(this.design, nodeId) >= ref.ports) {
        this.app.audio.sfx('error');
        return this.toast(`${ref.label} : plus de port libre.`, 'crit');
      }
      tool.from = nodeId;
      this.app.audio.sfx('click');
      this.updateHint();
      return;
    }
    if (nodeId === tool.from) return;
    const check = canConnect(this.level, this.design, tool.from, nodeId, tool.kind, this.skills);
    if (!check.ok) {
      this.app.audio.sfx('error');
      return this.toast(check.reason, 'crit');
    }
    this.pushUndo();
    connect(this.level, this.design, tool.from, nodeId, tool.kind, this.skills);
    this.app.audio.sfx('cable');
    // Le câblage continue depuis le dernier équipement relié (tracé en chemin : FAI → routeur → switch),
    // ou depuis l'équipement de départ si l'arrivée est un poste (tracé en étoile : switch → postes).
    const free = (id: string) => {
      const r = nodeRef(this.level, this.design, id);
      return !!r && isEquipment(r.kind) && portsUsed(this.design, id) < r.ports;
    };
    tool.from = free(nodeId) ? nodeId : free(tool.from) ? tool.from : undefined;
    this.onDesignChanged();
    this.updateHint();
  }

  private deleteAt(node?: string, link?: string): void {
    if (this.phase === 'live') return;
    if (node) {
      const dev = this.design.devices.find((d) => d.id === node);
      if (!dev) return this.toast('Les postes, serveurs et l’arrivée FAI ne se suppriment pas.', 'crit');
      this.pushUndo();
      removeDevice(this.design, node);
    } else if (link) {
      const l = this.net.linkById.get(link);
      if (!l?.cableId) return this.toast('Une liaison Wi-Fi disparaît avec sa borne.', 'crit');
      this.pushUndo();
      removeCable(this.design, l.cableId);
    } else return;
    this.app.audio.sfx('remove');
    this.selected = {};
    this.onDesignChanged();
  }

  private doAutoCable(hub: string): void {
    this.pushUndo();
    const n = autoCable(this.level, this.design, hub, this.skills);
    if (!n) {
      this.undoStack.pop();
      return this.toast('Aucun poste non câblé à portée dans cette pièce (ou plus de port libre).', 'crit');
    }
    this.app.audio.sfx('cable');
    this.toast(`${n} poste(s) raccordé(s).`, 'ok');
    this.onDesignChanged();
  }

  // -------------------------------------------------------------------------
  // Phases et journée

  private goPhase(p: Phase): void {
    if (p === this.phase) return;
    if (p === 'live') return this.launch();
    if (this.phase === 'live') return this.stop();
    this.phase = p;
    if (p === 'config' && this.tool.t !== 'select') this.tool = { t: 'select' };
    this.setView(p === 'config' ? 'topo' : 'phys');
    this.app.audio.sfx('toggle');
    this.renderTools();
    this.renderSide();
    this.updateHud();
    this.updateHint();
  }

  private launch(): void {
    if (this.phase === 'live') return;
    this.recomputeIssues();
    const error = this.issues.find((i) => i.level === 'error');
    if (error) {
      this.app.audio.sfx('error');
      return this.toast(error.text, 'crit');
    }
    const warns = this.issues.filter((i) => i.level === 'warn');
    if (!warns.length) return this.startDay();
    openModal(this.app.root, {
      eyebrow: 'Diagnostic',
      title: 'Lancer malgré les avertissements ?',
      body: [
        h('ul', { class: 'issues' }, ...warns.slice(0, 6).map((w) => h('li', { class: 'issue warn' }, w.text))),
        warns.length > 6 ? h('p', { class: 'muted' }, `… et ${warns.length - 6} autre(s).`) : '',
      ],
      actions: [{ label: 'Corriger d’abord' }, { label: 'Lancer quand même', kind: 'primary', onClick: () => this.startDay() }],
    });
  }

  private startDay(): void {
    this.config = { ...cloneConfig(this.config), quarantine: [] };
    this.sim = new Simulation(this.level, this.net, this.config, { skills: this.skills });
    this.phase = 'live';
    this.paused = false;
    this.speed = 1;
    this.acc = 0;
    this.logSeen = 0;
    this.cfgSeen = this.sim.configVersion;
    this.tool = { t: 'select' };
    this.selected = {};
    this.side.classList.remove('open');
    this.app.audio.setMode('live');
    this.app.audio.sfx('launch');
    this.consoleView.print([{ text: `— ${this.level.company} · 09:00, début de la journée —`, tone: 'head' }]);
    this.renderTools();
    this.renderSide();
    this.updateHud();
    this.updateHint();
  }

  private stop(): void {
    if (!this.sim) return;
    openModal(this.app.root, {
      title: 'Arrêter la journée ?',
      body: [h('p', null, 'Tu reviens à l’architecture avec ton plan intact. La journée en cours est perdue.')],
      actions: [{ label: 'Continuer la journée' }, { label: 'Arrêter', kind: 'danger', onClick: () => this.endLive() }],
    });
  }

  private endLive(): void {
    this.sim = null;
    this.phase = 'build';
    this.paused = false;
    this.app.audio.setMode('build');
    this.setView('phys');
    this.renderTools();
    this.renderSide();
    this.updateHud();
    this.updateHint();
  }

  private finishDay(): void {
    const sim = this.sim!;
    const spent = designCost(this.level, this.design);
    const result = evaluate(this.level, sim, spent);
    const save = this.app.save;
    const prevStars = save.stars[this.level.id] ?? 0;
    const prevRank = currentRank(save);
    if (result.stars > prevStars) save.stars[this.level.id] = result.stars;
    if (result.success) {
      const best = save.best[this.level.id];
      if (!best || result.stars > best.stars || (result.stars === best.stars && spent < best.spent)) {
        save.best[this.level.id] = { stars: result.stars, frustration: result.avgFrustration, spent };
      }
    }
    this.app.persist();
    const rank = currentRank(save);
    const idx = LEVELS.indexOf(this.level);
    const nextLevel = LEVELS[idx + 1];
    const next = nextLevel && isUnlocked(save, nextLevel) ? nextLevel : null;
    this.app.audio.sfx(result.success ? 'success' : 'fail');
    this.app.audio.setMode('build');
    this.updateHud();
    showDebrief(
      this.app.root,
      this.level,
      result,
      sim,
      { gained: Math.max(0, result.stars - prevStars), rankUp: rank !== prevRank ? rank : null, next },
      {
        replay: () => this.endLive(),
        next: () => next && this.app.startMission(next.id),
        campaign: () => this.app.go('campaign'),
      },
    );
  }

  private togglePause(): void {
    if (!this.sim) return;
    this.paused = !this.paused;
    this.updateHud();
  }

  private setSpeed(s: number): void {
    if (!this.sim) return;
    this.speed = s;
    this.paused = false;
    this.updateHud();
  }

  private cycleSpeed(dir: number): void {
    const speeds = [1, 2, 4];
    const i = Math.max(0, Math.min(2, speeds.indexOf(this.speed) + dir));
    this.setSpeed(speeds[i]);
  }

  private setView(v: 'phys' | 'topo'): void {
    if (v === this.view) return;
    this.view = v;
    if (v === 'topo' && this.topoDirty) this.relayout();
    if (v === 'topo' && this.tool.t === 'place') this.tool = { t: 'select' };
    this.app.audio.sfx('toggle');
    this.renderTools();
    this.updateHud();
    this.updateHint();
  }

  private toggleView(): void {
    this.setView(this.view === 'phys' ? 'topo' : 'phys');
  }

  private toggleSound(): void {
    this.app.toggleMute();
    this.updateHud();
  }

  private afterCommand(_cmd: string, lines: Line[]): void {
    this.recomputeIssues();
    this.renderSide();
    this.updateHud();
    const last = lines.filter((l) => l.tone !== 'cmd').at(-1);
    if (last && this.consoleView.collapsed && last.text) this.toast(last.text, last.tone === 'err' ? 'crit' : last.tone === 'ok' ? 'ok' : undefined);
    if (last?.tone === 'err') this.app.audio.sfx('error');
  }

  private openMenu(): void {
    openModal(this.app.root, {
      eyebrow: `${this.level.company} · ${this.level.title}`,
      title: 'Pause',
      body: [h('p', { class: 'muted' }, 'Le temps est suspendu tant que ce menu est ouvert.')],
      actions: [
        {
          label: 'Aide',
          onClick: () => {
            window.setTimeout(() => openModal(this.app.root, { eyebrow: 'Guide', title: 'Comment jouer', body: helpBody(), actions: [{ label: 'Compris', kind: 'primary' }], wide: true }));
          },
        },
        {
          label: 'Effacer le plan',
          kind: 'danger',
          onClick: () => {
            this.pushUndo();
            this.design = emptyDesign();
            this.config = defaultConfig(this.level);
            if (this.sim) this.endLive();
            this.onDesignChanged();
            this.toast('Plan effacé (Ctrl + Z pour annuler).');
          },
        },
        { label: 'Quitter vers la carrière', onClick: () => this.app.go('campaign') },
        { label: 'Reprendre', kind: 'primary' },
      ],
    });
  }

  // -------------------------------------------------------------------------
  // Interface

  private toast(text: string, tone?: 'ok' | 'crit'): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `toast ${tone ?? ''}`;
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), 3200);
  }

  private updateHint(): void {
    let text = '';
    const t = this.tool;
    if (this.phase === 'live') text = 'Survole un paquet pour lire son en-tête · clique un équipement pour agir · Espace : pause · Tab : vue';
    else if (t.t === 'place') text = `${DEVICES[t.kind].name} : clique sur une case libre (Échap pour arrêter)`;
    else if (t.t === 'cable')
      text = t.from
        ? `${CABLES[t.kind].short} depuis ${nodeRef(this.level, this.design, t.from)?.label} : clique la destination · le tracé continue depuis le dernier équipement (Échap pour arrêter)`
        : `${CABLES[t.kind].short} : clique sur le premier équipement`;
    else if (t.t === 'delete') text = 'Suppression : clique un équipement ou un câble';
    else if (this.phase === 'config') text = 'Configure à droite ou dans la console · Tab : plan physique';
    else text = 'Choisis un équipement à gauche (touches 1–8) · glisse un équipement pour le déplacer · Tab : topologie';
    this.hint.textContent = text;
  }

  private updateHud(): void {
    const H = this.hud;
    for (const [p, b] of H.phases) {
      b.classList.toggle('active', p === this.phase);
      b.setAttribute('aria-current', p === this.phase ? 'step' : 'false');
    }
    const cost = designCost(this.level, this.design);
    if (this.sim) {
      H.budgetLabel.textContent = 'Dépensé';
      H.budget.textContent = euros(cost);
      H.budgetSub.textContent = ` / ${euros(this.level.budget)}`;
      H.budgetBox.classList.remove('over');
    } else {
      const left = this.level.budget - cost;
      H.budgetLabel.textContent = 'Budget restant';
      H.budget.textContent = euros(left);
      H.budgetSub.textContent = ` / ${euros(this.level.budget)}`;
      H.budgetBox.classList.toggle('over', left < 0);
    }
    const sim = this.sim;
    H.clock.textContent = sim ? sim.clock : '09:00';
    const f = sim ? sim.frustration : 0;
    H.frustBar.style.width = `${Math.min(100, f)}%`;
    H.frustVal.textContent = `${Math.round(f)} %`;
    H.frustBox.dataset.level = f > 70 ? 'crit' : f > 35 ? 'warn' : 'ok';
    H.frustBox.setAttribute('aria-valuenow', String(Math.round(f)));
    const audits = !!this.level.audits?.length;
    const crises = (this.level.events ?? []).some((e) => e.kind !== 'peak');
    H.securityBox.hidden = !audits && !crises;
    if (sim) {
      const active = sim.incidents.filter((i) => i.resolved === undefined && i.end === undefined).length;
      const parts: string[] = [];
      if (audits) parts.push(`${sim.stats.breaches} brèche${sim.stats.breaches > 1 ? 's' : ''}`);
      if (active) parts.push(`${active} incident${active > 1 ? 's' : ''}`);
      H.security.textContent = parts.join(' · ') || 'RAS';
      H.securityBox.dataset.level = sim.stats.breaches || active ? 'crit' : 'ok';
    } else {
      H.security.textContent = audits ? 'Audit prévu' : 'Crises prévues';
      H.securityBox.dataset.level = '';
    }
    H.speedBox.hidden = !sim;
    H.pauseBtn.classList.toggle('active', this.paused);
    for (const [s, b] of H.speedBtns) b.classList.toggle('active', !this.paused && s === this.speed);
    H.viewPhys.classList.toggle('active', this.view === 'phys');
    H.viewTopo.classList.toggle('active', this.view === 'topo');
    H.sound.textContent = this.app.save.muted ? '🔇' : '🔊';
    H.sound.setAttribute('aria-label', this.app.save.muted ? 'Activer le son' : 'Couper le son');
    H.sound.title = H.sound.getAttribute('aria-label')!;
  }

  private renderTools(): void {
    const kit = availableKit(this.level, this.skills);
    const live = this.phase === 'live';
    const topo = this.view === 'topo';
    const toolBtn = (opts: {
      label: string;
      meta?: string;
      key?: string;
      icon?: Node;
      active: boolean;
      disabled?: boolean;
      title?: string;
      onClick: () => void;
    }) =>
      h(
        'button',
        {
          class: `tool ${opts.active ? 'active' : ''}`,
          type: 'button',
          disabled: opts.disabled,
          title: opts.title ?? '',
          aria: { pressed: String(opts.active) },
          on: { click: opts.onClick },
        },
        opts.icon ?? null,
        h('span', { class: 'tool-name' }, opts.label),
        opts.meta ? h('span', { class: 'tool-meta' }, opts.meta) : null,
        opts.key ? h('kbd', null, opts.key) : null,
      );
    const equipment = EQUIPMENT_ORDER.filter((k) => kit.equipment.has(k) || DEVICES[k].skill).map((k) => {
      const owned = kit.equipment.has(k);
      const t = this.tool;
      return toolBtn({
        label: SHORT[k],
        meta: owned ? euros(DEVICES[k].cost) : 'Verrouillé',
        key: String(EQUIPMENT_ORDER.indexOf(k) + 1),
        icon: P.glyphIcon(k, 30),
        active: t.t === 'place' && t.kind === k,
        disabled: live || topo || !owned,
        title: owned ? DEVICES[k].desc : `Débloque « ${DEVICES[k].name} » dans l’arbre de compétences.`,
        onClick: () => this.setTool({ t: 'place', kind: k }),
      });
    });
    const cables = (['rj45', 'fiber'] as CableKind[]).map((k, i) => {
      const owned = kit.cables.has(k);
      const t = this.tool;
      const swatch = h('span', { class: `cable-swatch ${k}`, aria: { hidden: 'true' } });
      return toolBtn({
        label: k === 'rj45' ? 'RJ45' : 'Fibre',
        meta: owned ? CABLES[k].short.split(' · ')[1] : 'Verrouillé',
        key: String(7 + i),
        icon: swatch,
        active: t.t === 'cable' && t.kind === k,
        disabled: live || !owned,
        title: owned
          ? `${CABLES[k].name} : ${CABLES[k].base} € + ${CABLES[k].perCell} € par 5 m, ${meters(CABLES[k].maxLen)} maximum`
          : 'Débloque la fibre dans l’arbre de compétences.',
        onClick: () => this.setTool({ t: 'cable', kind: k }),
      });
    });
    const legend = h(
      'ul',
      { class: 'tools-legend' },
      ...(['web', 'stream', 'data', 'customer', 'probe', 'attack'] as const)
        .filter((k) => k !== 'customer' || this.level.traffic.customers)
        .filter((k) => k !== 'probe' || this.level.audits?.length)
        .map((k) => h('li', null, h('i', { class: 'dot', style: `--c:${TRAFFIC[k].color}` }), TRAFFIC[k].label)),
    );
    this.tools.replaceChildren(
      h('p', { class: 'tools-title' }, 'Matériel'),
      ...equipment,
      h('p', { class: 'tools-title' }, 'Câbles'),
      ...cables,
      h('p', { class: 'tools-title' }, 'Outils'),
      toolBtn({ label: 'Sélection', key: 'Échap', active: this.tool.t === 'select', onClick: () => this.setTool({ t: 'select' }) }),
      toolBtn({ label: 'Supprimer', key: 'X', active: this.tool.t === 'delete', disabled: live, onClick: () => this.setTool({ t: 'delete' }) }),
      toolBtn({ label: 'Annuler', key: 'Ctrl Z', active: false, disabled: live, onClick: () => this.undo() }),
      h('p', { class: 'tools-title' }, 'Trafic'),
      legend,
    );
  }

  private renderSide(): void {
    const ctx = this.ctx;
    const cards: (P.Card | null)[] = [];
    if (this.phase === 'build') {
      cards.push(P.guideCard(ctx), P.inspectorCard(ctx), P.diagnosticsCard(ctx), P.objectivesCard(ctx));
    } else if (this.phase === 'config') {
      cards.push(P.configCard(ctx), P.inspectorCard(ctx), P.diagnosticsCard(ctx), P.objectivesCard(ctx));
    } else {
      cards.push(P.alertsCard(ctx), P.inspectorCard(ctx), P.liveFirewallCard(ctx), P.objectivesCard(ctx));
    }
    this.cards = cards.filter((c): c is P.Card => !!c);
    const scroll = this.sideBody.scrollTop;
    this.sideBody.replaceChildren(...this.cards.map((c) => c.el));
    this.sideBody.scrollTop = scroll;
    this.sideFoot.replaceChildren(P.phaseFooter(ctx));
  }

  private refreshDiagnostics(): void {
    const idx = this.cards.findIndex((c) => c.el.querySelector('.issues, .all-good'));
    const fresh = P.diagnosticsCard(this.ctx);
    if (idx >= 0) {
      this.cards[idx].el.replaceWith(fresh.el);
      this.cards[idx] = fresh;
    }
    for (const c of this.cards) c.update?.();
    this.updateHud();
  }

  private tickUi(): void {
    const sim = this.sim;
    this.updateHud();
    for (const c of this.cards) c.update?.();
    if (!sim) return;
    if (sim.configVersion !== this.cfgSeen) {
      this.cfgSeen = sim.configVersion;
      this.config = sim.config;
      this.renderSide();
    }
    if (sim.logVersion !== this.logSeen) {
      const fresh = Math.min(sim.log.length, sim.logVersion - this.logSeen);
      const entries = sim.log.slice(sim.log.length - fresh);
      this.logSeen = sim.logVersion;
      for (const e of entries) this.consoleView.log(e, sim.clockAt(e.t), (cmd) => this.consoleView.run(cmd));
      if (entries.some((e) => e.level === 'crit')) this.app.audio.sfx('alert');
    }
    const active = sim.incidents.some((i) => i.resolved === undefined && i.end === undefined);
    const down = [...sim.states.values()].some((s) => !s.up);
    this.app.audio.setIntensity(0.18 + (0.55 * sim.frustration) / 100 + (active ? 0.22 : 0) + (down ? 0.1 : 0));
    let load = 0;
    let n = 0;
    for (const s of sim.states.values()) {
      if (s.node.transit) {
        load += Math.min(1, s.load);
        n++;
      }
    }
    this.app.audio.setHum(n ? load / n : 0);
  }

  // -------------------------------------------------------------------------
  // Boucle

  private frame = (ts: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const now = ts / 1000;
    const dt = this.lastFrame ? Math.min(0.1, now - this.lastFrame) : 0;
    this.lastFrame = now;
    const target = this.view === 'topo' ? 1 : 0;
    if (this.morph !== target) {
      if (this.topoDirty) this.relayout();
      const k = this.reduced ? 1 : dt / 0.6;
      this.morph = target > this.morph ? Math.min(target, this.morph + k) : Math.max(target, this.morph - k);
    }
    const sim = this.sim;
    if (sim && !sim.finished && !this.paused && !modalOpen()) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= STEP && steps < 20 && !sim.finished) {
        sim.step(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps >= 20) this.acc = 0;
      if (sim.finished) {
        this.tickUi();
        this.finishDay();
      }
    }
    this.updatePointerState();
    const e = this.morph;
    const eased = e < 0.5 ? 4 * e * e * e : 1 - (-2 * e + 2) ** 3 / 2;
    this.renderer.render({
      level: this.level,
      net: this.net,
      design: this.design,
      sim: this.sim,
      phase: this.phase,
      morph: eased,
      topo: this.topo,
      now: performance.now() / 1000,
      hover: this.hover,
      selected: this.selected,
      ghost: this.ghost,
      cable: this.cablePreview,
      path: this.path,
      warnNodes: this.phase === 'live' ? new Set() : this.warnNodes,
      showCoverage: (this.tool.t === 'place' && this.tool.kind === 'ap') || (!!this.selected.node && this.selected.node.startsWith('ap-')),
      snmp: this.skills.has('snmp'),
      roomGroups: this.roomGroups,
      reducedMotion: this.reduced,
    });
    if (now - this.lastUi > 0.2) {
      this.lastUi = now;
      this.tickUi();
    }
  };

  private onResize(): void {
    const r = this.stage.getBoundingClientRect();
    this.renderer.resize(r.width, r.height);
    if (!this.fitted || !this.renderer.camera.zoomed) {
      this.renderer.fit(this.level);
      this.fitted = true;
    }
  }

  // -------------------------------------------------------------------------
  // Souris, tactile, clavier

  private local(e: PointerEvent | WheelEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private updatePointerState(): void {
    this.ghost = null;
    this.cablePreview = null;
    if (!this.pointer.inside || this.panning || this.touches.size > 1) {
      this.hover = {};
      this.tooltip.hidden = true;
      return;
    }
    const { x, y } = this.pointer;
    const node = this.renderer.pickNode(x, y);
    const link = node ? undefined : this.renderer.pickLink(x, y);
    const cell = this.renderer.cellAt(x, y);
    this.hover = { node, link, cell };
    if (this.phase !== 'live') {
      const t = this.tool;
      if (t.t === 'place' && this.morph < 0.5) {
        this.ghost = { kind: t.kind, cell, ok: canPlace(this.level, this.design, t.kind, cell.x, cell.y, this.skills).ok };
      }
      if (this.drag?.moved) {
        const dev = this.design.devices.find((d) => d.id === this.drag!.id);
        if (dev) this.ghost = { kind: dev.kind, cell: this.drag.cell, ok: canMove(this.level, this.design, dev.id, this.drag.cell.x, this.drag.cell.y).ok };
      }
      if (t.t === 'cable' && t.from) {
        const world = this.renderer.camera.toWorld(x, y);
        const from = nodeRef(this.level, this.design, t.from);
        if (from) {
          if (node && node !== t.from) {
            const chk = canConnect(this.level, this.design, t.from, node, t.kind, this.skills);
            const label = chk.ok ? `${CABLES[t.kind].short} · ${meters(chk.length ?? 0)} · ${euros(chk.cost)}` : chk.reason;
            this.cablePreview = { from: t.from, to: world, target: node, ok: chk.ok, kind: t.kind, label };
          } else {
            const len = cableLength({ x: from.x + 0.5, y: from.y + 0.5 }, world);
            const tooLong = len > CABLES[t.kind].maxLen;
            this.cablePreview = {
              from: t.from,
              to: world,
              ok: !tooLong,
              kind: t.kind,
              label: tooLong ? `${meters(len)} : trop long` : `${meters(len)} · choisis la destination`,
            };
          }
        }
      }
    }
    this.updateTooltip(node);
  }

  private updateTooltip(node?: string): void {
    const sim = this.sim;
    let text = '';
    if (sim) {
      const pk = node ? undefined : this.renderer.pickPacket(this.pointer.x, this.pointer.y);
      if (pk) {
        text = `${TRAFFIC[pk.kind].label}${pk.response ? ' (réponse)' : ''} · ${pk.proto.toUpperCase()}/${pk.port}\n${sim.ipLabel(pk.src, pk.srcIp)} → ${sim.ipLabel(pk.dst, pk.dstIp)}`;
      } else if (node) {
        const st = sim.states.get(node);
        if (st) {
          const extra = st.node.transit || st.node.kind === 'server' ? ` · ${Math.round(Math.min(1, st.load) * 100)} %` : '';
          text = `${st.node.label}${extra}`;
        }
      }
    } else if (node) {
      const n = this.net.byId.get(node);
      if (n) text = n.ports ? `${n.label} · ${portsUsed(this.design, n.id)}/${n.ports} ports` : n.label;
    }
    if (!text) {
      this.tooltip.hidden = true;
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.hidden = false;
    const w = this.stage.clientWidth;
    const left = Math.min(w - 260, this.pointer.x + 16);
    this.tooltip.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, this.pointer.y + 14)}px)`;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.started) return;
    this.canvas.focus({ preventScroll: true });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Certains navigateurs refusent la capture : sans gravité.
    }
    const p = this.local(e);
    this.pointer = { ...p, inside: true };
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, p);
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.drag = null;
        this.panning = null;
        return;
      }
    }
    if (e.button === 2 || e.button === 1) {
      if (e.button === 2 && this.tool.t !== 'select') return this.cancelTool();
      this.panning = { ...p, moved: false };
      return;
    }
    if (e.button !== 0) return;
    const node = this.renderer.pickNode(p.x, p.y);
    const link = node ? undefined : this.renderer.pickLink(p.x, p.y);
    const t = this.tool;
    if (t.t === 'select' || this.phase === 'live') {
      if (node) {
        this.select(node);
        const dev = this.design.devices.find((d) => d.id === node);
        if (dev && this.phase !== 'live' && this.morph < 0.5) this.drag = { id: node, cell: { x: dev.x, y: dev.y }, moved: false };
      } else if (link) this.select(undefined, link);
      else this.panning = { ...p, moved: false };
    } else if (t.t === 'place') {
      if (this.morph >= 0.5) this.toast('Passe en vue plan (Tab) pour poser du matériel.');
      else this.placeAt(this.renderer.cellAt(p.x, p.y));
    } else if (t.t === 'cable') {
      if (node) this.cableClick(node);
      else {
        t.from = undefined;
        this.updateHint();
      }
    } else if (t.t === 'delete') {
      this.deleteAt(node, link);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointer = { ...p, inside: true };
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, p);
      if (this.touches.size === 2 && this.pinch) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.renderer.camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch);
        this.pinch = d;
        return;
      }
    }
    if (this.panning) {
      const dx = p.x - this.panning.x;
      const dy = p.y - this.panning.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) this.renderer.camera.pan(dx, dy);
      this.panning = { x: p.x, y: p.y, moved: this.panning.moved || Math.abs(dx) + Math.abs(dy) > 2 };
      return;
    }
    if (this.drag) {
      const cell = this.renderer.cellAt(p.x, p.y);
      const dev = this.design.devices.find((d) => d.id === this.drag!.id);
      if (dev && (cell.x !== dev.x || cell.y !== dev.y)) this.drag = { ...this.drag, cell, moved: true };
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = 0;
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      if (d.moved) {
        const chk = canMove(this.level, this.design, d.id, d.cell.x, d.cell.y);
        if (chk.ok) {
          this.pushUndo();
          moveDevice(this.level, this.design, d.id, d.cell.x, d.cell.y);
          this.app.audio.sfx('place');
          this.onDesignChanged();
        } else {
          this.app.audio.sfx('error');
          this.toast(chk.reason, 'crit');
        }
      }
    }
    if (this.panning) {
      if (!this.panning.moved && this.tool.t === 'select' && e.button === 0) this.select();
      this.panning = null;
    }
  };

  private onPointerLeave = (): void => {
    if (!this.panning && !this.drag) this.pointer.inside = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    this.renderer.camera.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.started || modalOpen()) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Backquote' || e.key === '²' || e.key === '`') {
      e.preventDefault();
      this.consoleView.focus();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod || e.altKey) return;
    // Tab et Espace gardent leur rôle d'accessibilité quand un contrôle a le focus.
    const onControl = !!target && target !== document.body && target !== this.canvas;
    if ((e.key === 'Tab' || e.key === ' ' || e.key === 'Enter') && onControl) return;
    const digit = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      return this.hotkey(Number(digit[1]));
    }
    switch (e.key) {
      case 'Escape':
        this.cancelTool();
        break;
      case 'Tab':
      case 'v':
      case 'V':
        e.preventDefault();
        this.toggleView();
        break;
      case ' ':
        if (this.sim) {
          e.preventDefault();
          this.togglePause();
        }
        break;
      case 'Delete':
      case 'Backspace':
      case 'x':
      case 'X':
        if (this.phase === 'live') break;
        if (this.selected.node || this.selected.link) this.deleteAt(this.selected.node, this.selected.link);
        else this.setTool({ t: 'delete' });
        break;
      case 'f':
      case 'F':
        this.renderer.fit(this.level);
        break;
      case '+':
      case '=':
        this.cycleSpeed(1);
        break;
      case '-':
        this.cycleSpeed(-1);
        break;
    }
  };

  private hotkey(n: number): void {
    if (this.phase === 'live') return;
    const kit = availableKit(this.level, this.skills);
    if (n <= 6) {
      const kind = EQUIPMENT_ORDER[n - 1];
      if (!kit.equipment.has(kind)) return this.toast(`${DEVICES[kind].name} : indisponible dans cette mission.`);
      if (this.view === 'topo') this.setView('phys');
      return this.setTool({ t: 'place', kind });
    }
    const cable: CableKind = n === 7 ? 'rj45' : 'fiber';
    if (!kit.cables.has(cable)) return this.toast('Fibre : débloque-la dans l’arbre de compétences.');
    this.setTool({ t: 'cable', kind: cable });
  }
}
