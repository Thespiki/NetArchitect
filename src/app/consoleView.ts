// Terminal-style console: event log + command input, history and completion.

import { commandNames, execute, type ConsoleHost, type Line } from '../core/console.ts';
import type { LogEntry } from '../core/simulation.ts';
import { T } from '../i18n/index.ts';
import { h } from './dom.ts';

export class ConsoleView {
  readonly el: HTMLElement;
  private readonly out: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly host: ConsoleHost;
  private readonly history: string[] = [];
  private hIndex = -1;
  private readonly onRun: (cmd: string, lines: Line[]) => void;
  collapsed: boolean;

  constructor(host: ConsoleHost, prompt: string, onRun: (cmd: string, lines: Line[]) => void, collapsed: boolean) {
    this.host = host;
    this.onRun = onRun;
    this.collapsed = collapsed;
    this.out = h('div', { class: 'console-out', role: 'log', aria: { live: 'polite' } });
    this.input = h('input', {
      class: 'console-input',
      id: 'console-input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: T.consoleView.placeholder,
      aria: { label: T.consoleView.aria },
    });
    const toggle = h('button', { class: 'console-toggle', type: 'button', aria: { expanded: String(!collapsed) } }, T.consoleView.toggle);
    toggle.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    const form = h('form', { class: 'console-form' }, h('label', { class: 'prompt', for: 'console-input' }, prompt), this.input);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.run(this.input.value);
      this.input.value = '';
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.el = h(
      'section',
      { class: `console ${collapsed ? 'collapsed' : ''}`, aria: { label: T.consoleView.toggle }, data: { tut: 'console' } },
      h('div', { class: 'console-bar' }, toggle, h('span', { class: 'console-hint' }, T.consoleView.hint)),
      h('div', { class: 'console-body' }, this.out, form),
    );
    this.toggleBtn = toggle;
  }

  private readonly toggleBtn: HTMLButtonElement;

  setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.el.classList.toggle('collapsed', c);
    this.toggleBtn.setAttribute('aria-expanded', String(!c));
    if (!c) this.scroll();
  }

  focus(): void {
    this.setCollapsed(false);
    this.input.focus();
  }

  run(raw: string): void {
    const cmd = raw.trim();
    if (!cmd) return;
    this.history.push(cmd);
    this.hIndex = this.history.length;
    this.print([{ text: `> ${cmd}`, tone: 'cmd' }]);
    const lines = execute(cmd, this.host);
    if (lines.some((l) => l.tone === 'clear')) this.out.replaceChildren();
    else this.print(lines);
    this.onRun(cmd, lines);
  }

  print(lines: Line[]): void {
    for (const l of lines) this.out.append(h('div', { class: `ln ${l.tone ?? ''}` }, l.text || ' '));
    while (this.out.childElementCount > 400) this.out.firstElementChild?.remove();
    this.scroll();
  }

  log(entry: LogEntry, clock: string, onAction: (cmd: string) => void): void {
    const row = h('div', { class: `ln log ${entry.level}` }, h('span', { class: 'ts' }, clock), ' ', entry.text);
    if (entry.action) {
      const { cmd, label } = entry.action;
      row.append(' ', h('button', { class: 'log-action', type: 'button', on: { click: () => onAction(cmd) } }, label));
    }
    this.out.append(row);
    this.scroll();
  }

  private scroll(): void {
    this.out.scrollTop = this.out.scrollHeight;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.hIndex = Math.max(0, this.hIndex - 1);
      this.input.value = this.history[this.hIndex] ?? '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.hIndex = Math.min(this.history.length, this.hIndex + 1);
      this.input.value = this.history[this.hIndex] ?? '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const v = this.input.value;
      if (v.includes(' ')) return;
      const matches = commandNames().filter((n) => n.startsWith(v.toLowerCase()));
      if (matches.length === 1) this.input.value = `${matches[0]} `;
      else if (matches.length > 1) this.print([{ text: matches.join('  '), tone: 'dim' }]);
    } else if (e.key === 'Escape') {
      this.input.blur();
    }
    e.stopPropagation();
  }
}
