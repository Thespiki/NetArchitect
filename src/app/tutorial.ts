// Tutorial overlay: a card that explains the current step and a ring that points at the right
// button, device or area. Steps complete by themselves when the player does what they ask.

import type { CoachTip, GuideState, GuideStep, GuideTarget } from '../core/guide.ts';
import { loc, T } from '../i18n/index.ts';
import { h } from './dom.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoachOptions {
  steps: GuideStep[];
  tips: CoachTip[];
  /** Screen rectangle of a target, relative to the overlay; null when it is not visible. */
  locate(target: GuideTarget): Rect | null;
  onSkip(): void;
  onStep?(step: GuideStep | null): void;
}

export class Coach {
  readonly el: HTMLElement;
  private readonly card: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly opts: CoachOptions;
  private index = 0;
  private readonly acked = new Set<string>();
  private readonly seenTips = new Set<string>();
  private tip: CoachTip | null = null;
  private target: GuideTarget | null = null;
  private skipped = false;
  private shown = '';
  private state: GuideState | null = null;

  constructor(opts: CoachOptions) {
    this.opts = opts;
    this.card = h('div', { class: 'coach-card', role: 'status', aria: { live: 'polite' } });
    this.ring = h('div', { class: 'coach-ring', aria: { hidden: 'true' }, hidden: true });
    this.el = h('div', { class: 'coach' }, this.ring, this.card);
    this.card.hidden = true;
  }

  get step(): GuideStep | null {
    if (this.skipped) return null;
    return this.opts.steps[this.index] ?? null;
  }

  /** The current step freezes the day (explanations during the live phase). */
  get pausing(): boolean {
    return !!this.step?.pause;
  }

  get active(): boolean {
    return !!this.step || !!this.tip;
  }

  update(s: GuideState): void {
    this.state = s;
    const steps = this.opts.steps;
    const before = this.index;
    while (!this.skipped && this.index < steps.length) {
      const st = steps[this.index];
      const done = this.acked.has(st.id) || (st.done ? st.done(s) : false);
      if (!done) break;
      this.index++;
    }
    if (this.index !== before) this.opts.onStep?.(this.step);

    if (this.tip?.done?.(s)) this.tip = null;
    if (!this.step && !this.tip) {
      for (const t of this.opts.tips) {
        if (this.seenTips.has(t.id) || !t.when(s)) continue;
        this.seenTips.add(t.id);
        if (t.done?.(s)) continue;
        this.tip = t;
        break;
      }
    }
    const current = this.step ?? this.tip;
    this.target = current?.target?.(s) ?? null;
    this.render();
  }

  private render(): void {
    const step = this.step;
    const tip = step ? null : this.tip;
    const key = step ? `s:${step.id}` : tip ? `t:${tip.id}` : '';
    if (key === this.shown) return;
    this.shown = key;
    if (!step && !tip) {
      this.card.hidden = true;
      this.ring.hidden = true;
      return;
    }
    const actions: HTMLElement[] = [];
    if (step) {
      actions.push(
        h(
          'button',
          {
            class: 'linkish',
            type: 'button',
            on: {
              click: () => {
                this.skipped = true;
                this.shown = '';
                this.render();
                this.opts.onSkip();
              },
            },
          },
          T.tutorial.skip,
        ),
      );
      if (!step.done || step.skippable) {
        actions.push(
          h(
            'button',
            {
              class: 'btn primary small',
              type: 'button',
              on: {
                click: () => {
                  this.acked.add(step.id);
                  if (this.state) this.update(this.state);
                },
              },
            },
            T.common.next,
          ),
        );
      }
    } else if (tip) {
      actions.push(
        h(
          'button',
          {
            class: 'btn primary small',
            type: 'button',
            on: {
              click: () => {
                this.tip = null;
                this.target = null;
                if (this.state) this.update(this.state);
              },
            },
          },
          T.tutorial.ok,
        ),
      );
    }
    const total = this.opts.steps.length;
    this.card.replaceChildren(
      h('p', { class: 'coach-step' }, step ? T.tutorial.step(this.index + 1, total) : T.tutorial.tip),
      step ? h('div', { class: 'coach-progress' }, h('i', { style: `width:${Math.round(((this.index + 1) / total) * 100)}%` })) : '',
      h('p', { class: 'coach-text' }, loc((step ?? tip)!.text)),
      h('div', { class: 'coach-actions' }, ...actions),
    );
    this.card.hidden = false;
    this.card.classList.toggle('tip', !step);
    this.card.classList.remove('pop');
    void this.card.offsetWidth;
    this.card.classList.add('pop');
    this.card.querySelector<HTMLButtonElement>('.btn.primary')?.focus({ preventScroll: true });
  }

  /** Called every animation frame: follows targets that move (camera, panels). */
  frame(): void {
    if (this.card.hidden || !this.target) {
      this.ring.hidden = true;
      this.card.classList.remove('top');
      return;
    }
    const r = this.opts.locate(this.target);
    if (!r || r.w <= 0 || r.h <= 0) {
      this.ring.hidden = true;
      return;
    }
    const pad = 6;
    this.ring.hidden = false;
    this.ring.style.transform = `translate(${Math.round(r.x - pad)}px, ${Math.round(r.y - pad)}px)`;
    this.ring.style.width = `${Math.round(r.w + pad * 2)}px`;
    this.ring.style.height = `${Math.round(r.h + pad * 2)}px`;
    // Keep the card away from what it points at.
    const height = this.el.clientHeight || 1;
    this.card.classList.toggle('top', r.y + r.h / 2 > height * 0.55);
  }
}
