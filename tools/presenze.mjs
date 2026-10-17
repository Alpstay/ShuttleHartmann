// Generato da tools/src/presenze-cli.ts con npm run build:tools: non modificare a mano.

// tools/src/presenze-cli.ts
import { readFileSync, writeFileSync } from "node:fs";

// src/config.ts
var HARTMANN_ROOMS = ["101", "102", "103", "105", "107", "108", "119", "121", "122"];

// src/domain/time.ts
var TIME_ZONE = "Europe/Rome";
var dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});
function romeDate(ms) {
  return dateFmt.format(new Date(ms));
}
function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}
var longDate = {
  it: new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }),
  de: new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }),
  en: new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
};
var shortDate = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

// src/feed/presenzeFeed.ts
var FEED_APP = "ShuttleHartmann";
var FEED_FILE = "presenze.json";
var FEED_ITERATIONS = 25e4;
var HARTMANN_PROPERTY_ID = "22222222-2222-4222-8222-222222222222";
var HARTMANN_PROPERTY_NAME = "Alpstay - Chalet Hotel Hartmann - Adults Only";
var feedAad = (day) => `${FEED_APP}|${day}`;
function subtle() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto non disponibile");
  return c.subtle;
}
function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function keyFrom(password, salt, iter, usage) {
  const base = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
}
async function encryptJson(value, password, aad) {
  const c = globalThis.crypto;
  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(password, salt, FEED_ITERATIONS, "encrypt");
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return { alg: "AES-GCM/PBKDF2-SHA256", iter: FEED_ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
async function decryptJson(enc, password, aad) {
  const key = await keyFrom(password, fromB64(enc.salt), enc.iter, "decrypt");
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(enc.iv), additionalData: new TextEncoder().encode(aad) }, key, fromB64(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function decryptDay(feed, day, password) {
  const entry = feed.days[day];
  if (!entry) return null;
  return decryptJson(entry.enc, password, feedAad(day));
}
var ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function cap(s) {
  return s.trim().split(/\s+/).map((w) => w === w.toUpperCase() || w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w).join(" ");
}
function shortName(last, first) {
  const l = cap(last ?? "");
  const f = cap(first ?? "");
  const out = `${l}${f ? ` ${f.charAt(0)}.` : ""}`.trim();
  return out || null;
}
function primaryGuest(list) {
  return list.find((g) => g.is_primary_guest) ?? list.find((g) => g.guest_type === "HEAD" || g.guest_type === "SINGLE") ?? list[0];
}
function stateOn(row, day) {
  if (row.departure === day) return row.check_out_at ? "partito" : "parte";
  if (row.check_in_at) return "in_casa";
  if (row.arrival <= day && row.stay_status === "IN_HOUSE") return "in_casa";
  return "arriva";
}
function buildPresenze(input) {
  const warnings = [];
  const errors = [];
  const report = [];
  const byId = /* @__PURE__ */ new Map();
  for (const r of input.rows) {
    if (r.property_id !== HARTMANN_PROPERTY_ID) {
      errors.push(`riga di un'altra struttura (property_id ${r.property_id}): i dati devono essere solo dell'Hartmann`);
      continue;
    }
    if (!ID_RE.test(r.reservation_id ?? "")) {
      errors.push(`reservation_id non valido: ${String(r.reservation_id).slice(0, 40)}`);
      continue;
    }
    if (!DATE_RE.test(r.arrival) || !DATE_RE.test(r.departure) || r.arrival >= r.departure) {
      errors.push(`date non valide per la prenotazione ${r.reservation_id}`);
      continue;
    }
    if (r.is_option) continue;
    if (r.booking_status && r.booking_status !== "CONFIRMED") continue;
    const prev = byId.get(r.reservation_id);
    if (prev) {
      const same = prev.room_name === r.room_name && prev.arrival === r.arrival && prev.departure === r.departure && prev.adults === r.adults && prev.children === r.children;
      if (!same) errors.push(`la prenotazione ${r.reservation_id} compare due volte con dati diversi: ricontrolla la trascrizione`);
      if (r.check_out_at && !prev.check_out_at || r.check_in_at && !prev.check_in_at) byId.set(r.reservation_id, r);
      continue;
    }
    byId.set(r.reservation_id, r);
  }
  const rows = [...byId.values()];
  const ids = new Set(rows.map((r) => r.reservation_id));
  const guestsBy = /* @__PURE__ */ new Map();
  for (const g of input.guests) {
    if (g.property_id && g.property_id !== HARTMANN_PROPERTY_ID) continue;
    const l = guestsBy.get(g.reservation_id) ?? [];
    l.push(g);
    guestsBy.set(g.reservation_id, l);
  }
  const contactBy = /* @__PURE__ */ new Map();
  for (const c of input.contacts) {
    if (c.property_id && c.property_id !== HARTMANN_PROPERTY_ID) continue;
    contactBy.set(c.reservation_id, c);
  }
  const orphanIds = new Set([...guestsBy.keys(), ...contactBy.keys()].filter((id) => !ids.has(id)));
  for (const id of orphanIds) {
    const near = [...ids].find((x) => x.slice(0, 8) === id.slice(0, 8) || x.slice(-12) === id.slice(-12));
    if (near) warnings.push(`ATTENZIONE: ${id} non \xE8 tra le prenotazioni ma assomiglia a ${near}: possibile reservation_id trascritto male`);
  }
  const nameOf = (id) => {
    const g = primaryGuest(guestsBy.get(id) ?? []);
    const fromGuest = g ? shortName(g.last_name, g.first_name) : null;
    if (fromGuest) return fromGuest;
    const c = contactBy.get(id);
    if (!c) return null;
    if (c.booker_type === "COMPANY" && c.organization_name) return cap(c.organization_name);
    return shortName(c.last_name, c.first_name);
  };
  const payloads = {};
  for (const day of input.days) {
    const present = rows.filter((r) => r.arrival <= day && day <= r.departure);
    const stays = [];
    const noRoom = [];
    for (const r of present) {
      if (!r.room_name) {
        noRoom.push(r.reservation_id);
        continue;
      }
      if (!input.knownRooms.includes(r.room_name)) {
        warnings.push(`ATTENZIONE: camera ${r.room_name} non \xE8 nell'elenco delle camere Hartmann (${day})`);
      }
      stays.push({
        reservation_id: r.reservation_id,
        room: r.room_name,
        adults: r.adults ?? 0,
        children: r.children ?? 0,
        arrival: r.arrival,
        departure: r.departure,
        state: stateOn(r, day),
        name: nameOf(r.reservation_id)
      });
    }
    const nightByRoom = /* @__PURE__ */ new Map();
    for (const s of stays.filter((x) => x.departure > day)) nightByRoom.set(s.room, (nightByRoom.get(s.room) ?? 0) + 1);
    for (const [room, n] of nightByRoom) if (n > 1) warnings.push(`ATTENZIONE: camera ${room} ha ${n} prenotazioni per la notte del ${day}`);
    stays.sort((a, b) => a.room.localeCompare(b.room, "it", { numeric: true }) || a.arrival.localeCompare(b.arrival));
    payloads[day] = { stays };
    const sleeping = stays.filter((s) => s.departure > day);
    report.push(
      `RIEPILOGO ${day}: ${new Set(stays.map((s) => s.room)).size} camere, ${sleeping.reduce((t, s) => t + s.adults + s.children, 0)} persone per la notte, ${stays.filter((s) => s.state === "arriva" || s.arrival === day).length} arrivi, ${stays.filter((s) => s.departure === day).length} partenze, ${stays.filter((s) => s.name).length}/${stays.length} con nome` + (noRoom.length ? `, ${noRoom.length} senza camera assegnata` : "")
    );
  }
  return { payloads, report, warnings, errors };
}
function dayCounts(p, day) {
  const sleeping = p.stays.filter((s) => s.departure > day);
  return {
    camere: new Set(p.stays.map((s) => s.room)).size,
    persone: sleeping.reduce((t, s) => t + s.adults + s.children, 0),
    arrivi: p.stays.filter((s) => s.arrival === day).length,
    partenze: p.stays.filter((s) => s.departure === day).length
  };
}

// tools/src/presenze-cli.ts
function fail(msg) {
  console.log(`ERRORE: ${msg}`);
  process.exit(1);
}
function readInputs(paths) {
  const reservations = [];
  const guests = [];
  const contacts = [];
  let dataAsOf = null;
  for (const p of paths) {
    let j;
    try {
      j = JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      fail(`file non leggibile o non JSON: ${p} (${e.message})`);
    }
    const rows = j.rows ?? j.data ?? [];
    if (!Array.isArray(rows)) fail(`nel file ${p} manca l'elenco "rows" o "data"`);
    const src = j.freshness?.sources?.find((s) => s.property_id === HARTMANN_PROPERTY_ID && s.resource === "lodging_reservation");
    if (src?.last_success_at && (!dataAsOf || src.last_success_at > dataAsOf)) dataAsOf = src.last_success_at;
    for (const r of rows) {
      if ("booker_type" in r || j.vista === "curated_reservation_contacts") contacts.push(r);
      else if ("is_primary_guest" in r || "guest_type" in r || "guest_stay_id" in r || j.vista === "curated_guest_stays") guests.push(r);
      else if ("room_name" in r && "arrival" in r && "departure" in r) reservations.push(r);
      else fail(`riga non riconosciuta nel file ${p}: mancano i campi attesi`);
    }
  }
  return { reservations, guests, contacts, dataAsOf };
}
function nameWords(guests, contacts) {
  const words = /* @__PURE__ */ new Set();
  const add = (v) => (v ?? "").split(/[\s,.'-]+/).filter((w) => w.length >= 4).forEach((w) => words.add(w.toLowerCase()));
  guests.forEach((g) => (add(g.first_name), add(g.last_name)));
  contacts.forEach((c) => (add(c.first_name), add(c.last_name), add(c.organization_name)));
  return words;
}
function clearText(feed) {
  const copy = JSON.parse(JSON.stringify(feed));
  for (const d of Object.values(copy.days)) d.enc = { ...d.enc, ct: "", salt: "", iv: "" };
  return JSON.stringify(copy).toLowerCase();
}
async function build(args) {
  const password = args[0];
  if (!password || password.length < 12) fail("password mancante o troppo corta (primo argomento, tra virgolette)");
  const giorniIdx = args.indexOf("--giorni");
  const giorni = giorniIdx >= 0 ? (args[giorniIdx + 1] ?? "").split(",").filter(Boolean) : null;
  const files = args.slice(1).filter((_, i, all) => all[i - 1] !== "--giorni" && all[i] !== "--giorni").flatMap((a) => a.split(",")).filter(Boolean);
  if (!files.length) fail("indica almeno il file delle prenotazioni");
  const today = romeDate(Date.now());
  const days = giorni ?? [today, addDays(today, 1)];
  const { reservations, guests, contacts, dataAsOf } = readInputs(files);
  if (!reservations.length) fail("nessuna prenotazione nei file: La Scatola non ha risposto o il file \xE8 vuoto");
  const res = buildPresenze({ rows: reservations, guests, contacts, days, knownRooms: HARTMANN_ROOMS });
  res.errors.forEach((e) => console.log(`ERRORE: ${e}`));
  if (res.errors.length) process.exit(1);
  const first = days[0];
  if (!res.payloads[first]?.stays.length) fail(`zero camere per ${first}: non pubblicare`);
  if (dataAsOf) {
    const hours = (Date.now() - Date.parse(dataAsOf)) / 36e5;
    if (hours > 6) console.log(`ATTENZIONE: La Scatola non aggiorna le prenotazioni Hartmann da ${Math.round(hours)} ore`);
  } else {
    console.log("ATTENZIONE: blocco freshness assente: orario dei dati sconosciuto");
  }
  const out = {
    app: FEED_APP,
    property: HARTMANN_PROPERTY_NAME,
    property_id: HARTMANN_PROPERTY_ID,
    source: "La Scatola",
    generated: (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    data_as_of: dataAsOf,
    days: {}
  };
  for (const d of days) {
    const payload = res.payloads[d];
    const day = { ...dayCounts(payload, d), enc: await encryptJson(payload, password, feedAad(d)) };
    out.days[d] = day;
  }
  for (const d of days) {
    const back = await decryptDay(out, d, password);
    if (JSON.stringify(back) !== JSON.stringify(res.payloads[d])) fail(`ricontrollo fallito per ${d}`);
  }
  const text = clearText(out);
  const leaked = [...nameWords(guests, contacts)].filter((w) => new RegExp(`(?<![a-z\xE0-\xFF0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z\xE0-\xFF0-9])`).test(text));
  if (leaked.length) fail(`${leaked.length} parole-nome comparirebbero in chiaro: non pubblicare`);
  writeFileSync(FEED_FILE, `${JSON.stringify(out, null, 1)}
`);
  res.report.forEach((l) => console.log(l));
  res.warnings.forEach((l) => console.log(l));
  console.log(`PRONTO: ${FEED_FILE} scritto e ricontrollato (${days.join(", ")}; dati La Scatola ${dataAsOf ?? "orario sconosciuto"})`);
}
async function verify(args) {
  const [path, password] = args;
  if (!path || !password) fail('uso: verify presenze.json "<PASSWORD>"');
  let feed;
  try {
    feed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${path} non leggibile`);
  }
  if (feed.app !== FEED_APP) fail("il file non \xE8 un presenze.json dello shuttle");
  if (feed.property_id !== HARTMANN_PROPERTY_ID) fail("il file non \xE8 dell\u2019Hartmann");
  const today = romeDate(Date.now());
  if (!feed.days[today]) fail(`il file non contiene oggi (${today})`);
  let names = 0;
  const words = /* @__PURE__ */ new Set();
  for (const d of Object.keys(feed.days)) {
    let p;
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
    const day = feed.days[d];
    if (c.camere !== day.camere || c.persone !== day.persone) fail(`conteggi in chiaro diversi dal contenuto cifrato per ${d}`);
  }
  const text = clearText(feed);
  const leaked = [...words].filter((w) => text.includes(w));
  if (leaked.length) fail(`${leaked.length} parole-nome in chiaro nel file`);
  if (!feed.days[today]?.camere) fail(`zero camere per oggi (${today})`);
  console.log(`verifica OK: ${Object.keys(feed.days).join(", ")}; ${feed.days[today]?.camere} camere oggi; ${names} nomi cifrati, nessuno in chiaro`);
}
var [cmd, ...rest] = process.argv.slice(2);
if (cmd === "build") await build(rest);
else if (cmd === "verify") await verify(rest);
else fail("comando sconosciuto: usa build oppure verify");
