import {
  addDays,
  fromMinutes,
  isValidHhMm,
  isValidIsoDate,
  romeDate,
  romeMinutesOfDay,
  toMinutes,
} from './time';
import type {
  Actor,
  BusySlot,
  ChargeDecision,
  Direction,
  DriverMessageKind,
  HhMm,
  IsoDate,
  Ride,
  RideInput,
  RideStatus,
  ShuttleSettings,
  ShuttleStay,
} from './types';
import { ShuttleError } from './types';
import { HARTMANN_ROOMS } from '../config';

export const DEFAULT_SETTINGS: ShuttleSettings = {
  rooms: [...HARTMANN_ROOMS],
  guestAccess: 'camere_occupate',
  destinations: [
    // Meeting point iniziali: stazioni a valle degli impianti. La reception li precisa da Impostazioni → Impianti.
    { id: 'seceda', name: 'Seceda', place: 'Ortisei', active: true, meetingPoint: 'Stazione a valle della funivia Ortisei–Seceda', mapLink: 'Funivia Ortisei Seceda, Ortisei' },
    { id: 'alpe-di-siusi', name: 'Alpe di Siusi', place: 'Ortisei', active: true, meetingPoint: 'Stazione a valle della cabinovia Ortisei–Alpe di Siusi', mapLink: 'Cabinovia Ortisei Alpe di Siusi, Ortisei' },
    { id: 'palmer', name: 'Palmer (Campetti scuola)', place: 'Ortisei', active: true, meetingPoint: '', mapLink: '' },
    { id: 'col-raiser', name: 'Col Raiser (Gardena Ronda/Saslong)', place: 'S. Cristina', active: true, meetingPoint: 'Stazione a valle della Gardena Ronda (Saslong)', mapLink: 'Gardena Ronda Express Saslong, Santa Cristina Valgardena' },
    { id: 'monte-pana', name: 'Monte Pana', place: 'S. Cristina', active: true, meetingPoint: '', mapLink: '' },
  ],
  seats: 8,
  waitMinutes: 5,
  serviceStart: '08:00',
  serviceEnd: '17:30',
  pauseStart: '11:30',
  pauseEnd: '14:00',
  taxiName: 'Taxi Fleur',
  taxiPhone: '+39 335 63 45 264',
  minLeadMinutes: 15,
  receptionPhone: '+39 0471 774440',
  pickupGapMinutes: 20,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

/** Passo dell'orario selezionabile. */
export const SLOT_STEP_MINUTES = 5;

/** Stati in cui la corsa è ancora da svolgere. */
export const OPEN_STATUSES: readonly RideStatus[] = ['richiesta', 'confermata', 'sul_posto'];

export function isOpen(status: RideStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Validazione richiesta
// ---------------------------------------------------------------------------

export type RideInputProblem =
  | 'data_non_valida'
  | 'data_fuori_soggiorno'
  | 'data_troppo_lontana'
  | 'orario_non_valido'
  | 'fuori_orario_servizio'
  | 'troppo_presto'
  | 'persone_non_valide'
  | 'destinazione_non_valida'
  | 'condizioni_non_accettate'
  // Dal controllo dei viaggi (checkTrip): il mezzo è uno solo.
  | 'orario_occupato'
  | 'posti_esauriti'
  // Dal server: troppe corse aperte della stessa camera nello stesso giorno.
  | 'troppe_corse';

/** Corse aperte che un ospite può avere per lo stesso giorno (andata e ritorno due volte). Rispecchiato in schema.sql. */
export const MAX_GUEST_OPEN_RIDES_PER_DAY = 4;

export interface ValidationContext {
  settings: ShuttleSettings;
  nowMs: number;
  /** Chi inserisce: l'ospite deve accettare le condizioni e rispettare l'anticipo minimo. */
  actor: 'ospite' | 'reception';
  /** Soggiorno collegato, per non accettare corse dopo la partenza. */
  stay?: Pick<ShuttleStay, 'validFrom' | 'validUntil'> | null;
}

export function validateRideInput(input: RideInput, ctx: ValidationContext): RideInputProblem[] {
  const problems: RideInputProblem[] = [];
  const today = romeDate(ctx.nowMs);
  const { settings } = ctx;

  if (!isValidIsoDate(input.serviceDate) || input.serviceDate < today) {
    problems.push('data_non_valida');
  } else if (ctx.actor === 'ospite' && input.serviceDate > addDays(today, 1)) {
    problems.push('data_troppo_lontana');
  }
  if (
    ctx.stay &&
    isValidIsoDate(input.serviceDate) &&
    (input.serviceDate > ctx.stay.validUntil || input.serviceDate < ctx.stay.validFrom)
  ) {
    problems.push('data_fuori_soggiorno');
  }

  if (!isValidHhMm(input.time)) {
    problems.push('orario_non_valido');
  } else {
    const t = toMinutes(input.time);
    if (!inServiceHours(input.time, settings)) {
      problems.push('fuori_orario_servizio');
    }
    if (input.serviceDate === today) {
      const lead = ctx.actor === 'ospite' ? settings.minLeadMinutes : 0;
      if (t < romeMinutesOfDay(ctx.nowMs) + lead) problems.push('troppo_presto');
    }
  }

  if (!Number.isInteger(input.persons) || input.persons < 1 || input.persons > settings.seats) {
    problems.push('persone_non_valide');
  }

  const dest = settings.destinations.find((d) => d.id === input.destinationId);
  if (!dest || !dest.active) problems.push('destinazione_non_valida');

  if (ctx.actor === 'ospite' && !input.conditionsAccepted) problems.push('condizioni_non_accettate');

  return problems;
}

type ServiceHours = Pick<ShuttleSettings, 'serviceStart' | 'serviceEnd' | 'pauseStart' | 'pauseEnd'>;

/** Pausa di metà giornata in minuti, se impostata correttamente. */
function pauseOf(s: ServiceHours): [number, number] | null {
  if (!s.pauseStart || !s.pauseEnd || !isValidHhMm(s.pauseStart) || !isValidHhMm(s.pauseEnd)) return null;
  const a = toMinutes(s.pauseStart);
  const b = toMinutes(s.pauseEnd);
  return a < b ? [a, b] : null;
}

/** Vero se l'orario è dentro il servizio: dalla prima all'ultima corsa, esclusa la pausa (estremi compresi nel servizio). */
export function inServiceHours(time: HhMm, s: ServiceHours): boolean {
  if (!isValidHhMm(time)) return false;
  const t = toMinutes(time);
  if (t < toMinutes(s.serviceStart) || t > toMinutes(s.serviceEnd)) return false;
  const pause = pauseOf(s);
  return !(pause && t > pause[0] && t < pause[1]);
}

/** «08:00–11:30 · 14:00–17:30», oppure «08:00–17:30» senza pausa. */
export function serviceHoursLabel(s: ServiceHours): string {
  const pause = pauseOf(s);
  return pause ? `${s.serviceStart}–${s.pauseStart} · ${s.pauseEnd}–${s.serviceEnd}` : `${s.serviceStart}–${s.serviceEnd}`;
}

/** Porta un orario (in minuti) fuori dalla pausa: avanti alla ripresa del servizio, o indietro all'ultima corsa del mattino. */
function skipPause(m: number, s: ServiceHours, forward = true): number {
  const pause = pauseOf(s);
  if (!pause || m <= pause[0] || m >= pause[1]) return m;
  return forward ? pause[1] : pause[0];
}

/** Primo orario prenotabile per una data, arrotondato al passo di 5 minuti (salta la pausa di metà giornata). */
export function earliestSlot(settings: ShuttleSettings, nowMs: number, date: IsoDate, actor: Actor): HhMm | null {
  const start = toMinutes(settings.serviceStart);
  const end = toMinutes(settings.serviceEnd);
  let first = start;
  if (date === romeDate(nowMs)) {
    const lead = actor === 'ospite' ? settings.minLeadMinutes : 0;
    const min = romeMinutesOfDay(nowMs) + lead;
    first = Math.max(start, Math.ceil(min / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES);
  }
  first = skipPause(first, settings);
  return first > end ? null : fromMinutes(first);
}

/** Orario proposto di default: 09:00 per l'andata, 16:00 per il ritorno, o il primo disponibile. */
export function suggestedTime(
  settings: ShuttleSettings,
  nowMs: number,
  date: IsoDate,
  direction: Direction,
  actor: Actor,
): HhMm | null {
  const earliest = earliestSlot(settings, nowMs, date, actor);
  if (!earliest) return null;
  const preferred = direction === 'andata' ? '09:00' : '16:00';
  const t = skipPause(Math.max(toMinutes(preferred), toMinutes(earliest)), settings);
  return t > toMinutes(settings.serviceEnd) ? earliest : fromMinutes(t);
}

/** Sposta un orario di `delta` minuti restando dentro la finestra prenotabile. */
export function shiftTime(
  time: HhMm,
  delta: number,
  settings: ShuttleSettings,
  nowMs: number,
  date: IsoDate,
  actor: Actor,
): HhMm {
  const earliest = earliestSlot(settings, nowMs, date, actor);
  const lo = earliest ? toMinutes(earliest) : toMinutes(settings.serviceStart);
  const hi = toMinutes(settings.serviceEnd);
  const next = Math.min(hi, Math.max(lo, toMinutes(time) + delta));
  return fromMinutes(skipPause(next, settings, delta >= 0));
}

// ---------------------------------------------------------------------------
// Viaggi: il mezzo è uno solo
// ---------------------------------------------------------------------------
//
// Un viaggio = stessa data, stesso orario, stesso punto di ritiro (l'hotel all'andata, l'impianto al
// ritorno): più camere possono condividerlo fino ai posti del mezzo. Due viaggi diversi devono stare ad
// almeno `pickupGapMinutes` di distanza, altrimenti l'autista dovrebbe essere in due posti insieme.
// Stesse regole in shuttle_trip_problem() di supabase/schema.sql.

export const HOTEL_PICKUP = 'hotel';

/** Corsa extra inserita dalla reception per chi non è ospite dell'Hartmann: «camera» convenzionale. */
export const EXTRA_ROOM = 'EXTRA';

export function isExtra(r: Pick<Ride, 'room'>): boolean {
  return r.room === EXTRA_ROOM;
}

/** Chi viaggia: il numero di camera, oppure «Extra · nome» (per le corse extra il nome apre la nota). */
export function rideWho(r: Pick<Ride, 'room' | 'note'>): string {
  if (!isExtra(r)) return r.room;
  const name = (r.note ?? '').split(' · ')[0]?.trim();
  return name ? `Extra · ${name}` : 'Extra';
}

/** «camera 105» oppure «Extra · Rossi», per i testi degli avvisi. */
export function whoText(r: Pick<Ride, 'room' | 'note'>): string {
  return isExtra(r) ? rideWho(r) : `camera ${r.room}`;
}

type TripFields = Pick<Ride, 'serviceDate' | 'time' | 'direction' | 'destinationId'>;

/** Punto di ritiro: l'hotel all'andata, l'impianto al ritorno. */
export function pickupKey(r: Pick<Ride, 'direction' | 'destinationId'>): string {
  return r.direction === 'andata' ? HOTEL_PICKUP : r.destinationId;
}

export function tripKey(r: TripFields): string {
  return `${r.serviceDate}|${r.time}|${pickupKey(r)}`;
}

export interface Trip {
  key: string;
  serviceDate: IsoDate;
  time: HhMm;
  direction: Direction;
  pickup: string;
  rides: Ride[];
  /** Persone delle corse non annullate. */
  persons: number;
}

/** Raggruppa le corse in viaggi (ordine: data, orario, andata prima del ritorno). */
export function groupTrips(rides: Ride[]): Trip[] {
  const map = new Map<string, Trip>();
  for (const r of [...rides].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || compareRides(a, b))) {
    const key = tripKey(r);
    const trip = map.get(key) ?? { key, serviceDate: r.serviceDate, time: r.time, direction: r.direction, pickup: pickupKey(r), rides: [], persons: 0 };
    trip.rides.push(r);
    if (r.status !== 'annullata') trip.persons += r.persons;
    map.set(key, trip);
  }
  return [...map.values()];
}

/** Viaggi aperti di una data, senza dati delle camere (per l'ospite e per i controlli). */
export function busySlots(rides: Ride[], date: IsoDate, excludeRideId?: string): BusySlot[] {
  const map = new Map<string, BusySlot>();
  for (const r of rides) {
    if (r.serviceDate !== date || !isOpen(r.status) || r.id === excludeRideId) continue;
    const pickup = pickupKey(r);
    const key = `${r.time}|${pickup}`;
    const slot = map.get(key) ?? { time: r.time, pickup, persons: 0 };
    slot.persons += r.persons;
    map.set(key, slot);
  }
  return [...map.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export type TripProblem = 'orario_occupato' | 'posti_esauriti';

type TripRequest = Pick<RideInput, 'time' | 'direction' | 'destinationId' | 'persons'>;

/** Viaggi che impediscono la richiesta: altro viaggio troppo vicino, o lo stesso viaggio già pieno. */
export function tripClashes(input: TripRequest, busy: BusySlot[], settings: Pick<ShuttleSettings, 'seats' | 'pickupGapMinutes'>): { problem: TripProblem | null; clashes: BusySlot[] } {
  if (!isValidHhMm(input.time)) return { problem: null, clashes: [] };
  const pickup = pickupKey(input);
  const t = toMinutes(input.time);
  const same = busy.find((b) => b.time === input.time && b.pickup === pickup);
  if (same && same.persons + input.persons > settings.seats) return { problem: 'posti_esauriti', clashes: [same] };
  const gap = settings.pickupGapMinutes;
  const clashes = gap > 0 ? busy.filter((b) => !(b.time === input.time && b.pickup === pickup) && Math.abs(toMinutes(b.time) - t) < gap) : [];
  return { problem: clashes.length ? 'orario_occupato' : null, clashes };
}

export function checkTrip(input: TripRequest, busy: BusySlot[], settings: Pick<ShuttleSettings, 'seats' | 'pickupGapMinutes'>): TripProblem | null {
  return tripClashes(input, busy, settings).problem;
}

export interface TimeSuggestion {
  time: HhMm;
  /** Vero se è un viaggio già previsto dallo stesso punto di ritiro (si viaggia insieme ad altri ospiti). */
  join: boolean;
}

/** Orari validi più vicini a quello chiesto: prima i viaggi da condividere, poi gli orari liberi. */
export function suggestTimes(
  input: TripRequest & { serviceDate: IsoDate },
  busy: BusySlot[],
  settings: ShuttleSettings,
  nowMs: number,
  actor: Actor,
  max = 4,
): TimeSuggestion[] {
  const earliest = earliestSlot(settings, nowMs, input.serviceDate, actor);
  if (!earliest) return [];
  const lo = toMinutes(earliest);
  const hi = toMinutes(settings.serviceEnd);
  const want = isValidHhMm(input.time) ? toMinutes(input.time) : lo;
  const ok = (m: number) => m >= lo && m <= hi && inServiceHours(fromMinutes(m), settings) && checkTrip({ ...input, time: fromMinutes(m) }, busy, settings) === null;
  const pickup = pickupKey(input);
  const found = new Map<HhMm, TimeSuggestion>();
  for (const b of busy) {
    if (b.pickup === pickup && b.time !== input.time && ok(toMinutes(b.time))) found.set(b.time, { time: b.time, join: true });
  }
  for (let m = lo; m <= hi; m += SLOT_STEP_MINUTES) {
    const time = fromMinutes(m);
    if (m !== want && !found.has(time) && ok(m)) found.set(time, { time, join: false });
  }
  // Metà prima e metà dopo l'orario chiesto (i più vicini), poi si completa con i restanti più vicini:
  // così compare sempre anche la prima possibilità dopo una pausa o un viaggio pieno.
  const near = (a: TimeSuggestion, b: TimeSuggestion) => Math.abs(toMinutes(a.time) - want) - Math.abs(toMinutes(b.time) - want) || Number(b.join) - Number(a.join);
  const all = [...found.values()].sort(near);
  const half = Math.ceil(max / 2);
  const picked = [...all.filter((x) => toMinutes(x.time) < want).slice(0, half), ...all.filter((x) => toMinutes(x.time) > want).slice(0, half)];
  for (const x of all) if (picked.length < max && !picked.includes(x)) picked.push(x);
  return picked.slice(0, max).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Corse aperte in conflitto tra loro (viaggi diversi troppo vicini, o viaggio oltre i posti),
 * per gli avvisi di reception e autista: id della corsa → corse con cui si scontra.
 */
export function rideConflicts(rides: Ride[], settings: Pick<ShuttleSettings, 'seats' | 'pickupGapMinutes'>): Map<string, Ride[]> {
  const open = rides.filter((r) => isOpen(r.status));
  const out = new Map<string, Ride[]>();
  const add = (a: Ride, b: Ride) => out.set(a.id, [...(out.get(a.id) ?? []), b]);
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]!;
      const b = open[j]!;
      if (a.serviceDate !== b.serviceDate || tripKey(a) === tripKey(b)) continue;
      if (settings.pickupGapMinutes > 0 && Math.abs(toMinutes(a.time) - toMinutes(b.time)) < settings.pickupGapMinutes) {
        add(a, b);
        add(b, a);
      }
    }
  }
  for (const trip of groupTrips(open)) {
    if (trip.persons > settings.seats) for (const r of trip.rides) for (const o of trip.rides) if (o !== r) add(r, o);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Soggiorni, camere e PIN dello staff
// ---------------------------------------------------------------------------

export function isStayValid(stay: ShuttleStay, nowMs: number): boolean {
  if (stay.revokedAt) return false;
  const today = romeDate(nowMs);
  return today >= stay.validFrom && today <= stay.validUntil;
}

/** Il numero di camera digitato dall'ospite, ripulito (spazi, zeri iniziali non significativi esclusi). */
export function normalizeRoom(input: string): string {
  return input.replace(/\s+/g, '').trim();
}

/** PIN dello staff: 4 cifre. Reception e autista devono avere PIN diversi (il PIN decide il ruolo). */
/** Cifre dei PIN nuovi dello staff (i PIN di 4 cifre già impostati funzionano finché non si cambiano). */
export const STAFF_PIN_MIN = 6;
export const STAFF_PIN_MAX = 8;

/** Vero per PIN banali: cifre tutte uguali o in fila, anche a scendere (123456, 987654, 890123). */
export function isTrivialPin(pin: string): boolean {
  return /^(\d)\1+$/.test(pin) || '01234567890123'.includes(pin) || '98765432109876'.includes(pin);
}

export function staffPinProblem(pin: string, otherRolePin: string | null): string | null {
  if (!new RegExp(`^\\d{${STAFF_PIN_MIN},${STAFF_PIN_MAX}}$`).test(pin)) return `Il PIN deve avere da ${STAFF_PIN_MIN} a ${STAFF_PIN_MAX} cifre.`;
  if (isTrivialPin(pin)) return 'PIN troppo facile: evita cifre tutte uguali o in fila.';
  if (otherRolePin !== null && pin === otherRolePin) return 'Reception e autista devono avere PIN diversi.';
  return null;
}

// ---------------------------------------------------------------------------
// Transizioni di stato
// ---------------------------------------------------------------------------

export function applyDriverMessage(ride: Ride, kind: DriverMessageKind, nowIso: string): Ride {
  if (!isOpen(ride.status)) {
    throw new ShuttleError('stato_non_valido', 'La corsa è già chiusa.');
  }
  const arrivedAt = ride.arrivedAt ?? (kind === 'arrivato' ? nowIso : null);
  return {
    ...ride,
    readAt: ride.readAt ?? nowIso,
    lastMessage: kind,
    lastMessageAt: nowIso,
    arrivedAt,
    status: arrivedAt ? 'sul_posto' : 'confermata',
    updatedAt: nowIso,
  };
}

export function applyDone(ride: Ride, nowIso: string): Ride {
  if (ride.status !== 'confermata' && ride.status !== 'sul_posto') {
    throw new ShuttleError('stato_non_valido', 'Conferma prima la lettura con un messaggio all’ospite.');
  }
  return { ...ride, status: 'completata', completedAt: nowIso, updatedAt: nowIso };
}

export interface WaitState {
  deadlineMs: number;
  remainingMs: number;
  expired: boolean;
}

export function waitState(ride: Pick<Ride, 'arrivedAt'>, settings: Pick<ShuttleSettings, 'waitMinutes'>, nowMs: number): WaitState | null {
  if (!ride.arrivedAt) return null;
  const deadlineMs = Date.parse(ride.arrivedAt) + settings.waitMinutes * 60000;
  const remainingMs = Math.max(0, deadlineMs - nowMs);
  return { deadlineMs, remainingMs, expired: remainingMs === 0 };
}

/** Minuti prima dell'orario in cui l'autista riceve l'avviso di partire per il pick-up. */
export const DEPART_ALERT_MINUTES = 7;
/** Oltre questo ritardo la corsa non lampeggia più: è una corsa rimasta aperta che la reception deve chiudere. */
export const DEPART_ALERT_MAX_LATE_MINUTES = 30;

export interface DepartState {
  /** Minuti all'orario della corsa: negativi se l'orario è già passato. */
  minutesLeft: number;
}

/**
 * Avviso di partenza per l'autista: da 7 minuti prima dell'orario finché non avvisa l'ospite di essere
 * arrivato (o la corsa si chiude), al massimo per 30 minuti dopo l'orario. Solo corse di oggi ancora da fare.
 */
export function departState(
  ride: Pick<Ride, 'status' | 'serviceDate' | 'time'>,
  nowMs: number,
  leadMinutes: number = DEPART_ALERT_MINUTES,
): DepartState | null {
  if (ride.status !== 'richiesta' && ride.status !== 'confermata') return null;
  if (ride.serviceDate !== romeDate(nowMs)) return null;
  const minutesLeft = toMinutes(ride.time) - romeMinutesOfDay(nowMs);
  return minutesLeft <= leadMinutes && minutesLeft >= -DEPART_ALERT_MAX_LATE_MINUTES ? { minutesLeft } : null;
}

/** Dove l'autista carica l'ospite: in hotel all'andata, all'impianto al ritorno. */
export function pickupPlace(ride: Pick<Ride, 'direction' | 'destinationName'>): string {
  return ride.direction === 'andata' ? 'Hotel' : ride.destinationName;
}

/** Testo breve del tempo che manca al pick-up: «fra 5 min», «adesso», «3 min di ritardo». */
export function departLabel(minutesLeft: number): string {
  if (minutesLeft > 0) return `fra ${minutesLeft} min`;
  if (minutesLeft === 0) return 'adesso';
  return `${-minutesLeft} min di ritardo`;
}

export function applyNoShow(ride: Ride, settings: ShuttleSettings, nowMs: number): Ride {
  if (ride.status !== 'sul_posto') {
    throw new ShuttleError('stato_non_valido', 'Prima avvisa l’ospite che sei arrivato.');
  }
  const wait = waitState(ride, settings, nowMs);
  if (!wait || !wait.expired) {
    throw new ShuttleError('attesa_in_corso', `L’attesa di ${settings.waitMinutes} minuti non è ancora finita.`);
  }
  const nowIso = new Date(nowMs).toISOString();
  return { ...ride, status: 'no_show', noShowAt: nowIso, chargeDecision: 'da_valutare', updatedAt: nowIso };
}

/** L'ospite può cancellare finché l'autista non lo ha avvisato di essere arrivato. */
export function canGuestCancel(ride: Pick<Ride, 'status'>): boolean {
  return ride.status === 'richiesta' || ride.status === 'confermata';
}

export function applyCancel(ride: Ride, actor: Actor, nowIso: string): Ride {
  if (actor === 'ospite' && !canGuestCancel(ride)) {
    throw new ShuttleError('stato_non_valido', 'L’autista è già arrivato: contatta la reception.');
  }
  if (!isOpen(ride.status)) {
    throw new ShuttleError('stato_non_valido', 'La corsa è già chiusa.');
  }
  return { ...ride, status: 'annullata', cancelledAt: nowIso, cancelledBy: actor, updatedAt: nowIso };
}

export function applyCharge(ride: Ride, decision: ChargeDecision, nowIso: string): Ride {
  if (ride.status !== 'no_show') {
    throw new ShuttleError('stato_non_valido', 'L’addebito si decide solo per le corse non presentate.');
  }
  return { ...ride, chargeDecision: decision, updatedAt: nowIso };
}

// ---------------------------------------------------------------------------
// Viste
// ---------------------------------------------------------------------------

export function compareRides(a: Ride, b: Ride): number {
  return a.time.localeCompare(b.time) || a.room.localeCompare(b.room, 'it', { numeric: true }) || a.createdAt.localeCompare(b.createdAt);
}

export interface TimeSlotGroup {
  time: HhMm;
  rides: Ride[];
  /** Persone delle corse ancora valide (escluse annullate) nella stessa fascia. */
  persons: number;
  overCapacity: boolean;
}

/** Raggruppa per orario le corse di una direzione, segnalando le fasce oltre i posti disponibili. */
export function groupBySlot(rides: Ride[], direction: Direction, seats: number): TimeSlotGroup[] {
  const map = new Map<HhMm, Ride[]>();
  for (const r of rides.filter((x) => x.direction === direction).sort(compareRides)) {
    const list = map.get(r.time) ?? [];
    list.push(r);
    map.set(r.time, list);
  }
  return [...map.entries()].map(([time, list]) => {
    const persons = list.filter((r) => r.status !== 'annullata').reduce((s, r) => s + r.persons, 0);
    return { time, rides: list, persons, overCapacity: persons > seats };
  });
}

export const STATUS_LABEL: Record<RideStatus, string> = {
  richiesta: 'Da leggere',
  confermata: 'Confermata',
  sul_posto: 'Autista sul posto',
  completata: 'Fatto',
  no_show: 'Non presentato',
  annullata: 'Annullata',
};

export const DRIVER_MESSAGE_LABEL: Record<DriverMessageKind, string> = {
  arrivato: 'Sono arrivato',
  sette_minuti: 'Fra 7 minuti, un po’ di pazienza',
  traffico: 'C’è traffico, sto arrivando',
};

export const CHARGE_LABEL: Record<ChargeDecision, string> = {
  da_valutare: 'Addebito da valutare',
  addebitare: 'Da addebitare',
  non_addebitare: 'Nessun addebito',
};

export const PROBLEM_LABEL_IT: Record<RideInputProblem, string> = {
  data_non_valida: 'Data non valida.',
  data_fuori_soggiorno: 'La data è fuori dal soggiorno.',
  data_troppo_lontana: 'Si può prenotare solo per oggi o domani.',
  orario_non_valido: 'Orario non valido.',
  fuori_orario_servizio: 'Orario fuori dal servizio.',
  troppo_presto: 'Orario troppo vicino: serve più anticipo.',
  persone_non_valide: 'Numero di persone non valido.',
  destinazione_non_valida: 'Scegli un impianto.',
  condizioni_non_accettate: 'Accetta le condizioni di attesa.',
  orario_occupato: 'A quell’ora il mezzo è già impegnato in un altro viaggio.',
  posti_esauriti: 'Il viaggio a quell’ora è già pieno.',
  troppe_corse: `Questa camera ha già ${MAX_GUEST_OPEN_RIDES_PER_DAY} corse aperte in quel giorno.`,
};

/** Riga CSV della giornata per la reception (separatore «;» per Excel in italiano). */
export function ridesToCsv(rides: Ride[]): string {
  const head = ['Data', 'Ora', 'Direzione', 'Camera', 'Persone', 'Impianto', 'Stato', 'Letta alle', 'Ultimo messaggio', 'Arrivato alle', 'Chiusa alle', 'Addebito', 'Note', 'Inserita da', 'ID prenotazione Slope'];
  const esc = (v: string | number | null): string => {
    const s = v === null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }) : '');
  const rows = [...rides].sort(compareRides).map((r) => [
    r.serviceDate,
    r.time,
    r.direction === 'andata' ? 'Andata (hotel → impianto)' : 'Ritorno (impianto → hotel)',
    r.room,
    r.persons,
    r.destinationName,
    STATUS_LABEL[r.status],
    t(r.readAt),
    r.lastMessage ? DRIVER_MESSAGE_LABEL[r.lastMessage] : '',
    t(r.arrivedAt),
    t(r.completedAt ?? r.noShowAt ?? r.cancelledAt),
    r.chargeDecision ? CHARGE_LABEL[r.chargeDecision] : '',
    r.note,
    r.createdBy,
    r.reservationId,
  ]);
  return [head, ...rows].map((row) => row.map(esc).join(';')).join('\r\n');
}
