// Application : navigation entre écrans, sauvegarde et moteur audio partagés.

import { AudioEngine } from '../audio/audio.ts';
import { levelById } from '../core/levels.ts';
import type { SkillId } from '../core/types.ts';
import { GameScreen } from './game.ts';
import { loadSave, writeSave, type SaveData } from './save.ts';
import { campaignScreen, skillsScreen, titleScreen, type Screen } from './screens.ts';

export type Route = 'title' | 'campaign' | 'skills';

export class App {
  readonly root: HTMLElement;
  readonly audio = new AudioEngine();
  save: SaveData;
  private screen: Screen | null = null;
  private route: Route | 'mission' = 'title';

  constructor(root: HTMLElement) {
    this.root = root;
    this.save = loadSave();
    this.audio.muted = this.save.muted;
    this.audio.volume = this.save.volume;
    // Le contexte audio ne peut démarrer qu'après un geste de l'utilisateur.
    const unlock = () => this.audio.unlock();
    root.addEventListener('pointerdown', unlock);
    root.addEventListener('keydown', unlock);
  }

  get skills(): Set<SkillId> {
    return new Set(this.save.skills);
  }

  persist(): void {
    writeSave(this.save);
  }

  toggleMute(): void {
    this.save.muted = !this.save.muted;
    this.audio.setMuted(this.save.muted);
    this.persist();
  }

  private mount(screen: Screen): void {
    this.screen?.destroy();
    this.root.replaceChildren(screen.el);
    this.screen = screen;
    window.scrollTo(0, 0);
  }

  go(route: Route): void {
    const from = this.route;
    this.route = route;
    this.audio.setMode('menu');
    if (route === 'title') this.mount(titleScreen(this));
    else if (route === 'campaign') this.mount(campaignScreen(this));
    else this.mount(skillsScreen(this, from === 'campaign' || from === 'mission' ? 'campaign' : 'title'));
  }

  startMission(id: string): void {
    const level = levelById(id);
    if (!level) return;
    this.route = 'mission';
    this.mount(new GameScreen(this, level));
  }

  /** État à conserver lors d'une republication à chaud de la page. */
  snapshot(): { route: string } {
    return { route: this.route === 'mission' ? 'campaign' : this.route };
  }
}
