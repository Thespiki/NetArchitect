import './fonts.css';
import './styles.css';
import { App } from './app/app.ts';

interface Hot {
  snapshot?: (fn: () => unknown) => void;
  ready?: (start: (data: unknown) => void) => void;
  data?: unknown;
}

const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

function start(data: unknown): void {
  const root = document.getElementById('app')!;
  const app = new App(root);
  // Accès depuis la console du navigateur (débogage, tests de bout en bout).
  (window as unknown as { netarchitect: App }).netarchitect = app;
  hot?.snapshot?.(() => app.snapshot());
  const route = (data as { route?: string } | undefined)?.route;
  app.go(route === 'campaign' || route === 'skills' ? route : 'title');
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
