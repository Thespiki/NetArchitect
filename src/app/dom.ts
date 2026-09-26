// Mini-assistant DOM : création d'éléments typés, sans innerHTML.

type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  class?: string;
  id?: string;
  title?: string;
  type?: string;
  style?: string;
  disabled?: boolean;
  value?: string;
  placeholder?: string;
  for?: string;
  role?: string;
  tabindex?: number;
  hidden?: boolean;
  data?: Record<string, string>;
  aria?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  [key: string]: unknown;
}

const SPECIAL = new Set(['class', 'style', 'data', 'aria', 'on', 'disabled', 'hidden', 'value', 'for']);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    if (attrs.class) el.className = attrs.class;
    if (attrs.style) el.setAttribute('style', attrs.style);
    if (attrs.data) for (const [k, v] of Object.entries(attrs.data)) el.dataset[k] = v;
    if (attrs.aria) for (const [k, v] of Object.entries(attrs.aria)) el.setAttribute(`aria-${k}`, v);
    if (attrs.on) {
      for (const [k, fn] of Object.entries(attrs.on)) if (fn) el.addEventListener(k, fn as EventListener);
    }
    if (attrs.disabled) (el as HTMLButtonElement).disabled = true;
    if (attrs.hidden) el.hidden = true;
    if (attrs.value !== undefined) (el as HTMLInputElement).value = attrs.value;
    if (attrs.for) el.setAttribute('for', attrs.for);
    for (const [k, v] of Object.entries(attrs)) {
      if (SPECIAL.has(k) || v === undefined || v === null || v === false) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, ...children);
  return el;
}

export function append(el: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replace(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, ...children);
}

export function stars(n: number, max = 3): HTMLSpanElement {
  const wrap = h('span', { class: 'stars', aria: { label: `${n} étoile(s) sur ${max}` } });
  for (let i = 0; i < max; i++) wrap.append(h('i', { class: i < n ? 'on' : '' }, '★'));
  return wrap;
}

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
