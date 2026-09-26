// SQLite storage (node:sqlite, bundled with Node 22.5+): accounts, sessions, saves and the best
// verified run of each player on each mission.

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export interface UserRow {
  id: number;
  name: string;
  name_key: string;
  pass: string;
  created_at: number;
}

export interface RunRow {
  user_id: number;
  mission: string;
  score: number;
  stars: number;
  sim: number;
  created_at: number;
}

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  stars: number;
  at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  pass TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS saves (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission TEXT NOT NULL,
  score INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  sim INTEGER NOT NULL,
  detail TEXT NOT NULL,
  run TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mission)
);
CREATE INDEX IF NOT EXISTS runs_board ON runs(sim, mission, score DESC);
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private get<T>(sql: string, ...args: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }

  private all<T>(sql: string, ...args: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }

  private run(sql: string, ...args: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.db.prepare(sql).run(...args);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // --- Users

  /** Returns the new user id, or null when the name is taken. */
  createUser(name: string, pass: string, now: number): number | null {
    try {
      const r = this.run('INSERT INTO users (name, name_key, pass, created_at) VALUES (?, ?, ?, ?)', name, name.toLowerCase(), pass, now);
      return Number(r.lastInsertRowid);
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) return null;
      throw e;
    }
  }

  userByName(name: string): UserRow | undefined {
    return this.get<UserRow>('SELECT * FROM users WHERE name_key = ?', name.toLowerCase());
  }

  userById(id: number): UserRow | undefined {
    return this.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  }

  setPassword(id: number, pass: string): void {
    this.run('UPDATE users SET pass = ? WHERE id = ?', pass, id);
  }

  deleteUser(id: number): void {
    this.run('DELETE FROM users WHERE id = ?', id);
  }

  listUsers(): { id: number; name: string; created_at: number; runs: number }[] {
    return this.all(
      'SELECT u.id, u.name, u.created_at, (SELECT COUNT(*) FROM runs r WHERE r.user_id = u.id) AS runs FROM users u ORDER BY u.id',
    );
  }

  // --- Sessions (tokens are stored hashed)

  createSession(tokenHash: string, userId: number, now: number, ttl: number): void {
    this.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', tokenHash, userId, now, now + ttl);
  }

  /** The session's user; sliding expiry: every use pushes it back. */
  sessionUser(tokenHash: string, now: number, ttl: number): UserRow | undefined {
    const s = this.get<{ user_id: number; expires_at: number }>('SELECT user_id, expires_at FROM sessions WHERE token = ?', tokenHash);
    if (!s) return undefined;
    if (s.expires_at < now) {
      this.run('DELETE FROM sessions WHERE token = ?', tokenHash);
      return undefined;
    }
    if (s.expires_at - now < ttl - 24 * 3600 * 1000) this.run('UPDATE sessions SET expires_at = ? WHERE token = ?', now + ttl, tokenHash);
    return this.userById(s.user_id);
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM sessions WHERE token = ?', tokenHash);
  }

  /** Signs out every other device (after a password change). */
  deleteOtherSessions(userId: number, keep: string): void {
    this.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', userId, keep);
  }

  purgeSessions(now: number): void {
    this.run('DELETE FROM sessions WHERE expires_at < ?', now);
  }

  // --- Saves

  getSave(userId: number): { data: string; version: number; updated_at: number } | undefined {
    return this.get('SELECT data, version, updated_at FROM saves WHERE user_id = ?', userId);
  }

  /** Writes only if the stored version is still `expected`; returns the new version or null on conflict. */
  putSave(userId: number, data: string, expected: number, now: number): number | null {
    return this.transaction(() => {
      const cur = this.get<{ version: number }>('SELECT version FROM saves WHERE user_id = ?', userId);
      if ((cur?.version ?? 0) !== expected) return null;
      const version = expected + 1;
      this.run(
        'INSERT INTO saves (user_id, data, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at',
        userId,
        data,
        version,
        now,
      );
      return version;
    });
  }

  // --- Runs and leaderboards

  bestRuns(userId: number, sim: number): RunRow[] {
    return this.all<RunRow>('SELECT user_id, mission, score, stars, sim, created_at FROM runs WHERE user_id = ? AND sim = ? ORDER BY mission', userId, sim);
  }

  /** Keeps the run only if it beats the player's previous best on this mission. */
  saveBest(r: RunRow & { detail: string; run: string }): boolean {
    return this.transaction(() => {
      const cur = this.get<{ score: number; sim: number }>('SELECT score, sim FROM runs WHERE user_id = ? AND mission = ?', r.user_id, r.mission);
      if (cur && cur.sim === r.sim && cur.score >= r.score) return false;
      this.run(
        'INSERT INTO runs (user_id, mission, score, stars, sim, detail, run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, mission) DO UPDATE SET score = excluded.score, stars = excluded.stars, sim = excluded.sim, detail = excluded.detail, run = excluded.run, created_at = excluded.created_at',
        r.user_id,
        r.mission,
        r.score,
        r.stars,
        r.sim,
        r.detail,
        r.run,
        r.created_at,
      );
      return true;
    });
  }

  missionBoard(mission: string, sim: number, limit: number): BoardEntry[] {
    return this.all<BoardEntry>(
      `SELECT RANK() OVER (ORDER BY r.score DESC) AS rank, u.name AS name, r.score AS score, r.stars AS stars, r.created_at AS at
       FROM runs r JOIN users u ON u.id = r.user_id
       WHERE r.mission = ? AND r.sim = ?
       ORDER BY r.score DESC, r.created_at ASC LIMIT ?`,
      mission,
      sim,
      limit,
    );
  }

  missionEntry(userId: number, mission: string, sim: number): BoardEntry | undefined {
    const mine = this.get<{ score: number; stars: number; created_at: number; name: string }>(
      'SELECT r.score, r.stars, r.created_at, u.name FROM runs r JOIN users u ON u.id = r.user_id WHERE r.user_id = ? AND r.mission = ? AND r.sim = ?',
      userId,
      mission,
      sim,
    );
    if (!mine) return undefined;
    const better = this.get<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE mission = ? AND sim = ? AND score > ?', mission, sim, mine.score)!.n;
    return { rank: better + 1, name: mine.name, score: mine.score, stars: mine.stars, at: mine.created_at };
  }

  missionPlayers(mission: string, sim: number): number {
    return this.get<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE mission = ? AND sim = ?', mission, sim)!.n;
  }

  overallBoard(sim: number, limit: number): BoardEntry[] {
    return this.all<BoardEntry>(
      `SELECT RANK() OVER (ORDER BY t.score DESC) AS rank, u.name AS name, t.score AS score, t.stars AS stars, t.at AS at
       FROM (SELECT user_id, SUM(score) AS score, SUM(stars) AS stars, MAX(created_at) AS at FROM runs WHERE sim = ? GROUP BY user_id) t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.score DESC, t.at ASC LIMIT ?`,
      sim,
      limit,
    );
  }

  overallEntry(userId: number, sim: number): BoardEntry | undefined {
    const mine = this.get<{ score: number; stars: number; at: number; name: string }>(
      `SELECT SUM(r.score) AS score, SUM(r.stars) AS stars, MAX(r.created_at) AS at, u.name AS name
       FROM runs r JOIN users u ON u.id = r.user_id WHERE r.user_id = ? AND r.sim = ? GROUP BY r.user_id`,
      userId,
      sim,
    );
    if (!mine) return undefined;
    const better = this.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM (SELECT SUM(score) AS s FROM runs WHERE sim = ? GROUP BY user_id) WHERE s > ?',
      sim,
      mine.score,
    )!.n;
    return { rank: better + 1, name: mine.name, score: mine.score, stars: mine.stars, at: mine.at };
  }

  overallPlayers(sim: number): number {
    return this.get<{ n: number }>('SELECT COUNT(DISTINCT user_id) AS n FROM runs WHERE sim = ?', sim)!.n;
  }
}
