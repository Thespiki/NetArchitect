// Game server API: request and response shapes shared by the client and the server.
// Errors come back as { error: code } with an HTTP status; the codes match T.account.errors.

export interface ApiUser {
  id: number;
  name: string;
  createdAt: number;
}

export interface HealthResponse {
  app: 'netarchitect';
  ok: true;
  version: string;
  /** Simulation version (SIM_VERSION): runs from another version cannot be verified. */
  sim: number;
}

export interface AuthRequest {
  name: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: ApiUser;
}

export interface PasswordRequest {
  current: string;
  next: string;
}

export interface SaveResponse {
  /** Progress as stored by the client (opaque to the server), or null before the first upload. */
  save: unknown;
  /** Increases with every upload: sent back to detect concurrent writes. */
  version: number;
  updatedAt: number | null;
}

export interface PutSaveRequest {
  save: unknown;
  version: number;
}

export interface PutSaveResponse {
  version: number;
}

export interface BestEntry {
  mission: string;
  score: number;
  stars: number;
  at: number;
}

export interface MeResponse {
  user: ApiUser;
  /** Sum of the verified bests. */
  total: number;
  /** Position in the overall ranking (null without any verified score). */
  rank: number | null;
  players: number;
  bests: BestEntry[];
}

export type RunResponse =
  | {
      accepted: true;
      score: number;
      stars: number;
      /** Best verified score on this mission after this run. */
      best: number;
      improved: boolean;
      missionRank: number;
      total: number;
      rank: number;
      players: number;
    }
  | { accepted: false; reason: string };

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
  stars: number;
  at: number;
}

export interface BoardResponse {
  /** Mission id, or null for the overall ranking. */
  mission: string | null;
  rows: BoardRow[];
  /** The signed-in player's row, even outside the top of the list. */
  you: BoardRow | null;
  players: number;
}

export const NAME_RULE = /^[A-Za-z0-9_.-]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
