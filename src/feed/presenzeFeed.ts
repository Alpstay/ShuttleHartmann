/**
 * Formato di presenze.json e logica di costruzione, condivisi da:
 *  - l'attività pianificata (tools/presenze.mjs, generato da tools/src/presenze-cli.ts)
 *  - la pagina reception, che lo decifra con la password.
 *
 * Stesso schema di ColazioniSAS / WelcomeHartmann: AES-GCM 256, chiave da password con
 * PBKDF2-SHA256 (250.000 iterazioni), sale e IV casuali, dato aggiuntivo «ShuttleHartmann|<giorno>».
 * In chiaro restano solo i conteggi del giorno; camere, nomi e ID prenotazione sono cifrati.
 */
import type { IsoDate, Presence, PresenceState } from '../domain/types';

export const FEED_APP = 'ShuttleHartmann';
export const FEED_FILE = 'presenze.json';
export const FEED_ITERATIONS = 250_000;
export const HARTMANN_PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
export const HARTMANN_PROPERTY_NAME = 'Alpstay - Chalet Hotel Hartmann - Adults Only';

export const feedAad = (day: IsoDate): string => `${FEED_APP}|${day}`;

export interface EncBlock {
  alg: 'AES-GCM/PBKDF2-SHA256';
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export interface FeedDay {
  camere: number;
  persone: number;
  arrivi: number;
  partenze: number;
  enc: EncBlock;
}

export interface PresenzeFeed {
  app: typeof FEED_APP;
  property: string;
  property_id: string;
  source: 'La Scatola';
  generated: string;
  /** last_success_at di La Scatola per le prenotazioni Hartmann. */
  data_as_of: string | null;
  days: Record<IsoDate, FeedDay>;
}

export interface FeedStay {
  reservation_id: string;
  room: string;
  adults: number;
  children: number;
  arrival: IsoDate;
  departure: IsoDate;
  state: PresenceState;
  name: string | null;
}

export interface FeedDayPayload {
  stays: FeedStay[];
}

// ---------------------------------------------------------------------------
// Cifratura (WebCrypto: browser e Node 20+)
// ---------------------------------------------------------------------------

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto non disponibile');
  return c.subtle;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}

function fromB64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function keyFrom(password: string, salt: Uint8Array, iter: number, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function encryptJson(value: unknown, password: string, aad: string): Promise<EncBlock> {
  const c = globalThis.crypto;
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(password, salt, FEED_ITERATIONS, 'encrypt');
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return { alg: 'AES-GCM/PBKDF2-SHA256', iter: FEED_ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** Lancia un errore se la password è sbagliata o il blocco è stato alterato. */
export async function decryptJson<T>(enc: EncBlock, password: string, aad: string): Promise<T> {
  const key = await keyFrom(password, fromB64(enc.salt), enc.iter, 'decrypt');
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv), additionalData: new TextEncoder().encode(aad) }, key, fromB64(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export async function decryptDay(feed: PresenzeFeed, day: IsoDate, password: string): Promise<FeedDayPayload | null> {
  const entry = feed.days[day];
  if (!entry) return null;
  return decryptJson<FeedDayPayload>(entry.enc, password, feedAad(day));
}

export function feedStayToPresence(s: FeedStay): Presence {
  return {
    reservationId: s.reservation_id,
    room: s.room,
    adults: s.adults,
    children: s.children,
    arrival: s.arrival,
    departure: s.departure,
    state: s.state,
    name: s.name,
  };
}

// ---------------------------------------------------------------------------
// Costruzione dai dati di La Scatola
// ---------------------------------------------------------------------------

/** Righe di list_in_house / list_departures così come arrivano da La Scatola (campi usati). */
export interface ScatolaReservationRow {
  reservation_id: string;
  property_id: string;
  room_name: string | null;
  arrival: string;
  departure: string;
  adults: number | null;
  children: number | null;
  is_option?: boolean | null;
  booking_status?: string | null;
  stay_status?: string | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
}

/** Righe di curated_guest_stays (ospiti registrati). */
export interface ScatolaGuestRow {
  reservation_id: string;
  property_id?: string;
  guest_type?: string | null;
  is_primary_guest?: boolean | null;
  first_name?: string | null;
  last_name?: string | null;
}

/** Righe di curated_reservation_contacts (intestatari). */
export interface ScatolaContactRow {
  reservation_id: string;
  property_id?: string;
  booker_type?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  organization_name?: string | null;
}

export interface BuildInput {
  rows: ScatolaReservationRow[];
  guests: ScatolaGuestRow[];
  contacts: ScatolaContactRow[];
  days: IsoDate[];
  knownRooms: readonly string[];
}

export interface BuildResult {
  payloads: Record<IsoDate, FeedDayPayload>;
  /** Righe stampabili: solo numeri, nessun dato personale. */
  report: string[];
  warnings: string[];
  errors: string[];
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cap(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() || w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/** «Cognome N.»: basta alla reception per riconoscere l'ospite. */
export function shortName(last: string | null | undefined, first: string | null | undefined): string | null {
  const l = cap(last ?? '');
  const f = cap(first ?? '');
  const out = `${l}${f ? ` ${f.charAt(0)}.` : ''}`.trim();
  return out || null;
}

function primaryGuest(list: ScatolaGuestRow[]): ScatolaGuestRow | undefined {
  return (
    list.find((g) => g.is_primary_guest) ??
    list.find((g) => g.guest_type === 'HEAD' || g.guest_type === 'SINGLE') ??
    list[0]
  );
}

export function stateOn(row: ScatolaReservationRow, day: IsoDate): PresenceState {
  if (row.departure === day) return row.check_out_at ? 'partito' : 'parte';
  if (row.check_in_at) return 'in_casa';
  if (row.arrival <= day && row.stay_status === 'IN_HOUSE') return 'in_casa';
  return 'arriva';
}

export function buildPresenze(input: BuildInput): BuildResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const report: string[] = [];

  // 1. Solo Hartmann, nessun duplicato incoerente, ID e date valide.
  const byId = new Map<string, ScatolaReservationRow>();
  for (const r of input.rows) {
    if (r.property_id !== HARTMANN_PROPERTY_ID) {
      errors.push(`riga di un'altra struttura (property_id ${r.property_id}): i dati devono essere solo dell'Hartmann`);
      continue;
    }
    if (!ID_RE.test(r.reservation_id ?? '')) {
      errors.push(`reservation_id non valido: ${String(r.reservation_id).slice(0, 40)}`);
      continue;
    }
    if (!DATE_RE.test(r.arrival) || !DATE_RE.test(r.departure) || r.arrival >= r.departure) {
      errors.push(`date non valide per la prenotazione ${r.reservation_id}`);
      continue;
    }
    if (r.is_option) continue;
    if (r.booking_status && r.booking_status !== 'CONFIRMED') continue;
    const prev = byId.get(r.reservation_id);
    if (prev) {
      const same = prev.room_name === r.room_name && prev.arrival === r.arrival && prev.departure === r.departure && prev.adults === r.adults && prev.children === r.children;
      if (!same) errors.push(`la prenotazione ${r.reservation_id} compare due volte con dati diversi: ricontrolla la trascrizione`);
      // a parità di dati teniamo quella con più informazioni sui check-in/out
      if ((r.check_out_at && !prev.check_out_at) || (r.check_in_at && !prev.check_in_at)) byId.set(r.reservation_id, r);
      continue;
    }
    byId.set(r.reservation_id, r);
  }
  const rows = [...byId.values()];

  // 2. Nomi: ospite registrato principale, altrimenti intestatario.
  const ids = new Set(rows.map((r) => r.reservation_id));
  const guestsBy = new Map<string, ScatolaGuestRow[]>();
  for (const g of input.guests) {
    if (g.property_id && g.property_id !== HARTMANN_PROPERTY_ID) continue;
    const l = guestsBy.get(g.reservation_id) ?? [];
    l.push(g);
    guestsBy.set(g.reservation_id, l);
  }
  const contactBy = new Map<string, ScatolaContactRow>();
  for (const c of input.contacts) {
    if (c.property_id && c.property_id !== HARTMANN_PROPERTY_ID) continue;
    contactBy.set(c.reservation_id, c);
  }
  const orphanIds = new Set([...guestsBy.keys(), ...contactBy.keys()].filter((id) => !ids.has(id)));
  // Ospiti o intestatari di prenotazioni fuori dal periodo sono normali; segnaliamo solo quelli che
  // sembrano una trascrizione sbagliata (stesso prefisso di un ID presente).
  for (const id of orphanIds) {
    const near = [...ids].find((x) => x.slice(0, 8) === id.slice(0, 8) || x.slice(-12) === id.slice(-12));
    if (near) warnings.push(`ATTENZIONE: ${id} non è tra le prenotazioni ma assomiglia a ${near}: possibile reservation_id trascritto male`);
  }
  const nameOf = (id: string): string | null => {
    const g = primaryGuest(guestsBy.get(id) ?? []);
    const fromGuest = g ? shortName(g.last_name, g.first_name) : null;
    if (fromGuest) return fromGuest;
    const c = contactBy.get(id);
    if (!c) return null;
    if (c.booker_type === 'COMPANY' && c.organization_name) return cap(c.organization_name);
    return shortName(c.last_name, c.first_name);
  };

  // 3. Giorno per giorno: chi è presente (arrivo ≤ giorno ≤ partenza).
  const payloads: Record<IsoDate, FeedDayPayload> = {};
  for (const day of input.days) {
    const present = rows.filter((r) => r.arrival <= day && day <= r.departure);
    const stays: FeedStay[] = [];
    const noRoom: string[] = [];
    for (const r of present) {
      if (!r.room_name) {
        noRoom.push(r.reservation_id);
        continue;
      }
      if (!input.knownRooms.includes(r.room_name)) {
        warnings.push(`ATTENZIONE: camera ${r.room_name} non è nell'elenco delle camere Hartmann (${day})`);
      }
      stays.push({
        reservation_id: r.reservation_id,
        room: r.room_name,
        adults: r.adults ?? 0,
        children: r.children ?? 0,
        arrival: r.arrival,
        departure: r.departure,
        state: stateOn(r, day),
        name: nameOf(r.reservation_id),
      });
    }
    // Due prenotazioni nella stessa camera la stessa notte = dato da verificare in Slope.
    const nightByRoom = new Map<string, number>();
    for (const s of stays.filter((x) => x.departure > day)) nightByRoom.set(s.room, (nightByRoom.get(s.room) ?? 0) + 1);
    for (const [room, n] of nightByRoom) if (n > 1) warnings.push(`ATTENZIONE: camera ${room} ha ${n} prenotazioni per la notte del ${day}`);

    stays.sort((a, b) => a.room.localeCompare(b.room, 'it', { numeric: true }) || a.arrival.localeCompare(b.arrival));
    payloads[day] = { stays };
    const sleeping = stays.filter((s) => s.departure > day);
    report.push(
      `RIEPILOGO ${day}: ${new Set(stays.map((s) => s.room)).size} camere, ${sleeping.reduce((t, s) => t + s.adults + s.children, 0)} persone per la notte, ` +
        `${stays.filter((s) => s.state === 'arriva' || s.arrival === day).length} arrivi, ${stays.filter((s) => s.departure === day).length} partenze, ` +
        `${stays.filter((s) => s.name).length}/${stays.length} con nome` +
        (noRoom.length ? `, ${noRoom.length} senza camera assegnata` : ''),
    );
  }
  return { payloads, report, warnings, errors };
}

export function dayCounts(p: FeedDayPayload, day: IsoDate): Omit<FeedDay, 'enc'> {
  const sleeping = p.stays.filter((s) => s.departure > day);
  return {
    camere: new Set(p.stays.map((s) => s.room)).size,
    persone: sleeping.reduce((t, s) => t + s.adults + s.children, 0),
    arrivi: p.stays.filter((s) => s.arrival === day).length,
    partenze: p.stays.filter((s) => s.departure === day).length,
  };
}
