// Menu screens: title, career, skill tree. Shared widgets: account chip, language switch, tier badge.

import { euros, LANG_NAMES, LANGS, loc, num, T } from '../i18n/index.ts';
import { TRAFFIC } from '../core/catalog.ts';
import { rankName } from '../core/level.ts';
import { LEVELS } from '../core/levels.ts';
import { nextTier, tierFor, type Tier } from '../core/score.ts';
import { BRANCHES, canBuy, SKILLS, skillById } from '../core/skills.ts';
import { openAccount } from './accountModal.ts';
import type { App } from './app.ts';
import { mountBackdrop } from './backdrop.ts';
import { h, reducedMotion, stars } from './dom.ts';
import { helpBody } from './help.ts';
import { openModal } from './modal.ts';
import { currentRank, isUnlocked, maxStars, rankIndex, skillPoints, totalScore, totalStars } from './save.ts';
import { openSettings } from './settingsModal.ts';

export interface Screen {
  el: HTMLElement;
  destroy(): void;
  /** Redraws what depends on the save or the connection (after a sync). */
  refresh?(): void;
}

export function soundButton(app: App): HTMLButtonElement {
  const btn = h('button', { class: 'btn ghost small', type: 'button' });
  const sync = () => {
    btn.textContent = app.settings.muted ? T.sound.off : T.sound.on;
    btn.setAttribute('aria-pressed', String(!app.settings.muted));
  };
  btn.addEventListener('click', () => {
    app.toggleMute();
    sync();
  });
  sync();
  return btn;
}

export function tierBadge(tier: Tier, small = false): HTMLElement {
  return h('span', { class: `tier-badge ${small ? 'small' : ''}`, style: `--tier:${tier.color}`, data: { tier: tier.id } }, T.tiers[tier.id]);
}

/** Tier, career score and progress towards the next tier. */
export function tierPanel(app: App): HTMLElement {
  const total = totalScore(app.save);
  const tier = tierFor(total);
  const next = nextTier(total);
  return h(
    'div',
    { class: 'tier-panel' },
    h('div', { class: 'tier-head' }, tierBadge(tier), h('span', { class: 'tier-score' }, h('b', null, num(total)), ` · ${T.score.career}`)),
    h('div', { class: 'tier-bar', role: 'progressbar', aria: { valuemin: '0', valuemax: '100', valuenow: String(Math.round((next?.progress ?? 1) * 100)) } }, h('i', { style: `width:${Math.round((next?.progress ?? 1) * 100)}%;--tier:${(next?.tier ?? tier).color}` })),
    h('p', { class: 'tier-next muted' }, next ? T.score.toNext(next.missing, T.tiers[next.tier.id]) : T.score.top),
  );
}

/** Top-right cluster: language switch, settings and account. */
function topBar(app: App): HTMLElement {
  const bar = h('div', { class: 'top-bar' });
  const render = () => {
    const o = app.online;
    const langs = h(
      'div',
      { class: 'segmented lang', role: 'group', aria: { label: T.common.language } },
      ...LANGS.map((l) =>
        h(
          'button',
          {
            class: `seg ${app.settings.lang === l ? 'active' : ''}`,
            type: 'button',
            lang: l,
            title: LANG_NAMES[l],
            aria: { pressed: String(app.settings.lang === l) },
            on: { click: () => app.setLanguage(l) },
          },
          l.toUpperCase(),
        ),
      ),
    );
    const status = !o.server ? 'offline' : o.signedIn ? (o.state === 'syncing' ? 'syncing' : o.state === 'error' ? 'error' : 'online') : 'signed-out';
    const label = o.signedIn && o.session ? o.session.name : o.server ? T.account.signIn : T.account.account;
    const account = h(
      'button',
      { class: 'btn ghost small account-chip', type: 'button', data: { status }, on: { click: () => openAccount(app) } },
      h('i', { class: 'status-dot', aria: { hidden: 'true' } }),
      label,
    );
    bar.replaceChildren(
      langs,
      h('button', { class: 'icon-btn', type: 'button', title: T.settings.title, aria: { label: T.settings.title }, on: { click: () => openSettings(app) } }, '⚙'),
      account,
    );
  };
  render();
  (bar as HTMLElement & { render?: () => void }).render = render;
  return bar;
}

function refreshTopBar(el: HTMLElement): void {
  (el.querySelector('.top-bar') as (HTMLElement & { render?: () => void }) | null)?.render?.();
}

export function titleScreen(app: App): Screen {
  const canvas = h('canvas', { class: 'backdrop', aria: { hidden: 'true' } });
  const legend = h(
    'ul',
    { class: 'title-legend', aria: { label: T.title.legend } },
    ...(['web', 'stream', 'data', 'attack'] as const).map((k) =>
      h('li', null, h('i', { class: 'dot', style: `--c:${TRAFFIC[k].color}` }), TRAFFIC[k].label),
    ),
  );
  const foot = h('footer', { class: 'title-foot' });
  const menu = h('div', { class: 'menu' });
  const renderDynamic = () => {
    const progress = totalStars(app.save) > 0 || app.save.training !== null;
    menu.replaceChildren(
      h('button', { class: 'btn primary big', type: 'button', on: { click: () => app.startCareer() } }, progress ? T.title.continue : T.title.start),
      h('button', { class: 'btn ghost', type: 'button', on: { click: () => app.go('ranking') } }, T.ranking.open),
      h('button', { class: 'btn ghost', type: 'button', on: { click: () => app.go('skills') } }, T.title.skills),
      h(
        'button',
        {
          class: 'btn ghost',
          type: 'button',
          on: {
            click: () =>
              openModal(app.root, { eyebrow: T.title.guide, title: T.title.howTo, body: helpBody(), actions: [{ label: T.common.gotIt, kind: 'primary' }], wide: true }),
          },
        },
        T.title.howTo,
      ),
    );
    const tier = tierFor(totalScore(app.save));
    foot.replaceChildren(
      h('span', null, T.title.rank(currentRank(app.save), totalStars(app.save), maxStars())),
      h('span', { class: 'foot-tier' }, tierBadge(tier, true), ` ${num(totalScore(app.save))}`),
      h('span', { class: 'muted' }, T.title.version),
      soundButton(app),
    );
  };
  renderDynamic();
  const el = h(
    'div',
    { class: 'screen title-screen' },
    canvas,
    topBar(app),
    h(
      'div',
      { class: 'title-card' },
      h('p', { class: 'eyebrow' }, T.title.eyebrow),
      h('h1', { class: 'logo' }, h('span', { class: 'logo-net' }, 'NET'), h('span', { class: 'logo-arch' }, 'ARCHITECT')),
      h('p', { class: 'subtitle' }, T.title.subtitle),
      h('p', { class: 'pitch' }, T.title.pitch),
      menu,
      legend,
    ),
    foot,
  );
  const stop = mountBackdrop(canvas, reducedMotion());
  return {
    el,
    destroy: stop,
    refresh: () => {
      renderDynamic();
      refreshTopBar(el);
    },
  };
}

export function campaignScreen(app: App): Screen {
  const el = h('div', { class: 'screen campaign-screen' });
  const render = () => {
    const save = app.save;
    const rank = rankIndex(save);
    const ladder = h(
      'ol',
      { class: 'ladder', aria: { label: T.campaign.ladder } },
      ...T.ranks.map((r, i) => h('li', { class: i < rank ? 'past' : i === rank ? 'now' : '' }, r)),
    );
    const cards = LEVELS.map((level) => {
      const unlocked = isUnlocked(save, level);
      const got = save.stars[level.id] ?? 0;
      const best = save.best[level.id];
      const training = level.order === 0;
      const done = training ? save.training === 'done' || got > 0 : got > 0;
      const foot = training
        ? h('span', { class: 'muted' }, done ? T.campaign.trainingDone : T.briefing.dayLength(level.dayLength))
        : best && best.score > 0
          ? h('span', { class: 'mc-score' }, T.score.best(best.score), best.verified ? h('i', { class: 'verified', title: T.ranking.verified, aria: { label: T.ranking.verified } }, ' ✔') : null)
          : h('span', { class: 'muted' }, best ? T.campaign.record(euros(best.spent), best.frustration) : T.campaign.budget(euros(level.budget)));
      return h(
        'article',
        { class: `mission-card ${unlocked ? '' : 'locked'} ${done ? 'done' : ''} ${training ? 'training' : ''}` },
        h(
          'div',
          { class: 'mc-top' },
          h('span', { class: 'mc-num' }, String(level.order).padStart(2, '0')),
          h('span', { class: 'mc-rank' }, training ? T.campaign.training : rankName(level.order)),
          stars(got),
        ),
        h('h3', null, level.company),
        h('p', { class: 'mc-title' }, loc(level.title)),
        h('p', { class: 'mc-tag' }, loc(level.tagline)),
        h('ul', { class: 'chips' }, ...level.newMechanics.map((m) => h('li', null, loc(m.title)))),
        h(
          'div',
          { class: 'mc-foot' },
          foot,
          h(
            'button',
            {
              class: `btn ${unlocked ? (done ? 'ghost' : 'primary') : 'ghost'}`,
              type: 'button',
              disabled: !unlocked,
              on: { click: () => app.startMission(level.id) },
            },
            unlocked ? (done ? T.campaign.replay : T.campaign.play) : T.campaign.locked,
          ),
        ),
      );
    });
    el.replaceChildren(
      h(
        'header',
        { class: 'screen-head' },
        h('button', { class: 'btn ghost small', type: 'button', on: { click: () => app.go('title') } }, T.campaign.backTitle),
        h('div', { class: 'head-title' }, h('p', { class: 'eyebrow' }, T.campaign.eyebrow), h('h2', null, T.campaign.heading)),
        h(
          'div',
          { class: 'head-meta' },
          h('span', null, `${T.campaign.rank} `, h('b', null, currentRank(save))),
          h('span', null, h('b', null, `${totalStars(save)}`), ` / ${maxStars()} ★`),
          h('button', { class: 'btn ghost small', type: 'button', on: { click: () => app.go('skills') } }, T.campaign.skills(skillPoints(save))),
          h('button', { class: 'btn ghost small', type: 'button', on: { click: () => app.go('ranking') } }, T.ranking.open),
        ),
      ),
      ladder,
      h('div', { class: 'career-tier' }, tierPanel(app)),
      h('div', { class: 'missions' }, ...cards),
      h('p', { class: 'muted campaign-note' }, T.campaign.note),
    );
  };
  render();
  return { el, destroy: () => {}, refresh: render };
}

export function skillsScreen(app: App, back: 'title' | 'campaign'): Screen {
  const el = h('div', { class: 'screen skills-screen' });
  const render = () => {
    const owned = new Set(app.save.skills);
    const points = skillPoints(app.save);
    const S = T.skillsScreen;
    const changeSkills = (skills: typeof app.save.skills) => {
      app.save.skills = skills;
      app.save.skillsAt = Date.now();
      app.persist();
      render();
    };
    el.replaceChildren(
      h(
        'header',
        { class: 'screen-head' },
        h('button', { class: 'btn ghost small', type: 'button', on: { click: () => app.go(back) } }, back === 'title' ? S.backTitle : S.backCareer),
        h('div', { class: 'head-title' }, h('p', { class: 'eyebrow' }, S.eyebrow), h('h2', null, S.heading)),
        h(
          'div',
          { class: 'head-meta' },
          h('span', { class: 'points' }, S.available(points)),
          h(
            'button',
            {
              class: 'btn ghost small',
              type: 'button',
              disabled: owned.size === 0,
              on: {
                click: () =>
                  openModal(app.root, {
                    title: S.resetTitle,
                    body: [h('p', null, S.resetBody)],
                    actions: [{ label: T.common.cancel }, { label: S.reset, kind: 'danger', onClick: () => changeSkills([]) }],
                  }),
              },
            },
            S.reset,
          ),
        ),
      ),
      h(
        'div',
        { class: 'branches' },
        ...BRANCHES.map((b) => {
          const list = SKILLS.filter((s) => s.branch === b.id);
          const tiers = [...new Set(list.map((s) => s.tier))].sort();
          return h(
            'section',
            { class: `branch branch-${b.id}` },
            h('h3', null, b.name),
            h('p', { class: 'muted' }, b.blurb),
            ...tiers.map((t) =>
              h(
                'div',
                { class: 'tier' },
                ...list
                  .filter((s) => s.tier === t)
                  .map((s) => {
                    const has = owned.has(s.id);
                    const buyable = canBuy(s.id, owned, points);
                    const missing = s.requires.filter((r) => !owned.has(r));
                    return h(
                      'article',
                      { class: `skill ${has ? 'owned' : buyable ? 'available' : 'locked'}` },
                      h('div', { class: 'skill-top' }, h('h4', null, s.name), h('span', { class: 'cost' }, T.common.points(s.cost))),
                      h('p', null, s.desc),
                      missing.length ? h('p', { class: 'req' }, S.requires(missing.map((r) => skillById(r).name).join(', '))) : null,
                      has
                        ? h('span', { class: 'owned-tag' }, S.owned)
                        : h(
                            'button',
                            {
                              class: `btn ${buyable ? 'primary' : 'ghost'} small`,
                              type: 'button',
                              disabled: !buyable,
                              on: {
                                click: () => {
                                  app.audio.sfx('buy');
                                  changeSkills([...app.save.skills, s.id]);
                                },
                              },
                            },
                            buyable ? S.unlock : missing.length ? S.locked : S.noPoints,
                          ),
                    );
                  }),
              ),
            ),
          );
        }),
      ),
      h('p', { class: 'muted campaign-note' }, S.note),
    );
  };
  render();
  return { el, destroy: () => {}, refresh: render };
}

