# Handoff: work in progress

This file tracks where the current round of work stopped. Delete it once everything below is done.

## Requested by the project owner

1. A game server so that the web version and the Windows `.exe` share accounts and progress.
2. A complete tutorial from the very start of the game, then ranking tiers and leaderboards.
3. The repository in English, and English added to the game (French kept).

## Done (typecheck clean, 61 tests passing, `npm run build` OK)

- **Bilingual game (EN/FR).** `src/i18n/` holds typed dictionaries (`en.ts` is the reference, `fr.ts` must
  match its shape). `T` is a live binding to the current dictionary, `setLang()` switches it. Mission texts
  are inline `Loc` values (`{ en, fr }`) in `src/core/levels.ts`. Language switch on the title screen and
  in Settings; the default language comes from the browser.
- **Identifiers renamed to English:** `fai` → `isp`, `compta` → `acct` (alias `compta` still accepted),
  `cp-N` → `ac-N`, pool `rushs` → `rushes`. Version 1 saves are migrated (`src/app/save.ts`, `migrateV1`).
- **Tutorial.** A new training mission (`training`, order 0, ByteCafé) with a 19-step guided overlay
  (`src/app/tutorial.ts`, steps in `levels.ts`, state in `src/core/guide.ts`). A card explains each step, a
  ring points at the button, device or area, and steps complete on their own. "Start career" launches it
  on first play; the briefing offers "Skip training". Missions 2–5 gained checklists and pop-up hints for
  their new mechanics (saturation, heat, VLAN/subnets/firewall, DDoS, failure, worm, flood).
  Verified end to end in Chromium (all 19 steps, training completes, mission 1 unlocks, no JS error).
- **Scores and tiers.** `src/core/score.ts`: up to 2,900 points per mission (completion, bonus stars,
  satisfaction, reliability, savings). Tier = sum of best scores: Unranked, Bronze (1), Silver (3,500),
  Gold (7,000), Platinum (10,000), Diamond (12,000), Legend (13,500). Shown on the title screen, career
  screen, debrief and rankings screen.
- **Replayable runs (anti-cheat).** The simulation records player actions with their step
  (`Simulation.actions`). `src/core/run.ts` validates a run record (assumes it may be forged) and replays
  it exactly. Engine-dependent math was replaced (`src/core/detmath.ts`) so replays are identical in every
  browser and in Node. `tests/run.test.ts` checks each mission replays to the same score.
- **Client online layer.** `src/app/online.ts` (API client, session, sync with merge in `save.ts`),
  `accountModal.ts`, `settingsModal.ts` (language, volume, server URL), `rankingScreen.ts`. The API
  contract is in `src/core/protocol.ts`. The server address comes from Settings, else the build-time
  `VITE_API_URL`, else the page's own origin (probe of `GET /api/health`).

## Remaining

1. **Server** (`server/`, zero dependency: `node:http`, `node:sqlite`, `node:crypto`, Node ≥ 22.18):
   - Already written: `auth.ts` (scrypt, tokens stored as SHA-256), `db.ts` (schema, saves with optimistic
     versions, best run per mission, leaderboards), `verify.ts` + `verify-worker.ts` (replay in a worker
     thread, bounded queue, watchdog), `limits.ts` (rate limiter).
   - To write: `server/app.ts` (routes below), `server/main.ts` (env: `PORT` 8787, `DATA_DIR`,
     `CORS_ORIGINS` default `*`, `STATIC_DIR` to also serve `dist/index.html`, `TRUST_PROXY`,
     `TOKEN_TTL_DAYS` 90), an admin CLI (list/delete users), `tests/server.test.ts`, a `Dockerfile`, a
     `docker-compose.yml` with Caddy for HTTPS, `"server"` and `"server:dev"` npm scripts, a Vite dev
     proxy `/api` → `http://localhost:8787`, and `server` in `tsconfig.json` `include`.
   - Routes: `GET /api/health`; `POST /api/auth/register|login` → `{ token, user }`;
     `POST /api/auth/logout`; `GET /api/me`; `PUT /api/me/password {current, next}` (revoke other
     sessions); `DELETE /api/me {password}`; `GET/PUT /api/save` (409 `conflict` when the version moved);
     `POST /api/runs {run}` → replay, keep if better, answer with ranks; `GET /api/leaderboard[?mission=]`
     (top 50 + the caller's row). Errors are `{ error: code }` with codes from `T.account.errors`.
   - Run acceptance: the replayed day must succeed, and the skills' cost must not exceed the player's
     verified stars (other missions' bests + this run). Reasons `skills` and `busy` are retryable:
     update `Online.submitBests` so only permanent refusals set `best.rejected`.
   - Rate limits: register 5/h per IP, login 20/15 min per IP and 10/15 min per name, runs 60/h and
     saves 240/h per user, 1 MB body limit on saves and runs.
2. **End-to-end test of the online flow** in a browser (register, sync between two browser profiles,
   run verified, leaderboard).
3. **Windows `.exe` (Tauri 2).** `src-tauri/` is a partial draft: regenerate the icons with
   `npx tauri icon src-tauri/app-icon.png`, then add a GitHub Actions workflow on `windows-latest` that
   runs `npx tauri build` (NSIS installer + portable exe) with `VITE_API_URL` from a repository variable
   and attaches the files to a GitHub Release.
4. **Web version on GitHub Pages** (workflow publishing `dist/`, `VITE_API_URL` from the same variable).
5. **Repository in English:** translate `README.md` and `docs/*.md` (code comments are already English).
6. PR into `main`, green CI, merge, first release.
