// Écrans hors mission : titre, carrière, arbre de compétences.

import { euros, TRAFFIC } from '../core/catalog.ts';
import { LEVELS } from '../core/levels.ts';
import { BRANCHES, canBuy, SKILLS, skillById } from '../core/skills.ts';
import type { App } from './app.ts';
import { mountBackdrop } from './backdrop.ts';
import { h, reducedMotion, stars } from './dom.ts';
import { helpBody } from './help.ts';
import { openModal } from './modal.ts';
import { currentRank, isUnlocked, RANKS, skillPoints, totalStars } from './save.ts';

export interface Screen {
  el: HTMLElement;
  destroy(): void;
}

function soundButton(app: App): HTMLButtonElement {
  const btn = h('button', { class: 'btn ghost small', type: 'button' });
  const sync = () => {
    btn.textContent = app.save.muted ? 'Son coupé' : 'Son activé';
    btn.setAttribute('aria-pressed', String(!app.save.muted));
  };
  btn.addEventListener('click', () => {
    app.toggleMute();
    sync();
  });
  sync();
  return btn;
}

export function titleScreen(app: App): Screen {
  const canvas = h('canvas', { class: 'backdrop', aria: { hidden: 'true' } });
  const progress = totalStars(app.save) > 0;
  const legend = h(
    'ul',
    { class: 'title-legend', aria: { label: 'Couleurs du trafic' } },
    ...(['web', 'stream', 'data', 'attack'] as const).map((k) =>
      h('li', null, h('i', { class: 'dot', style: `--c:${TRAFFIC[k].color}` }), TRAFFIC[k].label),
    ),
  );
  const el = h(
    'div',
    { class: 'screen title-screen' },
    canvas,
    h(
      'div',
      { class: 'title-card' },
      h('p', { class: 'eyebrow' }, 'Réflexion · gestion · réseau'),
      h('h1', { class: 'logo' }, h('span', { class: 'logo-net' }, 'NET'), h('span', { class: 'logo-arch' }, 'ARCHITECT')),
      h('p', { class: 'subtitle' }, 'L’Art du Routage'),
      h(
        'p',
        { class: 'pitch' },
        'Tu es l’administrateur réseau. Pose les switchs, tire les câbles, découpe les VLAN, puis tiens la journée : chaque paquet qui traîne fait monter la frustration.',
      ),
      h(
        'div',
        { class: 'menu' },
        h('button', { class: 'btn primary big', type: 'button', on: { click: () => app.go('campaign') } }, progress ? 'Continuer la carrière' : 'Commencer la carrière'),
        h('button', { class: 'btn ghost', type: 'button', on: { click: () => app.go('skills') } }, 'Arbre de compétences'),
        h(
          'button',
          {
            class: 'btn ghost',
            type: 'button',
            on: { click: () => openModal(app.root, { eyebrow: 'Guide', title: 'Comment jouer', body: helpBody(), actions: [{ label: 'Compris', kind: 'primary' }], wide: true }) },
          },
          'Comment jouer',
        ),
      ),
      legend,
    ),
    h(
      'footer',
      { class: 'title-foot' },
      h('span', null, `Rang : ${currentRank(app.save)} · ${totalStars(app.save)}/${LEVELS.length * 3} ★`),
      h('span', { class: 'muted' }, 'Prototype 0.1 · progression enregistrée dans ce navigateur'),
      soundButton(app),
    ),
  );
  const stop = mountBackdrop(canvas, reducedMotion());
  return { el, destroy: stop };
}

export function campaignScreen(app: App): Screen {
  const save = app.save;
  const rank = currentRank(save);
  const rankIndex = RANKS.indexOf(rank);
  const ladder = h(
    'ol',
    { class: 'ladder', aria: { label: 'Progression de carrière' } },
    ...RANKS.slice(1).map((r, i) => h('li', { class: i + 1 < rankIndex ? 'past' : i + 1 === rankIndex ? 'now' : '' }, r)),
  );
  const cards = LEVELS.map((level) => {
    const unlocked = isUnlocked(save, level);
    const got = save.stars[level.id] ?? 0;
    const best = save.best[level.id];
    const play = () => app.startMission(level.id);
    return h(
      'article',
      { class: `mission-card ${unlocked ? '' : 'locked'} ${got ? 'done' : ''}` },
      h(
        'div',
        { class: 'mc-top' },
        h('span', { class: 'mc-num' }, String(level.order).padStart(2, '0')),
        h('span', { class: 'mc-rank' }, level.rank),
        stars(got),
      ),
      h('h3', null, level.company),
      h('p', { class: 'mc-title' }, level.title),
      h('p', { class: 'mc-tag' }, level.tagline),
      h('ul', { class: 'chips' }, ...level.newMechanics.map((m) => h('li', null, m.title))),
      h(
        'div',
        { class: 'mc-foot' },
        h('span', { class: 'muted' }, best ? `Record : ${euros(best.spent)} · frustration ${Math.round(best.frustration)} %` : `Budget ${euros(level.budget)}`),
        h(
          'button',
          { class: `btn ${unlocked ? (got ? 'ghost' : 'primary') : 'ghost'}`, type: 'button', disabled: !unlocked, on: { click: play } },
          unlocked ? (got ? 'Rejouer' : 'Jouer') : 'Verrouillée',
        ),
      ),
    );
  });
  const el = h(
    'div',
    { class: 'screen campaign-screen' },
    h(
      'header',
      { class: 'screen-head' },
      h('button', { class: 'btn ghost small', type: 'button', on: { click: () => app.go('title') } }, '← Titre'),
      h('div', { class: 'head-title' }, h('p', { class: 'eyebrow' }, 'Mode campagne'), h('h2', null, 'Carrière')),
      h(
        'div',
        { class: 'head-meta' },
        h('span', null, 'Rang ', h('b', null, rank)),
        h('span', null, h('b', null, `${totalStars(save)}`), ` / ${LEVELS.length * 3} ★`),
        h('button', { class: 'btn ghost small', type: 'button', on: { click: () => app.go('skills') } }, `Compétences · ${skillPoints(save)} pt`),
      ),
    ),
    ladder,
    h('div', { class: 'missions' }, ...cards),
    h(
      'p',
      { class: 'muted campaign-note' },
      'Chaque étoile rapporte un point de compétence. La suite de la carrière (multi-sites, VPN, cloud hybride) est prévue dans la feuille de route.',
    ),
  );
  return { el, destroy: () => {} };
}

export function skillsScreen(app: App, back: 'title' | 'campaign'): Screen {
  const el = h('div', { class: 'screen skills-screen' });
  const render = () => {
    const owned = new Set(app.save.skills);
    const points = skillPoints(app.save);
    el.replaceChildren(
      h(
        'header',
        { class: 'screen-head' },
        h('button', { class: 'btn ghost small', type: 'button', on: { click: () => app.go(back) } }, back === 'title' ? '← Titre' : '← Carrière'),
        h('div', { class: 'head-title' }, h('p', { class: 'eyebrow' }, 'Améliorations'), h('h2', null, 'Arbre de compétences')),
        h(
          'div',
          { class: 'head-meta' },
          h('span', { class: 'points' }, h('b', null, String(points)), ` point${points > 1 ? 's' : ''} disponible${points > 1 ? 's' : ''}`),
          h(
            'button',
            {
              class: 'btn ghost small',
              type: 'button',
              disabled: owned.size === 0,
              on: {
                click: () =>
                  openModal(app.root, {
                    title: 'Réinitialiser les compétences ?',
                    body: [h('p', null, 'Tous les points dépensés te seront rendus.')],
                    actions: [
                      { label: 'Annuler' },
                      {
                        label: 'Réinitialiser',
                        kind: 'danger',
                        onClick: () => {
                          app.save.skills = [];
                          app.persist();
                          render();
                        },
                      },
                    ],
                  }),
              },
            },
            'Réinitialiser',
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
                      h('div', { class: 'skill-top' }, h('h4', null, s.name), h('span', { class: 'cost' }, `${s.cost} pt`)),
                      h('p', null, s.desc),
                      missing.length ? h('p', { class: 'req' }, `Requiert : ${missing.map((r) => skillById(r).name).join(', ')}`) : null,
                      has
                        ? h('span', { class: 'owned-tag' }, 'Acquis')
                        : h(
                            'button',
                            {
                              class: `btn ${buyable ? 'primary' : 'ghost'} small`,
                              type: 'button',
                              disabled: !buyable,
                              on: {
                                click: () => {
                                  app.save.skills.push(s.id);
                                  app.persist();
                                  app.audio.sfx('buy');
                                  render();
                                },
                              },
                            },
                            buyable ? 'Débloquer' : missing.length ? 'Verrouillé' : 'Pas assez de points',
                          ),
                    );
                  }),
              ),
            ),
          );
        }),
      ),
      h('p', { class: 'muted campaign-note' }, 'Les étoiles de mission donnent des points. Les compétences s’appliquent à toutes les missions, y compris quand tu les rejoues.'),
    );
  };
  render();
  return { el, destroy: () => {} };
}
