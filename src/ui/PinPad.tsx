import React, { useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { Button, cx } from './kit';

/**
 * Tastierino numerico unico per tutti gli accessi: PIN dello staff (nascosto, da 4 a 8 cifre, invio con
 * il pulsante) e numero di camera dell'ospite (visibile, invio con il pulsante).
 * Con `length` l'invio è automatico quando il valore è completo.
 * Funziona anche con la tastiera del computer.
 */
export function PinPad({
  label,
  hint,
  length,
  maxLength = 6,
  masked,
  submitLabel,
  busy,
  error,
  onSubmit,
  id,
  compact,
}: {
  label: string;
  hint?: string;
  /** Lunghezza fissa: invio automatico quando è completa. */
  length?: number;
  maxLength?: number;
  masked: boolean;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (value: string) => void | Promise<void>;
  id: string;
  /** Versione bassa (accesso dell'ospite): tutto in uno schermo di telefono, senza scorrere. */
  compact?: boolean;
}) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const max = length ?? maxLength;

  useEffect(() => {
    if (error) setValue('');
  }, [error]);

  const submit = (v: string) => {
    if (!v || busy) return;
    void onSubmit(v);
  };
  const type = (d: string) => {
    if (busy) return;
    const next = (value + d).slice(0, max);
    setValue(next);
    if (length && next.length === length) submit(next);
  };

  return (
    <form
      className={cx('mx-auto flex w-full max-w-xs flex-col', compact ? 'gap-2.5' : 'gap-4')}
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <label htmlFor={id} className="text-center">
        <span className={cx('block font-bold', compact ? 'text-base' : 'text-lg')}>{label}</span>
        {hint ? <span className="block text-sm text-muted">{hint}</span> : null}
      </label>
      <div className="relative">
        <input
          ref={input}
          id={id}
          value={value}
          inputMode="numeric"
          autoComplete={masked ? 'off' : 'off'}
          aria-invalid={!!error}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, max);
            setValue(v);
            if (length && v.length === length) submit(v);
          }}
          className={cx(
            'tnum w-full rounded-2xl border bg-bg text-center font-title tracking-[0.35em] caret-transparent',
            compact ? 'h-14 text-3xl' : 'h-16 text-4xl',
            error ? 'border-bad' : 'border-line',
            masked && 'text-transparent',
          )}
        />
        {masked ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3" aria-hidden>
            {/* Lunghezza libera: un pallino per cifra scritta, così non si svela quante cifre ha il PIN. */}
            {Array.from({ length: length ?? Math.max(value.length, 6) }, (_, i) => (
              <span key={i} className={cx('size-3.5 rounded-full', i < value.length ? 'bg-fg' : length ? 'border-2 border-line' : 'border-2 border-line/50')} />
            ))}
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-bad-soft p-2.5 text-center text-sm font-bold text-bad">
          {error}
        </p>
      ) : null}
      <div className={cx('grid grid-cols-3', compact ? 'gap-1.5' : 'gap-2')} role="group" aria-label="Tastierino">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button key={d} size={compact ? 'lg' : 'xl'} className="tnum text-2xl" onClick={() => type(d)} disabled={busy}>
            {d}
          </Button>
        ))}
        <Button size={compact ? 'lg' : 'xl'} tone="ghost" aria-label="Cancella tutto" onClick={() => setValue('')} disabled={busy || !value}>
          C
        </Button>
        <Button size={compact ? 'lg' : 'xl'} className="tnum text-2xl" onClick={() => type('0')} disabled={busy}>
          0
        </Button>
        <Button size={compact ? 'lg' : 'xl'} tone="ghost" aria-label="Cancella l’ultima cifra" onClick={() => setValue(value.slice(0, -1))} disabled={busy || !value}>
          <Delete size={22} />
        </Button>
      </div>
      {!length ? (
        <Button type="submit" tone="gold" size="lg" disabled={busy || !value}>
          {submitLabel}
        </Button>
      ) : null}
    </form>
  );
}
