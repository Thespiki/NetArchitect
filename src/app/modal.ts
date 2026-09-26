// In-page modal dialogs (no native alert/confirm).

import { h } from './dom.ts';

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'ghost' | 'danger';
  onClick?: () => void | boolean;
}

export interface ModalOptions {
  eyebrow?: string;
  title: string;
  body: (Node | string | null | undefined | false)[];
  actions: ModalAction[];
  wide?: boolean;
  dismissible?: boolean;
  onClose?: () => void;
  className?: string;
}

export interface ModalHandle {
  close(): void;
  el: HTMLElement;
}

let openCount = 0;

export function modalOpen(): boolean {
  return openCount > 0;
}

export function openModal(host: HTMLElement, opts: ModalOptions): ModalHandle {
  const previous = document.activeElement as HTMLElement | null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCount--;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
    previous?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissible !== false) {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  const actions = h(
    'div',
    { class: 'modal-actions' },
    ...opts.actions.map((a) =>
      h(
        'button',
        {
          class: `btn ${a.kind ?? 'ghost'}`,
          type: 'button',
          on: {
            click: () => {
              if (a.onClick?.() !== false) close();
            },
          },
        },
        a.label,
      ),
    ),
  );
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
  const dialog = h(
    'div',
    { class: `modal ${opts.wide ? 'wide' : ''} ${opts.className ?? ''}`, role: 'dialog', aria: { modal: 'true', labelledby: titleId } },
    opts.eyebrow ? h('p', { class: 'eyebrow' }, opts.eyebrow) : null,
    h('h2', { id: titleId }, opts.title),
    h('div', { class: 'modal-body' }, ...opts.body),
    actions,
  );
  const overlay = h('div', {
    class: 'overlay',
    on: {
      mousedown: (e) => {
        if (e.target === overlay && opts.dismissible !== false) close();
      },
    },
  });
  overlay.append(dialog);
  host.append(overlay);
  openCount++;
  document.addEventListener('keydown', onKey, true);
  const first = actions.querySelector<HTMLButtonElement>('.btn.primary') ?? actions.querySelector<HTMLButtonElement>('.btn');
  requestAnimationFrame(() => first?.focus());
  return { close, el: dialog };
}
