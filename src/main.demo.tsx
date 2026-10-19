import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { DemoApp } from './DemoApp';
import { OffsetClock } from './domain/time';
import { DemoPresenceSource } from './presence/presence';
import { createDemoBackend } from './store/demoStore';

// I PIN del prototipo arrivano dal build (.env.demo.local, escluso dal repository).
const env = import.meta.env;
const clock = new OffsetClock();
const hub = createDemoBackend({
  clock,
  persist: true,
  pins: { reception: String(env.VITE_DEMO_PIN_RECEPTION ?? '000000'), autista: String(env.VITE_DEMO_PIN_AUTISTA ?? '111111') },
  signedIn: { 'demo-reception': 'reception', 'demo-autista': 'autista' },
});
const presence = new DemoPresenceSource(() => clock.now());

const el = document.getElementById('root');
if (el) createRoot(el).render(<DemoApp hub={hub} clock={clock} presence={presence} />);
