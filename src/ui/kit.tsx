import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Clock } from '../domain/time';
import type { PresenceSource } from '../presence/presence';
import type { ShuttleBackend } from '../store/ShuttleStore';
import type { RideStatus } from '../domain/types';

// ---------------------------------------------------------------------------
// Contesto applicativo
// ---------------------------------------------------------------------------

export interface AppContextValue {
  backend: ShuttleBackend;
  clock: Clock;
  presence: PresenceSource | null;
  publicUrl: string;
  /** Prototipo: niente stampa/download (bloccati nel visualizzatore), dati di esempio. */
  isDemo: boolean;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ value, children }: { value: AppContextValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider mancante');
  return v;
}

/** Ora corrente che si aggiorna ogni `everyMs` (e subito quando l'orologio demo viene spostato). */
export function useNow(everyMs = 1000): number {
  const { clock } = useApp();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(clock.now()), everyMs);
    const sub = (clock as Clock & { subscribe?: (l: () => void) => () => void }).subscribe?.(() => setNow(clock.now()));
    return () => {
      window.clearInterval(id);
      sub?.();
    };
  }, [clock, everyMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Suono, vibrazione, schermo acceso
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

/** Va chiamata dentro un tocco dell'utente: i browser bloccano l'audio non richiesto. */
export function unlockSound(): boolean {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    audioCtx ??= new AC();
    void audioCtx.resume();
    return true;
  } catch {
    return false;
  }
}

export function vibrate(pattern: number[] = [120, 80, 120]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* vibrazione non disponibile */
  }
}

export type ChimeKind = 'nuova' | 'aggiornamento' | 'allarme' | 'partenza';

const CHIME_NOTES: Record<ChimeKind, number[]> = {
  nuova: [880, 1175],
  aggiornamento: [988],
  allarme: [660, 660, 660],
  // «Parti ora»: arpeggio ascendente ripetuto due volte, diverso da tutti gli altri avvisi.
  partenza: [523, 659, 784, 1047, 523, 659, 784, 1047],
};

const CHIME_VIBRATION: Record<ChimeKind, number[]> = {
  nuova: [120, 80, 120],
  aggiornamento: [120, 80, 120],
  allarme: [200, 100, 200, 100, 200],
  partenza: [300, 120, 300, 120, 300],
};

export function chime(kind: ChimeKind = 'nuova'): void {
  vibrate(CHIME_VIBRATION[kind]);
  if (!audioCtx) return;
  const notes = CHIME_NOTES[kind];
  const t0 = audioCtx.currentTime;
  notes.forEach((f, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.16);
    osc.connect(gain).connect(audioCtx!.destination);
    osc.start(t0 + i * 0.18);
    osc.stop(t0 + i * 0.18 + 0.17);
  });
}

/** Mantiene lo schermo acceso finché `on` è vero (se il dispositivo lo consente). */
export function useWakeLock(on: boolean): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!on) return;
    let sentinel: { release(): Promise<void> } | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
        if (!wl || document.visibilityState !== 'visible') return;
        sentinel = await wl.request('screen');
        if (!cancelled) setActive(true);
      } catch {
        setActive(false);
      }
    };
    void request();
    const onVis = () => document.visibilityState === 'visible' && void request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void sentinel?.release().catch(() => undefined);
      setActive(false);
    };
  }, [on]);
  return active;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** Stato persistente per comodità del singolo dispositivo (lingua, scheda, sessione ospite). */
export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        if (v === null || v === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* archiviazione non disponibile */
      }
    },
    [key],
  );
  return [value, set];
}

/** Messaggio breve in sovrimpressione. */
export function useToast(): [React.ReactNode, (text: string, tone?: 'ok' | 'bad' | 'info') => void] {
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'bad' | 'info'; id: number } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((text: string, tone: 'ok' | 'bad' | 'info' = 'ok') => {
    window.clearTimeout(timer.current);
    setToast({ text, tone, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const node = toast ? (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={cx(
        'slide-in sticky top-2 z-30 mx-auto w-full max-w-md rounded-xl px-4 py-3 text-sm font-bold shadow-lg',
        toast.tone === 'ok' && 'bg-ok-soft text-ok',
        toast.tone === 'bad' && 'bg-bad-soft text-bad',
        toast.tone === 'info' && 'bg-info-soft text-info',
      )}
    >
      {toast.text}
    </div>
  ) : null;
  return [node, show];
}

// ---------------------------------------------------------------------------
// Componenti
// ---------------------------------------------------------------------------

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonTone = 'gold' | 'dark' | 'ok' | 'bad' | 'ghost' | 'soft';

export function Button({
  tone = 'soft',
  size = 'md',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-[transform,background-color] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
        size === 'sm' && 'min-h-9 px-3 text-sm',
        size === 'md' && 'min-h-11 px-4 text-[0.95rem]',
        size === 'lg' && 'min-h-14 px-5 text-base',
        size === 'xl' && 'min-h-16 px-6 text-lg',
        tone === 'gold' && 'bg-gold text-on-gold hover:bg-gold-strong',
        tone === 'dark' && 'bg-fg text-bg hover:opacity-90',
        tone === 'ok' && 'bg-ok text-bg hover:opacity-90',
        tone === 'bad' && 'bg-bad text-bg hover:opacity-90',
        tone === 'ghost' && 'text-fg hover:bg-surface',
        tone === 'soft' && 'border border-line bg-surface text-fg hover:bg-surface-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

export const STATUS_TONE: Record<RideStatus, string> = {
  richiesta: 'bg-warn-soft text-warn',
  confermata: 'bg-info-soft text-info',
  sul_posto: 'bg-gold-soft text-gold-strong',
  completata: 'bg-ok-soft text-ok',
  no_show: 'bg-bad-soft text-bad',
  annullata: 'bg-surface-2 text-muted line-through',
};

export function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', className)}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; hint?: React.ReactNode }[];
  onChange: (v: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-1 rounded-2xl bg-surface p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex min-h-12 flex-col items-center justify-center rounded-xl px-2 py-1.5 text-center transition-colors',
            value === o.value ? 'bg-bg font-bold text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg',
          )}
        >
          <span>{o.label}</span>
          {o.hint ? <span className="text-xs font-normal text-muted">{o.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  format,
  steps = [1],
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => React.ReactNode;
  steps?: number[];
}) {
  const sorted = [...steps].sort((a, b) => b - a);
  return (
    <div className="flex items-center justify-between gap-1.5 rounded-2xl bg-surface p-1.5" role="group" aria-label={label}>
      <div className="flex gap-1">
        {sorted.map((s) => (
          <Button key={`-${s}`} size="md" tone="ghost" className="bg-bg ring-1 ring-line" aria-label={`${label} meno ${s}`} disabled={value - s < min} onClick={() => onChange(Math.max(min, value - s))}>
            {s === 1 ? <Minus size={18} /> : <span className="tnum">−{s}</span>}
          </Button>
        ))}
      </div>
      <output className="tnum min-w-16 text-center text-2xl font-bold" aria-live="polite">
        {format ? format(value) : value}
      </output>
      <div className="flex gap-1">
        {[...sorted].reverse().map((s) => (
          <Button key={`+${s}`} size="md" tone="ghost" className="bg-bg ring-1 ring-line" aria-label={`${label} più ${s}`} disabled={value + s > max} onClick={() => onChange(Math.min(max, value + s))}>
            {s === 1 ? <Plus size={18} /> : <span className="tnum">+{s}</span>}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="eyebrow mb-1.5 block">
      {children}
    </label>
  );
}

export function Countdown({ ms }: { ms: number }) {
  const s = Math.ceil(ms / 1000);
  return (
    <span className="tnum">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

/** Conferma in pagina (i dialoghi del browser non sono affidabili su tutti i dispositivi). */
export function InlineConfirm({
  question,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="slide-in flex flex-wrap items-center gap-2 rounded-xl bg-bad-soft p-3">
      <span className="mr-auto text-sm font-bold text-bad">{question}</span>
      <Button size="sm" tone="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button size="sm" tone="bad" onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
}
