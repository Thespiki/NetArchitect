// Game server client: account, progress sync and leaderboards.
// The game works fully offline; everything here is optional and fails quietly.

import { CAMPAIGN } from '../core/levels.ts';
import type {
  AuthResponse,
  BoardResponse,
  HealthResponse,
  MeResponse,
  PutSaveResponse,
  RunResponse,
  SaveResponse,
} from '../core/protocol.ts';
import { SIM_VERSION, type RunRecord } from '../core/run.ts';
import { coerceSave, mergeSaves, sameProgress, type SaveData } from './save.ts';

const SESSION_KEY = 'netarchitect.session.v1';
/** Server set at build time (VITE_API_URL), used when the settings leave the field empty. */
export const BUILT_IN_SERVER: string = String(import.meta.env.VITE_API_URL ?? '').trim();

export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** "example.com/" → "https://example.com"; null when it is not a usable address. */
export function normalizeServer(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

interface StoredSession {
  server: string;
  token: string;
  name: string;
  /** Version of the save on the server at the last sync. */
  version: number;
  lastSync: number;
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof s.server !== 'string' || typeof s.token !== 'string' || typeof s.name !== 'string') return null;
    return { server: s.server, token: s.token, name: s.name, version: Number(s.version) || 0, lastSync: Number(s.lastSync) || 0 };
  } catch {
    return null;
  }
}

function storeSession(s: StoredSession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Without storage the session lasts until the page is closed.
  }
}

export interface OnlineHost {
  getSave(): SaveData;
  /** Replaces the local progress (after a merge) without scheduling another sync. */
  setSave(save: SaveData): void;
}

export type OnlineState = 'offline' | 'signed-out' | 'idle' | 'syncing' | 'error';

export class Online {
  /** API base address, once a server answered. */
  server: string | null = null;
  session: StoredSession | null = loadSession();
  state: OnlineState = 'offline';
  me: MeResponse | null = null;
  private readonly host: OnlineHost;
  private readonly listeners = new Set<() => void>();
  private timer = 0;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(host: OnlineHost) {
    this.host = host;
  }

  get signedIn(): boolean {
    return !!this.session && !!this.server && this.session.server === this.server;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private setState(s: OnlineState): void {
    this.state = s;
    this.emit();
  }

  /** Servers to try, in order: the one from the settings, the built-in one, then this page's own origin. */
  static candidates(custom: string): string[] {
    const out: string[] = [];
    const add = (s: string | null) => {
      if (s && !out.includes(s)) out.push(s);
    };
    add(normalizeServer(custom));
    if (!custom.trim()) {
      add(normalizeServer(BUILT_IN_SERVER));
      try {
        if (location.protocol === 'http:' || location.protocol === 'https:') add(location.origin);
      } catch {
        // No location (tests).
      }
    }
    return out;
  }

  static async probe(server: string): Promise<boolean> {
    try {
      const res = await fetch(`${server}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return false;
      const body = (await res.json()) as Partial<HealthResponse>;
      return body.app === 'netarchitect' && body.ok === true;
    } catch {
      return false;
    }
  }

  /** Finds a reachable server, then syncs if the player is signed in. */
  async connect(custom: string): Promise<void> {
    this.server = null;
    this.me = null;
    this.setState('offline');
    for (const candidate of Online.candidates(custom)) {
      if (await Online.probe(candidate)) {
        this.server = candidate;
        break;
      }
    }
    if (!this.server) return;
    if (this.session && this.session.server !== this.server) this.session = null;
    this.setState(this.session ? 'idle' : 'signed-out');
    if (this.session) void this.sync();
  }

  private async request<R>(method: string, path: string, body?: unknown, auth = true): Promise<R> {
    if (!this.server) throw new ApiFailure('network', 0);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.session) headers.Authorization = `Bearer ${this.session.token}`;
    let res: Response;
    try {
      res = await fetch(`${this.server}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApiFailure('network', 0);
    }
    if (res.status === 204) return undefined as R;
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Not JSON: handled below.
    }
    if (!res.ok) {
      const code = typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : res.status >= 500 ? 'server' : 'unknown';
      if (res.status === 401 && auth && this.session) this.dropSession();
      throw new ApiFailure(code, res.status);
    }
    return data as R;
  }

  private dropSession(): void {
    this.session = null;
    this.me = null;
    storeSession(null);
    this.setState(this.server ? 'signed-out' : 'offline');
  }

  private startSession(auth: AuthResponse): void {
    this.session = { server: this.server!, token: auth.token, name: auth.user.name, version: 0, lastSync: 0 };
    storeSession(this.session);
    this.setState('idle');
  }

  async register(name: string, password: string): Promise<void> {
    this.startSession(await this.request<AuthResponse>('POST', '/api/auth/register', { name, password }, false));
    await this.sync();
  }

  async login(name: string, password: string): Promise<void> {
    this.startSession(await this.request<AuthResponse>('POST', '/api/auth/login', { name, password }, false));
    await this.sync();
  }

  async logout(): Promise<void> {
    try {
      await this.request('POST', '/api/auth/logout');
    } catch {
      // The token is forgotten locally either way.
    }
    this.dropSession();
  }

  async changePassword(current: string, next: string): Promise<void> {
    await this.request('PUT', '/api/me/password', { current, next });
  }

  async deleteAccount(password: string): Promise<void> {
    await this.request('DELETE', '/api/me', { password });
    this.dropSession();
  }

  async leaderboard(mission: string | null): Promise<BoardResponse> {
    const q = mission ? `?mission=${encodeURIComponent(mission)}` : '';
    return this.request<BoardResponse>('GET', `/api/leaderboard${q}`, undefined, true);
  }

  /** Sends a run for verification; the local best is flagged with the verdict. */
  async submitRun(run: RunRecord): Promise<RunResponse> {
    const res = await this.request<RunResponse>('POST', '/api/runs', { run });
    const save = this.host.getSave();
    const best = save.best[run.level];
    if (best?.run === run || (best?.run && JSON.stringify(best.run) === JSON.stringify(run))) {
      if (res.accepted) {
        best.verified = true;
        best.score = res.score;
      } else best.rejected = true;
      this.host.setSave(save);
    }
    this.schedule();
    return res;
  }

  /** Syncs a few seconds after the last local change. */
  schedule(delay = 4000): void {
    if (!this.signedIn) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.sync(), delay);
  }

  /** Uploads unverified bests, then merges the progress of this device with the server's. */
  async sync(): Promise<void> {
    if (!this.signedIn) return;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.doSync().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.schedule(500);
      }
    });
    return this.running;
  }

  private async doSync(): Promise<void> {
    this.setState('syncing');
    try {
      this.me = await this.request<MeResponse>('GET', '/api/me');
      await this.submitBests();
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await this.request<SaveResponse>('GET', '/api/save');
        const local = this.host.getSave();
        const theirs = remote.save ? coerceSave(remote.save) : null;
        const merged = theirs ? mergeSaves(local, theirs) : local;
        this.host.setSave(merged);
        if (theirs && sameProgress(merged, theirs)) {
          this.session!.version = remote.version;
          break;
        }
        try {
          const put = await this.request<PutSaveResponse>('PUT', '/api/save', { save: merged, version: remote.version });
          this.session!.version = put.version;
          break;
        } catch (e) {
          if (e instanceof ApiFailure && e.code === 'conflict') continue;
          throw e;
        }
      }
      if (!this.session) return;
      this.session.lastSync = Date.now();
      storeSession(this.session);
      this.setState('idle');
    } catch (e) {
      if (this.session) this.setState('error');
      if (!(e instanceof ApiFailure)) throw e;
    }
  }

  private async submitBests(): Promise<void> {
    const save = this.host.getSave();
    const server = new Map((this.me?.bests ?? []).map((b) => [b.mission, b.score]));
    let changed = false;
    for (const level of CAMPAIGN) {
      const best = save.best[level.id];
      if (!best?.run || best.verified || best.rejected || best.run.v !== SIM_VERSION) continue;
      if ((server.get(level.id) ?? -1) >= best.score) continue;
      const res = await this.request<RunResponse>('POST', '/api/runs', { run: best.run });
      if (res.accepted) {
        best.verified = true;
        best.score = res.score;
      } else best.rejected = true;
      changed = true;
    }
    if (changed) {
      this.host.setSave(save);
      this.me = await this.request<MeResponse>('GET', '/api/me');
    }
  }
}
