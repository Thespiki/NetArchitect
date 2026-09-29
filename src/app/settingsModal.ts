// Settings window: language, sound and game server address.

import { LANG_NAMES, LANGS, T } from '../i18n/index.ts';
import type { App } from './app.ts';
import { h } from './dom.ts';
import { openModal } from './modal.ts';
import { BUILT_IN_SERVER, normalizeServer, Online } from './online.ts';

export function openSettings(app: App): void {
  const S = T.settings;
  const lang = h(
    'select',
    { id: 'set-lang', aria: { label: S.language } },
    ...LANGS.map((l) => {
      const opt = h('option', { value: l, lang: l }, LANG_NAMES[l]);
      if (l === app.settings.lang) opt.selected = true;
      return opt;
    }),
  );
  const mute = h('input', { id: 'set-sound', type: 'checkbox' });
  mute.checked = !app.settings.muted;
  const volume = h('input', { id: 'set-volume', type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(app.settings.volume * 100)) });
  volume.addEventListener('input', () => app.setVolume(Number(volume.value) / 100));
  mute.addEventListener('change', () => {
    if (mute.checked === app.settings.muted) app.toggleMute();
  });

  const server = h('input', {
    id: 'set-server',
    type: 'url',
    value: app.settings.server,
    placeholder: BUILT_IN_SERVER || 'https://…',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const result = h('span', { class: 'test-result', role: 'status' });
  const test = h('button', { class: 'btn ghost small', type: 'button' }, S.test);
  test.addEventListener('click', async () => {
    const candidates = Online.candidates(server.value);
    result.textContent = S.testing;
    result.dataset.ok = '';
    let ok = false;
    for (const c of candidates) if ((ok = await Online.probe(c))) break;
    result.textContent = ok ? S.testOk : S.testFail;
    result.dataset.ok = String(ok);
  });

  openModal(app.root, {
    eyebrow: 'NetArchitect',
    title: S.title,
    className: 'settings',
    body: [
      h('div', { class: 'field' }, h('label', { for: 'set-lang' }, S.language), lang),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'set-volume' }, S.volume),
        h('div', { class: 'inline' }, h('label', { class: 'check' }, mute, ` ${S.sound}`), volume),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'set-server' }, S.server),
        h('div', { class: 'inline' }, server, test),
        h('small', { class: 'muted' }, S.serverHint),
        h('small', { class: 'muted' }, S.serverDefault(BUILT_IN_SERVER || S.serverNone)),
        result,
      ),
    ],
    actions: [
      { label: T.common.cancel },
      {
        label: S.save,
        kind: 'primary',
        onClick: () => {
          const raw = server.value.trim();
          if (raw && !normalizeServer(raw)) {
            result.textContent = S.testFail;
            result.dataset.ok = 'false';
            return false;
          }
          if (raw !== app.settings.server) app.setServer(raw);
          const l = lang.value;
          if (l === 'en' || l === 'fr') window.setTimeout(() => app.setLanguage(l));
          return true;
        },
      },
    ],
  });
}
