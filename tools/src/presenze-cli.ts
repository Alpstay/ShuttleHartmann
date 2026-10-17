/**
 * Programma dell'attività pianificata: costruisce e verifica presenze.json (solo Chalet Hotel Hartmann).
 *
 *   node tools/presenze.mjs build "<PASSWORD>" <file> [<file> …]   (percorsi separati da spazi o virgole)
 *   node tools/presenze.mjs verify presenze.json "<PASSWORD>"
 *
 * I file d'ingresso stanno nello scratchpad e non si pubblicano mai. Ognuno è
 *   {"vista": "<nome>", "freshness": {…}, "rows": [ … ]}   oppure la risposta grezza di La Scatola {"data": […], …}.
 * Il tipo di riga si riconosce dai campi: prenotazioni (room_name, arrival, departure),
 * ospiti registrati (is_primary_guest / guest_type), intestatari (booker_type).
 *
 * Uscita: righe RIEPILOGO e ATTENZIONE senza dati personali, poi PRONTO oppure ERRORE.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { HARTMANN_ROOMS } from '../../src/config';
import { addDays, romeDate } from '../../src/domain/time';
import {
  FEED_APP,
  FEED_FILE,
  HARTMANN_PROPERTY_ID,
  HARTMANN_PROPERTY_NAME,
  buildPresenze,
  dayCounts,
  decryptDay,
  encryptJson,
  feedAad,
  type FeedDay,
  type FeedDayPayload,
  type PresenzeFeed,
  type ScatolaContactRow,
  type ScatolaGuestRow,
  type ScatolaReservationRow,
} from '../../src/feed/presenzeFeed';

type AnyRow = Record<string, unknown>;

interface InputFile {
  vista?: string;
  freshness?: { sources?: { property_id: string; resource: string; last_success_at: string | null }[] };
  rows?: AnyRow[];
  data?: AnyRow[];
}

function fail(msg: string): never {
  console.log(`ERRORE: ${msg}`);
  process.exit(1);
}

function readInputs(paths: string[]) {
  const reservations: ScatolaReservationRow[] = [];
  const guests: ScatolaGuestRow[] = [];
  const contacts: ScatolaContactRow[] = [];
  let dataAsOf: string | null = null;
  for (const p of paths) {
    let j: InputFile;
    try {
      j = JSON.parse(readFileSync(p, 'utf8')) as InputFile;
    } catch (e) {
      fail(`file non leggibile o non JSON: ${p} (${(e as Error).message})`);
    }
    const rows = j.rows ?? j.data ?? [];
    if (!Array.isArray(rows)) fail(`nel file ${p} manca l'elenco "rows" o "data"`);
    const src = j.freshness?.sources?.find((s) => s.property_id === HARTMANN_PROPERTY_ID && s.resource === 'lodging_reservation');
    if (src?.last_success_at && (!dataAsOf || src.last_success_at > dataAsOf)) dataAsOf = src.last_success_at;
    for (const r of rows) {
      if ('booker_type' in r || j.vista === 'curated_reservation_contacts') contacts.push(r as unknown as ScatolaContactRow);
      else if ('is_primary_guest' in r || 'guest_type' in r || 'guest_stay_id' in r || j.vista === 'curated_guest_stays') guests.push(r as unknown as ScatolaGuestRow);
      else if ('room_name' in r && 'arrival' in r && 'departure' in r) reservations.push(r as unknown as ScatolaReservationRow);
      else fail(`riga non riconosciuta nel file ${p}: mancano i campi attesi`);
    }
  }
  return { reservations, guests, contacts, dataAsOf };
}

function nameWords(guests: ScatolaGuestRow[], contacts: ScatolaContactRow[]): Set<string> {
  const words = new Set<string>();
  const add = (v: string | null | undefined) =>
    (v ?? '')
      .split(/[\s,.'-]+/)
      .filter((w) => w.length >= 4)
      .forEach((w) => words.add(w.toLowerCase()));
  guests.forEach((g) => (add(g.first_name), add(g.last_name)));
  contacts.forEach((c) => (add(c.first_name), add(c.last_name), add(c.organization_name)));
  return words;
}

/** Testo pubblico senza i blocchi cifrati: lì non deve comparire nessun nome. */
function clearText(feed: PresenzeFeed): string {
  const copy = JSON.parse(JSON.stringify(feed)) as PresenzeFeed;
  for (const d of Object.values(copy.days)) d.enc = { ...d.enc, ct: '', salt: '', iv: '' };
  return JSON.stringify(copy).toLowerCase();
}

async function build(args: string[]) {
  const password = args[0];
  if (!password || password.length < 12) fail('password mancante o troppo corta (primo argomento, tra virgolette)');
  const giorniIdx = args.indexOf('--giorni');
  const giorni = giorniIdx >= 0 ? (args[giorniIdx + 1] ?? '').split(',').filter(Boolean) : null;
  const files = args
    .slice(1)
    .filter((_, i, all) => all[i - 1] !== '--giorni' && all[i] !== '--giorni')
    .flatMap((a) => a.split(','))
    .filter(Boolean);
  if (!files.length) fail('indica almeno il file delle prenotazioni');

  const today = romeDate(Date.now());
  const days = giorni ?? [today, addDays(today, 1)];
  const { reservations, guests, contacts, dataAsOf } = readInputs(files);
  if (!reservations.length) fail('nessuna prenotazione nei file: La Scatola non ha risposto o il file è vuoto');

  const res = buildPresenze({ rows: reservations, guests, contacts, days, knownRooms: HARTMANN_ROOMS });
  res.errors.forEach((e) => console.log(`ERRORE: ${e}`));
  if (res.errors.length) process.exit(1);
  const first = days[0] as string;
  if (!res.payloads[first]?.stays.length) fail(`zero camere per ${first}: non pubblicare`);

  if (dataAsOf) {
    const hours = (Date.now() - Date.parse(dataAsOf)) / 3600000;
    if (hours > 6) console.log(`ATTENZIONE: La Scatola non aggiorna le prenotazioni Hartmann da ${Math.round(hours)} ore`);
  } else {
    console.log('ATTENZIONE: blocco freshness assente: orario dei dati sconosciuto');
  }

  const out: PresenzeFeed = {
    app: FEED_APP,
    property: HARTMANN_PROPERTY_NAME,
    property_id: HARTMANN_PROPERTY_ID,
    source: 'La Scatola',
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    data_as_of: dataAsOf,
    days: {},
  };
  for (const d of days) {
    const payload = res.payloads[d] as FeedDayPayload;
    const day: FeedDay = { ...dayCounts(payload, d), enc: await encryptJson(payload, password, feedAad(d)) };
    out.days[d] = day;
  }

  // Ricontrollo prima di scrivere: si decifra tutto e nessun nome compare in chiaro.
  for (const d of days) {
    const back = await decryptDay(out, d, password);
    if (JSON.stringify(back) !== JSON.stringify(res.payloads[d])) fail(`ricontrollo fallito per ${d}`);
  }
  const text = clearText(out);
  const leaked = [...nameWords(guests, contacts)].filter((w) => new RegExp(`(?<![a-zà-ÿ0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zà-ÿ0-9])`).test(text));
  if (leaked.length) fail(`${leaked.length} parole-nome comparirebbero in chiaro: non pubblicare`);

  writeFileSync(FEED_FILE, `${JSON.stringify(out, null, 1)}\n`);
  res.report.forEach((l) => console.log(l));
  res.warnings.forEach((l) => console.log(l));
  console.log(`PRONTO: ${FEED_FILE} scritto e ricontrollato (${days.join(', ')}; dati La Scatola ${dataAsOf ?? 'orario sconosciuto'})`);
}

async function verify(args: string[]) {
  const [path, password] = args;
  if (!path || !password) fail('uso: verify presenze.json "<PASSWORD>"');
  let feed: PresenzeFeed;
  try {
    feed = JSON.parse(readFileSync(path, 'utf8')) as PresenzeFeed;
  } catch {
    fail(`${path} non leggibile`);
  }
  if (feed.app !== FEED_APP) fail('il file non è un presenze.json dello shuttle');
  if (feed.property_id !== HARTMANN_PROPERTY_ID) fail('il file non è dell’Hartmann');
  const today = romeDate(Date.now());
  if (!feed.days[today]) fail(`il file non contiene oggi (${today})`);
  let names = 0;
  const words = new Set<string>();
  for (const d of Object.keys(feed.days)) {
    let p: FeedDayPayload | null;
    try {
      p = await decryptDay(feed, d, password);
    } catch {
      fail(`impossibile decifrare ${d}: password sbagliata o file alterato`);
    }
    if (!p) fail(`giorno ${d} vuoto`);
    for (const s of p.stays) {
      if (!s.room || !/^[0-9a-f-]{36}$/i.test(s.reservation_id)) fail(`dato non valido in ${d}`);
      if (s.name) {
        names++;
        s.name.split(/[\s.]+/).filter((w) => w.length >= 4).forEach((w) => words.add(w.toLowerCase()));
      }
    }
    const c = dayCounts(p, d);
    const day = feed.days[d] as FeedDay;
    if (c.camere !== day.camere || c.persone !== day.persone) fail(`conteggi in chiaro diversi dal contenuto cifrato per ${d}`);
  }
  const text = clearText(feed);
  const leaked = [...words].filter((w) => text.includes(w));
  if (leaked.length) fail(`${leaked.length} parole-nome in chiaro nel file`);
  if (!feed.days[today]?.camere) fail(`zero camere per oggi (${today})`);
  console.log(`verifica OK: ${Object.keys(feed.days).join(', ')}; ${feed.days[today]?.camere} camere oggi; ${names} nomi cifrati, nessuno in chiaro`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'build') await build(rest);
else if (cmd === 'verify') await verify(rest);
else fail('comando sconosciuto: usa build oppure verify');
