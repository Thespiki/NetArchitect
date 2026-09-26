// Aide : phases, contrôles, couleurs du trafic et commandes utiles.

import { TRAFFIC } from '../core/catalog.ts';
import { h } from './dom.ts';

export function helpBody(): Node[] {
  const legend = h(
    'ul',
    { class: 'legend-list' },
    ...(['web', 'stream', 'data', 'customer', 'probe', 'attack'] as const).map((k) =>
      h('li', null, h('i', { class: 'dot', style: `--c:${TRAFFIC[k].color}` }), TRAFFIC[k].label),
    ),
  );
  const keys: [string, string][] = [
    ['1 – 6', 'Choisir un équipement (switch, routeur, borne Wi-Fi…)'],
    ['7 / 8', 'Tirer un câble RJ45 / fibre (clic sur A, puis sur B)'],
    ['X ou Suppr', 'Outil suppression, ou supprimer la sélection'],
    ['Échap / clic droit', 'Revenir à l’outil de sélection'],
    ['Tab ou V', 'Basculer plan physique ⇄ vue topologique'],
    ['Espace', 'Pause pendant la journée'],
    ['² ou `', 'Ouvrir la console'],
    ['Ctrl + Z', 'Annuler la dernière modification du plan'],
    ['Molette / glisser', 'Zoomer / se déplacer · F pour recadrer'],
  ];
  const cmds: [string, string][] = [
    ['ping compta internet', 'Tester un accès (et le voir sur le plan)'],
    ['vlan compta 10', 'Mettre un groupe dans un VLAN'],
    ['subnet 10 10.42.0.16/29', 'Attribuer un sous-réseau'],
    ['fw deny compta labdata', 'Bloquer un accès au pare-feu'],
    ['top · top src · tcpdump', 'Analyser le trafic pendant une attaque'],
    ['block udp 123', 'Bloquer un port partout'],
    ['dispatch sw-2', 'Envoyer un technicien'],
  ];
  return [
    h(
      'div',
      { class: 'help-grid' },
      h(
        'section',
        null,
        h('h3', null, 'La boucle de jeu'),
        h(
          'ol',
          { class: 'phase-list' },
          h('li', null, h('b', null, 'Architecture'), ' · pose routeurs, switchs et bornes Wi-Fi, tire les câbles sans dépasser le budget.'),
          h('li', null, h('b', null, 'Configuration'), ' · VLAN, sous-réseaux, pare-feu et répartition de charge, au formulaire ou à la console.'),
          h('li', null, h('b', null, 'Journée'), ' · les paquets circulent de 9 h à 18 h. Garde la frustration sous 100 % et réagis aux incidents.'),
        ),
        h('h3', null, 'Couleurs du trafic'),
        legend,
        h('p', { class: 'muted' }, 'Un câble qui vire à l’orange puis au rouge est saturé. Les points qui tournent autour d’un équipement sont des paquets en file d’attente.'),
      ),
      h(
        'section',
        null,
        h('h3', null, 'Contrôles'),
        h('dl', { class: 'keys' }, ...keys.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
        h('h3', null, 'Console'),
        h('dl', { class: 'keys cmds' }, ...cmds.flatMap(([k, v]) => [h('dt', null, h('code', null, k)), h('dd', null, v)])),
        h('p', { class: 'muted' }, 'Tape « aide » dans la console pour la liste complète.'),
      ),
    ),
  ];
}
