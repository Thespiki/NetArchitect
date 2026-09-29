// Account window: sign in or create an account, then sync status, password and account deletion.

import { NAME_RULE, PASSWORD_MAX, PASSWORD_MIN } from '../core/protocol.ts';
import { tierFor } from '../core/score.ts';
import { num, T } from '../i18n/index.ts';
import type { App } from './app.ts';
import { h } from './dom.ts';
import { openModal, type ModalHandle } from './modal.ts';
import { ApiFailure } from './online.ts';
import { totalScore } from './save.ts';
import { openSettings } from './settingsModal.ts';

function errorText(e: unknown): string {
  const code = e instanceof ApiFailure ? e.code : 'unknown';
  return T.account.errors[code] ?? T.account.errors.unknown;
}

function field(id: string, label: string, input: HTMLInputElement, hint?: string): HTMLElement {
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
}

function authForm(app: App, modal: () => ModalHandle | null, mode: 'login' | 'register'): HTMLElement {
  const A = T.account;
  const name = h('input', { type: 'text', autocomplete: 'username', spellcheck: 'false', maxlength: '20', required: true });
  const password = h('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', maxlength: String(PASSWORD_MAX), required: true });
  const confirm = h('input', { type: 'password', autocomplete: 'new-password', maxlength: String(PASSWORD_MAX), required: true });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? A.login : A.register);
  const form = h(
    'form',
    { class: 'auth-form', novalidate: true },
    field(`acc-name-${mode}`, A.username, name, mode === 'register' ? A.usernameHint : undefined),
    field(`acc-pass-${mode}`, A.password, password, mode === 'register' ? A.passwordHint : undefined),
    mode === 'register' ? field(`acc-confirm-${mode}`, A.confirm, confirm) : null,
    error,
    submit,
  );
  const fail = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const n = name.value.trim();
    if (mode === 'register') {
      if (!NAME_RULE.test(n)) return fail(A.errors.bad_name);
      if (password.value.length < PASSWORD_MIN) return fail(A.errors.bad_password);
      if (password.value !== confirm.value) return fail(A.mismatch);
    }
    submit.disabled = true;
    try {
      if (mode === 'login') await app.online.login(n, password.value);
      else await app.online.register(n, password.value);
      modal()?.close();
      openAccount(app, A.welcome(n));
    } catch (err) {
      fail(errorText(err));
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

export function openAccount(app: App, notice?: string): void {
  const A = T.account;
  const o = app.online;
  let handle: ModalHandle | null = null;
  const body: (Node | null)[] = [];

  if (!o.server) {
    body.push(
      h('p', null, A.why),
      h('p', { class: 'notice' }, A.noServer),
      h('p', { class: 'muted' }, A.offline),
    );
    handle = openModal(app.root, {
      eyebrow: A.account,
      title: A.signIn,
      body,
      actions: [
        { label: T.common.close },
        { label: T.settings.title, kind: 'primary', onClick: () => void window.setTimeout(() => openSettings(app)) },
      ],
    });
    return;
  }

  if (!o.signedIn) {
    const tabs = h('div', { class: 'segmented tabs', role: 'tablist' });
    const panel = h('div', { class: 'tab-panel' });
    const show = (mode: 'login' | 'register') => {
      tabs.replaceChildren(
        ...(['login', 'register'] as const).map((m) =>
          h(
            'button',
            { class: `seg ${m === mode ? 'active' : ''}`, type: 'button', role: 'tab', aria: { selected: String(m === mode) }, on: { click: () => show(m) } },
            m === 'login' ? A.login : A.register,
          ),
        ),
      );
      panel.replaceChildren(authForm(app, () => handle, mode));
      panel.querySelector('input')?.focus();
    };
    show('login');
    body.push(h('p', { class: 'muted' }, A.why), tabs, panel, h('p', { class: 'fine' }, A.privacy), h('p', { class: 'fine' }, A.server(new URL(o.server).host)));
    handle = openModal(app.root, { eyebrow: A.account, title: A.signIn, body, actions: [{ label: T.common.close }] });
    return;
  }

  // Signed in.
  const status = h('p', { class: 'sync-status', role: 'status' });
  const renderStatus = () => {
    const last = o.session?.lastSync ? new Date(o.session.lastSync).toLocaleTimeString() : '—';
    status.textContent = o.state === 'syncing' ? A.syncing : o.state === 'error' ? A.syncError : `${A.synced} · ${A.lastSync(last)}`;
    status.dataset.state = o.state;
  };
  renderStatus();
  const stop = o.onChange(renderStatus);
  const total = totalScore(app.save);
  const tier = tierFor(total);
  const rank = o.me?.rank;

  const passForm = h('form', { class: 'auth-form compact', hidden: true, novalidate: true });
  const current = h('input', { type: 'password', autocomplete: 'current-password', maxlength: String(PASSWORD_MAX) });
  const next = h('input', { type: 'password', autocomplete: 'new-password', maxlength: String(PASSWORD_MAX) });
  const passMsg = h('p', { class: 'form-error', role: 'alert', hidden: true });
  passForm.append(field('acc-current', A.currentPassword, current), field('acc-next', A.newPassword, next, A.passwordHint), passMsg, h('button', { class: 'btn primary small', type: 'submit' }, A.changePassword));
  passForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    passMsg.hidden = false;
    passMsg.classList.remove('ok');
    if (next.value.length < PASSWORD_MIN) {
      passMsg.textContent = A.errors.bad_password;
      return;
    }
    try {
      await o.changePassword(current.value, next.value);
      passMsg.textContent = A.passwordChanged;
      passMsg.classList.add('ok');
      current.value = next.value = '';
    } catch (err) {
      passMsg.textContent = errorText(err);
    }
  });

  const confirmDelete = () => {
    const pass = h('input', { type: 'password', autocomplete: 'current-password', maxlength: String(PASSWORD_MAX) });
    const msg = h('p', { class: 'form-error', role: 'alert', hidden: true });
    window.setTimeout(() =>
      openModal(app.root, {
        title: A.deleteTitle,
        body: [h('p', null, A.deleteBody), field('acc-del-pass', A.password, pass), msg],
        actions: [
          { label: T.common.cancel },
          {
            label: A.delete,
            kind: 'danger',
            onClick: () => {
              o.deleteAccount(pass.value).then(
                () => {
                  document.querySelectorAll('.overlay').forEach((x) => x.remove());
                  openAccount(app, A.deleted);
                },
                (err) => {
                  msg.textContent = errorText(err);
                  msg.hidden = false;
                },
              );
              return false;
            },
          },
        ],
      }),
    );
  };

  body.push(
    notice ? h('p', { class: 'notice ok' }, notice) : null,
    h(
      'div',
      { class: 'profile' },
      h('div', { class: 'profile-name' }, h('b', null, o.session!.name), h('span', { class: 'tier-badge', style: `--tier:${tier.color}` }, T.tiers[tier.id])),
      h('p', { class: 'muted' }, `${T.score.career} ${num(total)}${rank ? ` · ${T.ranking.worldRank(rank)}` : ''}`),
    ),
    status,
    h(
      'div',
      { class: 'row-actions' },
      h('button', { class: 'btn ghost small', type: 'button', on: { click: () => void o.sync() } }, A.syncNow),
      h('button', { class: 'btn ghost small', type: 'button', on: { click: () => (passForm.hidden = !passForm.hidden) } }, A.changePassword),
      h('button', { class: 'btn danger small', type: 'button', on: { click: confirmDelete } }, A.deleteAccount),
    ),
    passForm,
    h('p', { class: 'fine' }, A.server(new URL(o.server).host)),
  );
  handle = openModal(app.root, {
    eyebrow: A.account,
    title: A.signedAs(o.session!.name),
    body,
    onClose: stop,
    actions: [
      {
        label: A.logout,
        onClick: () => {
          void o.logout();
        },
      },
      { label: T.common.close, kind: 'primary' },
    ],
  });
}
