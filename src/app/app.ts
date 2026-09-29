// Application: screen navigation, plus what every screen shares (save, settings, audio engine,
// game server client).

import { AudioEngine } from '../audio/audio.ts';
import { levelById, TRAINING } from '../core/levels.ts';
import type { SkillId } from '../core/types.ts';
import { setLang, T, type Lang } from '../i18n/index.ts';
import { GameScreen } from './game.ts';
import { Online } from './online.ts';
import { rankingScreen } from './rankingScreen.ts';
import { loadSave, writeSave, type SaveData } from './save.ts';
import { campaignScreen, skillsScreen, titleScreen, type Screen } from './screens.ts';
import { loadSettings, writeSettings, type Settings } from './settings.ts';

export type Route = 'title' | 'campaign' | 'skills' | 'ranking';

export class App {
  readonly root: HTMLElement;
  readonly audio = new AudioEngine();
  readonly online: Online;
  save: SaveData;
  settings: Settings;
  private screen: Screen | null = null;
  private route: Route | 'mission' = 'title';

  constructor(root: HTMLElement) {
    this.root = root;
    const { save, legacy } = loadSave();
    this.save = save;
    this.settings = loadSettings(legacy);
    this.applyLang(this.settings.lang);
    this.audio.muted = this.settings.muted;
    this.audio.volume = this.settings.volume;
    this.online = new Online({
      getSave: () => this.save,
      setSave: (s) => {
        this.save = s;
        writeSave(s);
        if (this.route !== 'mission') this.screen?.refresh?.();
      },
    });
    this.online.onChange(() => this.screen?.refresh?.());
    void this.online.connect(this.settings.server);
    // The audio context can only start after a user gesture.
    const unlock = () => this.audio.unlock();
    root.addEventListener('pointerdown', unlock);
    root.addEventListener('keydown', unlock);
  }

  get skills(): Set<SkillId> {
    return new Set(this.save.skills);
  }

  /** Saves the progress on this device and schedules a sync with the server. */
  persist(): void {
    this.save.updatedAt = Date.now();
    writeSave(this.save);
    this.online.schedule();
  }

  saveSettings(): void {
    writeSettings(this.settings);
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.audio.setMuted(this.settings.muted);
    this.saveSettings();
  }

  setVolume(v: number): void {
    this.settings.volume = Math.max(0, Math.min(1, v));
    this.audio.setVolume(this.settings.volume);
    this.saveSettings();
  }

  private applyLang(l: Lang): void {
    setLang(l);
    try {
      document.documentElement.lang = l;
      document.title = T.app.title;
      document.querySelector('meta[name="description"]')?.setAttribute('content', T.app.description);
    } catch {
      // No document (tests).
    }
  }

  /** Switches language and redraws the current menu screen. */
  setLanguage(l: Lang): void {
    if (l === this.settings.lang) return;
    this.settings.lang = l;
    this.saveSettings();
    this.applyLang(l);
    if (this.route !== 'mission') this.go(this.route);
  }

  setServer(url: string): void {
    this.settings.server = url.trim();
    this.saveSettings();
    void this.online.connect(this.settings.server);
  }

  private mount(screen: Screen): void {
    this.screen?.destroy();
    this.root.querySelectorAll('.overlay').forEach((o) => o.remove());
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
    else if (route === 'ranking') this.mount(rankingScreen(this, from === 'campaign' || from === 'mission' ? 'campaign' : 'title'));
    else this.mount(skillsScreen(this, from === 'campaign' || from === 'mission' ? 'campaign' : 'title'));
  }

  /** "Start career": the training mission until it is done or skipped, then the career screen. */
  startCareer(): void {
    if (this.save.training === null && !Object.values(this.save.stars).some((n) => n > 0)) this.startMission(TRAINING.id);
    else this.go('campaign');
  }

  startMission(id: string): void {
    const level = levelById(id);
    if (!level) return;
    this.route = 'mission';
    this.mount(new GameScreen(this, level));
  }

  /** State kept when the page is hot-reloaded. */
  snapshot(): { route: string } {
    return { route: this.route === 'mission' ? 'campaign' : this.route };
  }
}
