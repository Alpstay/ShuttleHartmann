import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BedDouble, Clock, Eye, EyeOff, KeyRound, MapPin, MessageSquareText, Mountain, Plus, Save, Smartphone, Unplug, Users, X } from 'lucide-react';
import { GUEST_STRINGS } from '../domain/i18n';
import { normalizeRoom, staffPinProblem } from '../domain/rules';
import { romeTimeOf, formatShortDate } from '../domain/time';
import type { GuestAccessMode, ShuttleSettings } from '../domain/types';
import type { StaffDevices, StaffRole } from '../store/ShuttleStore';
import { mapHref } from '../ui/destinations';
import { Button, FieldLabel, InlineConfirm, Stepper, cx, useApp } from '../ui/kit';

type Section = 'accessi' | 'camere' | 'impianti' | 'servizio' | 'ospiti';

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'accessi', label: 'Accessi', icon: <KeyRound size={16} /> },
  { id: 'camere', label: 'Camere', icon: <BedDouble size={16} /> },
  { id: 'impianti', label: 'Impianti', icon: <Mountain size={16} /> },
  { id: 'servizio', label: 'Servizio', icon: <Clock size={16} /> },
  { id: 'ospiti', label: 'Ospiti', icon: <MessageSquareText size={16} /> },
];

const ROLE_LABEL: Record<StaffRole, string> = { reception: 'Reception', autista: 'Autista' };

/**
 * Programma Impostazioni della reception: accessi (PIN, dispositivi, ingresso ospiti), camere,
 * impianti, regole del servizio e testi per gli ospiti. I PIN si salvano subito; il resto con «Salva».
 */
export function SettingsView({ settings, onSaved, notify }: { settings: ShuttleSettings; onSaved: (s: ShuttleSettings) => void; notify: (text: string, tone?: 'ok' | 'bad' | 'info') => void }) {
  const { backend } = useApp();
  const [section, setSection] = useState<Section>('accessi');
  const [draft, setDraft] = useState<ShuttleSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(settings), [settings]);

  const dirty = useMemo(() => JSON.stringify({ ...draft, updatedAt: '' }) !== JSON.stringify({ ...settings, updatedAt: '' }), [draft, settings]);
  const set = <K extends keyof ShuttleSettings>(k: K, v: ShuttleSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const problems = [
    draft.serviceStart >= draft.serviceEnd ? 'La prima corsa deve essere prima dell’ultima.' : null,
    (draft.pauseStart && !draft.pauseEnd) || (!draft.pauseStart && draft.pauseEnd) ? 'Indica inizio e fine della pausa, oppure lasciale vuote entrambe.' : null,
    draft.pauseStart && draft.pauseEnd && !(draft.serviceStart < draft.pauseStart && draft.pauseStart < draft.pauseEnd && draft.pauseEnd < draft.serviceEnd)
      ? 'La pausa deve stare tra la prima e l’ultima corsa.'
      : null,
    !draft.destinations.some((d) => d.active && d.name.trim()) ? 'Serve almeno un impianto attivo.' : null,
    draft.rooms.length === 0 ? 'Serve almeno una camera.' : null,
  ].filter((p): p is string => p !== null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await backend.staff.saveSettings({ ...draft, destinations: draft.destinations.filter((d) => d.name.trim()) });
      onSaved(saved);
      notify('Impostazioni salvate.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="@container flex flex-col gap-4">
      <h2 className="text-xl text-gold">Impostazioni</h2>
      <div className="grid grid-cols-1 gap-5 @2xl:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Sezioni impostazioni" className="flex gap-1 overflow-x-auto @2xl:flex-col">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              aria-current={section === s.id}
              className={cx(
                'flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold',
                section === s.id ? 'bg-fg text-bg' : 'text-muted hover:bg-surface hover:text-fg',
              )}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          {section === 'accessi' ? <AccessSection draft={draft} set={set} notify={notify} /> : null}
          {section === 'camere' ? <RoomsSection rooms={draft.rooms} onChange={(r) => set('rooms', r)} /> : null}
          {section === 'impianti' ? <DestinationsSection draft={draft} set={set} /> : null}
          {section === 'servizio' ? <ServiceSection draft={draft} set={set} /> : null}
          {section === 'ospiti' ? <GuestSection draft={draft} set={set} /> : null}
        </div>
      </div>

      {dirty || error ? (
        <div className="slide-in sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-gold/50 bg-bg p-3 shadow-lg">
          <span className="mr-auto text-sm font-bold">{error ?? (problems[0] || 'Modifiche non salvate')}</span>
          <Button tone="ghost" size="sm" onClick={() => (setDraft(settings), setError(null))}>
            Annulla modifiche
          </Button>
          <Button tone="gold" onClick={() => void save()} disabled={saving || problems.length > 0}>
            <Save size={16} /> {saving ? 'Salvataggio…' : 'Salva'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type SetFn = <K extends keyof ShuttleSettings>(k: K, v: ShuttleSettings[K]) => void;

// ---------------------------------------------------------------------------
// Accessi
// ---------------------------------------------------------------------------

function AccessSection({ draft, set, notify }: { draft: ShuttleSettings; set: SetFn; notify: (t: string, tone?: 'ok' | 'bad' | 'info') => void }) {
  const { backend } = useApp();
  const [devices, setDevices] = useState<StaffDevices[] | null>(null);
  const load = useCallback(() => {
    backend.staff.devices().then(setDevices, () => setDevices(null));
  }, [backend]);
  useEffect(load, [load]);

  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="h-pin">
        <h3 id="h-pin" className="text-lg">PIN dello staff</h3>
        <p className="text-sm text-muted">Il PIN decide l’area: con quello della reception si apre la reception, con quello dell’autista l’area autista. Cambiare un PIN scollega gli altri dispositivi di quel ruolo.</p>
        {(['reception', 'autista'] as StaffRole[]).map((role) => (
          <PinRow
            key={role}
            role={role}
            onChanged={() => {
              notify(`PIN ${ROLE_LABEL[role].toLowerCase()} cambiato.`);
              load();
            }}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="h-dev">
        <h3 id="h-dev" className="text-lg">Dispositivi collegati</h3>
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {(devices ?? []).map((d) => (
            <DeviceRow
              key={d.role}
              d={d}
              onDisconnect={async () => {
                try {
                  const n = await backend.staff.disconnect(d.role);
                  notify(n ? `${n} ${n === 1 ? 'dispositivo scollegato' : 'dispositivi scollegati'}.` : 'Nessun altro dispositivo da scollegare.', 'info');
                  load();
                } catch (e) {
                  notify((e as Error).message, 'bad');
                }
              }}
            />
          ))}
          {devices === null ? <li className="p-3 text-sm text-muted">Elenco non disponibile.</li> : null}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="h-guest">
        <h3 id="h-guest" className="text-lg">Ingresso ospiti</h3>
        <p className="text-sm text-muted">L’ospite entra con il numero di camera.</p>
        {(
          [
            ['camere_occupate', 'Solo camere con ospiti in casa', 'Le camere si attivano da sole con le presenze di La Scatola e si chiudono alla partenza; quelle senza presenza si attivano a mano da «Presenze».'],
            ['tutte_le_camere', 'Tutte le camere dell’elenco', 'Da usare solo se le presenze non arrivano: qualsiasi numero di camera dell’elenco viene accettato.'],
          ] as [GuestAccessMode, string, string][]
        ).map(([mode, title, text]) => (
          <label key={mode} className={cx('flex cursor-pointer gap-3 rounded-xl border p-3', draft.guestAccess === mode ? 'border-gold bg-gold-soft' : 'border-line')}>
            <input type="radio" name="guest-access" checked={draft.guestAccess === mode} onChange={() => set('guestAccess', mode)} className="mt-1 size-4 accent-[var(--gold)]" />
            <span className="flex flex-col gap-0.5">
              <span className="font-bold">{title}</span>
              <span className="text-sm text-muted">{text}</span>
            </span>
          </label>
        ))}
        {draft.guestAccess === 'tutte_le_camere' ? (
          <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">Con questa modalità chiunque conosca un numero di camera può prenotare a suo nome: valuta con cautela gli addebiti dei non presentati.</p>
        ) : null}
      </section>
    </>
  );
}

function PinRow({ role, onChanged }: { role: StaffRole; onChanged: () => void }) {
  const { backend } = useApp();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `pin-${role}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = staffPinProblem(pin, null) ?? (pin !== again ? 'I due PIN non coincidono.' : null);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await backend.staff.setPin(role, pin);
      setOpen(false);
      setPin('');
      setAgain('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 font-bold">
          <KeyRound size={16} className="text-gold" aria-hidden /> {ROLE_LABEL[role]}
        </span>
        <span className="tnum text-muted" aria-label="PIN impostato">
          ••••
        </span>
        <Button size="sm" className="ml-auto" onClick={() => (setOpen(!open), setError(null))}>
          {open ? 'Chiudi' : 'Cambia PIN'}
        </Button>
      </div>
      {open ? (
        <form onSubmit={submit} className="slide-in mt-3 flex flex-wrap items-end gap-3">
          <div>
            <FieldLabel htmlFor={`${id}-new`}>Nuovo PIN</FieldLabel>
            <input id={`${id}-new`} type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="tnum min-h-11 w-28 rounded-lg border border-line bg-bg px-3 text-lg tracking-[0.3em]" />
          </div>
          <div>
            <FieldLabel htmlFor={`${id}-again`}>Ripeti</FieldLabel>
            <input id={`${id}-again`} type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="new-password" maxLength={4} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} className="tnum min-h-11 w-28 rounded-lg border border-line bg-bg px-3 text-lg tracking-[0.3em]" />
          </div>
          <Button size="md" tone="ghost" aria-label={show ? 'Nascondi PIN' : 'Mostra PIN'} onClick={() => setShow(!show)}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </Button>
          <Button type="submit" tone="gold" disabled={busy || pin.length !== 4 || again.length !== 4}>
            Salva PIN
          </Button>
          {error ? <p className="w-full text-sm font-bold text-bad">{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}

function DeviceRow({ d, onDisconnect }: { d: StaffDevices; onDisconnect: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Smartphone size={18} className="text-muted" aria-hidden />
        <span className="font-bold">{ROLE_LABEL[d.role]}</span>
        <span className="text-sm text-muted">
          {d.count} {d.count === 1 ? 'dispositivo' : 'dispositivi'}
          {d.lastLoginAt ? ` · ultimo accesso ${formatShortDate(d.lastLoginAt.slice(0, 10))} ${romeTimeOf(d.lastLoginAt)}` : ''}
        </span>
        <Button size="sm" tone="ghost" className="ml-auto" disabled={d.count === 0} onClick={() => setConfirm(true)}>
          <Unplug size={16} /> Scollega
        </Button>
      </div>
      {confirm ? (
        <InlineConfirm
          question={d.role === 'reception' ? 'Scollegare gli altri dispositivi della reception? Questo resta collegato.' : 'Scollegare tutti i dispositivi dell’autista?'}
          confirmLabel="Scollega"
          cancelLabel="No"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void onDisconnect();
          }}
        />
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Camere, impianti, servizio, ospiti
// ---------------------------------------------------------------------------

function RoomsSection({ rooms, onChange }: { rooms: string[]; onChange: (r: string[]) => void }) {
  const [value, setValue] = useState('');
  const add = () => {
    const r = normalizeRoom(value);
    if (!r || rooms.includes(r)) return setValue('');
    onChange([...rooms, r].sort((a, b) => a.localeCompare(b, 'it', { numeric: true })));
    setValue('');
  };
  return (
    <section className="flex flex-col gap-3" aria-labelledby="h-rooms">
      <h3 id="h-rooms" className="text-lg">Camere della struttura</h3>
      <p className="text-sm text-muted">Il numero deve essere scritto come in Slope: è quello che l’ospite digita per entrare.</p>
      <ul className="flex flex-wrap gap-2">
        {rooms.map((r) => (
          <li key={r} className="inline-flex items-center gap-1 rounded-xl border border-line py-1 pl-3 pr-1">
            <span className="tnum font-title text-lg">{r}</span>
            <Button size="sm" tone="ghost" aria-label={`Togli la camera ${r}`} onClick={() => onChange(rooms.filter((x) => x !== r))}>
              <X size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label htmlFor="new-room" className="sr-only">
          Nuova camera
        </label>
        <input id="new-room" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="es. 123" className="tnum min-h-11 w-32 rounded-lg border border-line bg-bg px-3" />
        <Button type="submit" disabled={!value.trim()}>
          <Plus size={16} /> Aggiungi
        </Button>
      </form>
    </section>
  );
}

function DestinationsSection({ draft, set }: { draft: ShuttleSettings; set: SetFn }) {
  const upd = (i: number, patch: Partial<ShuttleSettings['destinations'][number]>) => set('destinations', draft.destinations.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <section className="flex flex-col gap-3" aria-labelledby="h-dest">
      <h3 id="h-dest" className="text-lg">Impianti serviti</h3>
      {draft.destinations.map((d, i) => (
        <div key={d.id} className={cx('flex flex-col gap-2 rounded-xl border border-line p-3', !d.active && 'opacity-60')}>
          <div className="flex flex-wrap items-center gap-2">
            <input id={`dest-name-${d.id}`} aria-label="Nome impianto" value={d.name} onChange={(e) => upd(i, { name: e.target.value })} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 font-bold" />
            <input id={`dest-place-${d.id}`} aria-label="Località" value={d.place} onChange={(e) => upd(i, { place: e.target.value })} className="min-h-11 w-32 rounded-lg border border-line bg-bg px-3" />
            <label className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input id={`dest-active-${d.id}`} type="checkbox" checked={d.active} onChange={(e) => upd(i, { active: e.target.checked })} className="size-5 accent-[var(--gold)]" />
              Attivo
            </label>
          </div>
          {/* Meeting point: lo vedono l'ospite (quando prenota e nella sua corsa) e l'autista (con «Naviga»). */}
          <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} aria-hidden /> Meeting point (dove aspetta l’ospite)
              </span>
              <input
                id={`dest-meeting-${d.id}`}
                value={d.meetingPoint ?? ''}
                placeholder="es. Parcheggio davanti alla biglietteria"
                onChange={(e) => upd(i, { meetingPoint: e.target.value })}
                className="min-h-11 rounded-lg border border-line bg-bg px-3 text-sm font-normal text-fg"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              <span>Posizione: link di Google Maps, coordinate o indirizzo</span>
              <span className="flex gap-2">
                <input
                  id={`dest-map-${d.id}`}
                  value={d.mapLink ?? ''}
                  placeholder="es. https://maps.app.goo.gl/… oppure 46.5745, 11.6713"
                  onChange={(e) => upd(i, { mapLink: e.target.value })}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm font-normal text-fg"
                />
                <a href={mapHref(d)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-sm font-bold text-fg">
                  <MapPin size={14} aria-hidden /> Prova
                </a>
              </span>
            </label>
          </div>
        </div>
      ))}
      <Button size="sm" className="self-start" onClick={() => set('destinations', [...draft.destinations, { id: `imp-${Date.now().toString(36)}`, name: '', place: 'Ortisei', active: true, meetingPoint: '', mapLink: '' }])}>
        <Plus size={16} /> Aggiungi impianto
      </Button>
      <p className="text-xs text-muted">Gli impianti disattivati restano nello storico delle corse ma non sono più prenotabili.</p>
    </section>
  );
}

function ServiceSection({ draft, set }: { draft: ShuttleSettings; set: SetFn }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="h-svc">
      <h3 id="h-svc" className="text-lg">Regole del servizio</h3>
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <div>
          <FieldLabel>
            <Users size={12} className="mr-1 inline" aria-hidden />
            Posti sul mezzo
          </FieldLabel>
          <Stepper label="Posti" value={draft.seats} min={1} max={20} onChange={(v) => set('seats', v)} />
        </div>
        <div>
          <FieldLabel>Attesa massima all’impianto (minuti)</FieldLabel>
          <Stepper label="Attesa" value={draft.waitMinutes} min={1} max={15} onChange={(v) => set('waitMinutes', v)} />
        </div>
        <div>
          <FieldLabel>Anticipo minimo per l’ospite (minuti)</FieldLabel>
          <Stepper label="Anticipo" value={draft.minLeadMinutes} min={0} max={120} steps={[5]} onChange={(v) => set('minLeadMinutes', v)} />
        </div>
        <div>
          <FieldLabel>Tempo tra due viaggi del mezzo (minuti)</FieldLabel>
          <Stepper label="Tempo tra due viaggi" value={draft.pickupGapMinutes} min={0} max={60} steps={[5]} onChange={(v) => set('pickupGapMinutes', v)} />
          <p className="mt-1 text-xs text-muted">
            Il mezzo è uno solo: un ospite non può prenotare a meno di questi minuti da un altro viaggio (altro impianto o altro orario).
            Alla stessa ora e dallo stesso punto si viaggia insieme, fino ai posti. 0 = nessun controllo.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <FieldLabel htmlFor="svc-pause-start">Pausa dalle (ultima corsa del mattino)</FieldLabel>
            <input id="svc-pause-start" type="time" step={300} value={draft.pauseStart} onChange={(e) => set('pauseStart', e.target.value)} className="tnum min-h-11 w-full rounded-lg border border-line bg-bg px-3" />
          </div>
          <div className="flex-1">
            <FieldLabel htmlFor="svc-pause-end">alle (prima corsa del pomeriggio)</FieldLabel>
            <input id="svc-pause-end" type="time" step={300} value={draft.pauseEnd} onChange={(e) => set('pauseEnd', e.target.value)} className="tnum min-h-11 w-full rounded-lg border border-line bg-bg px-3" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <FieldLabel htmlFor="svc-start">Prima corsa</FieldLabel>
            <input id="svc-start" type="time" step={300} value={draft.serviceStart} onChange={(e) => set('serviceStart', e.target.value)} className="tnum min-h-11 w-full rounded-lg border border-line bg-bg px-3" />
          </div>
          <div className="flex-1">
            <FieldLabel htmlFor="svc-end">Ultima corsa</FieldLabel>
            <input id="svc-end" type="time" step={300} value={draft.serviceEnd} onChange={(e) => set('serviceEnd', e.target.value)} className="tnum min-h-11 w-full rounded-lg border border-line bg-bg px-3" />
          </div>
        </div>
      </div>
    </section>
  );
}

function GuestSection({ draft, set }: { draft: ShuttleSettings; set: SetFn }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="h-guests">
      <h3 id="h-guests" className="text-lg">Comunicazione con gli ospiti</h3>
      <div>
        <FieldLabel htmlFor="svc-phone">Telefono reception mostrato all’ospite</FieldLabel>
        <input id="svc-phone" type="tel" value={draft.receptionPhone} onChange={(e) => set('receptionPhone', e.target.value)} placeholder="Facoltativo" className="min-h-11 w-full max-w-sm rounded-lg border border-line bg-bg px-3" />
        <p className="mt-1 text-xs text-muted">Compare quando l’autista ha già confermato e l’ospite non può più annullare da solo.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor="svc-taxi-name">Taxi per chi prenota fuori orario</FieldLabel>
          <input id="svc-taxi-name" value={draft.taxiName} onChange={(e) => set('taxiName', e.target.value)} className="min-h-11 w-full rounded-lg border border-line bg-bg px-3" />
        </div>
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor="svc-taxi-phone">Telefono del taxi</FieldLabel>
          <input id="svc-taxi-phone" type="tel" value={draft.taxiPhone} onChange={(e) => set('taxiPhone', e.target.value)} className="tnum min-h-11 w-full rounded-lg border border-line bg-bg px-3" />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted">Se l’ospite sceglie un orario fuori servizio, la pagina gli mostra gli orari della navetta e il numero del taxi da chiamare.</p>
      <div className="flex flex-col gap-2">
        <p className="eyebrow">Condizioni che l’ospite accetta</p>
        {(['it', 'de', 'en'] as const).map((l) => (
          <p key={l} lang={l} className="rounded-xl bg-surface p-3 text-sm leading-relaxed">
            <span className="mr-2 font-bold uppercase text-muted">{l}</span>
            {GUEST_STRINGS[l].conditions(draft.waitMinutes)}
          </p>
        ))}
        <p className="text-xs text-muted">I minuti seguono l’attesa massima impostata in «Servizio».</p>
      </div>
    </section>
  );
}
