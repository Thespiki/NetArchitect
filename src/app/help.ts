// Help: game loop, controls, traffic colors and useful commands.

import { TRAFFIC } from '../core/catalog.ts';
import { T } from '../i18n/index.ts';
import { h } from './dom.ts';

export function helpBody(): Node[] {
  const H = T.help;
  const legend = h(
    'ul',
    { class: 'legend-list' },
    ...(['web', 'stream', 'data', 'customer', 'probe', 'attack'] as const).map((k) =>
      h('li', null, h('i', { class: 'dot', style: `--c:${TRAFFIC[k].color}` }), TRAFFIC[k].label),
    ),
  );
  return [
    h(
      'div',
      { class: 'help-grid' },
      h(
        'section',
        null,
        h('h3', null, H.loop),
        h('ol', { class: 'phase-list' }, ...H.phases.map(([name, text]) => h('li', null, h('b', null, name), text))),
        h('h3', null, H.colors),
        legend,
        h('p', { class: 'muted' }, H.colorsNote),
      ),
      h(
        'section',
        null,
        h('h3', null, H.controls),
        h('dl', { class: 'keys' }, ...H.keys.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
        h('h3', null, H.console),
        h('dl', { class: 'keys cmds' }, ...H.commands.flatMap(([k, v]) => [h('dt', null, h('code', null, k)), h('dd', null, v)])),
        h('p', { class: 'muted' }, H.consoleNote),
      ),
    ),
  ];
}
