// Rankings: overall and per-mission leaderboards from the game server, plus the player's tier.

import { CAMPAIGN } from '../core/levels.ts';
import type { BoardResponse, BoardRow } from '../core/protocol.ts';
import { TIERS, tierFor } from '../core/score.ts';
import { loc, num, T } from '../i18n/index.ts';
import { openAccount } from './accountModal.ts';
import type { App } from './app.ts';
import { h, stars } from './dom.ts';
import type { Screen } from './screens.ts';
import { tierBadge, tierPanel } from './screens.ts';

export function rankingScreen(app: App, back: 'title' | 'campaign'): Screen {
  const R = T.ranking;
  let mission: string | null = null;
  let request = 0;
  let debounce = 0;
  const el = h('div', { class: 'screen ranking-screen' });
  const tabs = h('div', { class: 'segmented tabs board-tabs', role: 'tablist', aria: { label: R.title } });
  const board = h('div', { class: 'board', aria: { live: 'polite' } });
  const side = h('aside', { class: 'board-side' });

  const row = (r: BoardRow, you: boolean) =>
    h(
      'tr',
      { class: you ? 'you' : '' },
      h('td', { class: 'num' }, `#${r.rank}`),
      h('td', { class: 'player' }, r.name, you ? h('small', null, ` · ${R.you}`) : null),
      h('td', null, mission ? stars(r.stars) : tierBadge(tierFor(r.score), true)),
      h('td', { class: 'num' }, num(r.score)),
    );

  const table = (data: BoardResponse) => {
    const me = app.online.session?.name.toLowerCase();
    const rows = data.rows.map((r) => row(r, r.name.toLowerCase() === me));
    if (data.you && !data.rows.some((r) => r.name.toLowerCase() === me)) {
      rows.push(h('tr', { class: 'gap' }, h('td', { colspan: '4' }, '⋯')), row(data.you, true));
    }
    return h(
      'table',
      { class: 'board-table' },
      h(
        'thead',
        null,
        h('tr', null, h('th', { class: 'num' }, R.cols.rank), h('th', null, R.cols.player), h('th', null, mission ? R.cols.stars : R.cols.tier), h('th', { class: 'num' }, R.cols.score)),
      ),
      h('tbody', null, ...rows),
    );
  };

  const load = async () => {
    const id = ++request;
    const o = app.online;
    if (!o.server) {
      board.replaceChildren(h('p', { class: 'notice' }, R.offline), h('p', { class: 'muted' }, T.account.noServer));
      return;
    }
    board.replaceChildren(h('p', { class: 'muted' }, T.common.loading));
    try {
      const data = await o.leaderboard(mission);
      if (id !== request) return;
      const parts: Node[] = [];
      if (!data.rows.length) parts.push(h('p', { class: 'muted' }, R.empty));
      else parts.push(table(data));
      if (data.you) parts.push(h('p', { class: 'your-rank' }, R.yourRank(data.you.rank, data.players)));
      else if (o.signedIn) parts.push(h('p', { class: 'muted' }, R.notRanked));
      else
        parts.push(
          h('p', { class: 'muted' }, R.signInToRank, ' ', h('button', { class: 'linkish', type: 'button', on: { click: () => openAccount(app) } }, T.account.signIn)),
        );
      board.replaceChildren(...parts);
    } catch {
      if (id === request) board.replaceChildren(h('p', { class: 'notice' }, R.error));
    }
  };

  const renderTabs = () => {
    const entries: [string | null, string][] = [[null, R.overall], ...CAMPAIGN.map((l): [string, string] => [l.id, l.company])];
    tabs.replaceChildren(
      ...entries.map(([id, label]) =>
        h(
          'button',
          {
            class: `seg ${id === mission ? 'active' : ''}`,
            type: 'button',
            role: 'tab',
            aria: { selected: String(id === mission) },
            title: id ? loc(CAMPAIGN.find((l) => l.id === id)!.title) : '',
            on: {
              click: () => {
                mission = id;
                renderTabs();
                void load();
              },
            },
          },
          label,
        ),
      ),
    );
  };

  const renderSide = () => {
    side.replaceChildren(
      h('h3', null, T.score.tier),
      tierPanel(app),
      h('h3', null, R.tiers),
      h(
        'ol',
        { class: 'tier-list' },
        ...TIERS.slice(1).map((t) => h('li', null, tierBadge(t, true), h('span', { class: 'muted' }, ` ≥ ${num(t.min)}`))),
      ),
      h('p', { class: 'muted fine' }, R.tiersNote),
    );
  };

  el.append(
    h(
      'header',
      { class: 'screen-head' },
      h('button', { class: 'btn ghost small', type: 'button', on: { click: () => app.go(back) } }, back === 'title' ? T.campaign.backTitle : T.skillsScreen.backCareer),
      h('div', { class: 'head-title' }, h('p', { class: 'eyebrow' }, R.eyebrow), h('h2', null, R.title)),
    ),
    h('div', { class: 'ranking-body' }, h('section', { class: 'board-wrap' }, tabs, board), side),
  );
  renderTabs();
  renderSide();
  void load();
  return {
    el,
    destroy: () => {
      request++;
      window.clearTimeout(debounce);
    },
    refresh: () => {
      renderSide();
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void load(), 400);
    },
  };
}
