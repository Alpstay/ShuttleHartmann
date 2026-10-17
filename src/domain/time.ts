import type { HhMm, IsoDate, IsoTimestamp } from './types';

export const TIME_ZONE = 'Europe/Rome';

/** Orologio sostituibile: in demo si può spostare avanti per provare l'attesa massima. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class OffsetClock implements Clock {
  private offsetMs = 0;
  private listeners = new Set<() => void>();
  now(): number {
    return Date.now() + this.offsetMs;
  }
  get offsetMinutes(): number {
    return Math.round(this.offsetMs / 60000);
  }
  advance(minutes: number): void {
    this.offsetMs += minutes * 60000;
    this.listeners.forEach((l) => l());
  }
  reset(): void {
    this.offsetMs = 0;
    this.listeners.forEach((l) => l());
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Data di servizio (Europe/Rome) per un istante. */
export function romeDate(ms: number): IsoDate {
  return dateFmt.format(new Date(ms));
}

/** Ora `HH:MM` (Europe/Rome) per un istante. */
export function romeTime(ms: number): HhMm {
  return timeFmt.format(new Date(ms));
}

export function romeTimeOf(ts: IsoTimestamp | null): HhMm {
  return ts ? romeTime(Date.parse(ts)) : '';
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

export function toMinutes(hhmm: HhMm): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function fromMinutes(total: number): HhMm {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isValidHhMm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Minuti trascorsi dalla mezzanotte (Europe/Rome) per un istante. */
export function romeMinutesOfDay(ms: number): number {
  return toMinutes(romeTime(ms));
}

const longDate: Record<'it' | 'de' | 'en', Intl.DateTimeFormat> = {
  it: new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }),
  de: new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }),
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }),
};

export function formatLongDate(date: IsoDate, lang: 'it' | 'de' | 'en' = 'it'): string {
  return longDate[lang].format(new Date(`${date}T00:00:00Z`));
}

const shortDate = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
export function formatShortDate(date: IsoDate): string {
  return shortDate.format(new Date(`${date}T00:00:00Z`));
}
