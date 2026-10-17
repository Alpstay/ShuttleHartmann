/**
 * Presenze del giorno per la reception: in casa, arrivi e partenze del solo Chalet Hotel Hartmann.
 * Fonte: presenze.json, generato ogni ora dall'attività pianificata con i dati di La Scatola
 * (stesso meccanismo del counter colazioni), cifrato con la password della reception.
 */
import { addDays } from '../domain/time';
import type { IsoDate, Presence, PresenceSnapshot, RoomSyncItem } from '../domain/types';
import { FEED_FILE, decryptDay, feedStayToPresence, type PresenzeFeed } from '../feed/presenzeFeed';

export type PresenceErrorCode = 'password_mancante' | 'password_errata' | 'file_assente' | 'giorno_assente' | 'rete';

export class PresenceError extends Error {
  constructor(public readonly code: PresenceErrorCode, message: string) {
    super(message);
    this.name = 'PresenceError';
  }
}

export interface PresenceSource {
  /** Nome della fonte mostrato in interfaccia. */
  label: string;
  /** La fonte richiede la password reception? */
  needsPassword: boolean;
  hasPassword(): boolean;
  setPassword(password: string | null): void;
  load(date: IsoDate): Promise<PresenceSnapshot>;
}

const PW_KEY = 'shuttle-hartmann-presenze-pw';

export class FeedPresenceSource implements PresenceSource {
  readonly label = 'La Scatola';
  readonly needsPassword = true;
  private password: string | null;

  constructor(private readonly url: string = FEED_FILE) {
    let pw: string | null = null;
    try {
      pw = localStorage.getItem(PW_KEY);
    } catch {
      pw = null;
    }
    this.password = pw;
  }

  hasPassword(): boolean {
    return !!this.password;
  }

  setPassword(password: string | null): void {
    this.password = password;
    try {
      if (password) localStorage.setItem(PW_KEY, password);
      else localStorage.removeItem(PW_KEY);
    } catch {
      /* resta solo in memoria */
    }
  }

  async load(date: IsoDate): Promise<PresenceSnapshot> {
    if (!this.password) throw new PresenceError('password_mancante', 'Inserisci la password presenze.');
    let feed: PresenzeFeed;
    try {
      const res = await fetch(this.url, { cache: 'no-store' });
      if (res.status === 404) throw new PresenceError('file_assente', 'Il file delle presenze non è ancora stato pubblicato.');
      if (!res.ok) throw new PresenceError('rete', `Presenze non raggiungibili (${res.status}).`);
      feed = (await res.json()) as PresenzeFeed;
    } catch (e) {
      if (e instanceof PresenceError) throw e;
      throw new PresenceError('rete', 'Presenze non raggiungibili: controlla la connessione.');
    }
    let payload;
    try {
      payload = await decryptDay(feed, date, this.password);
    } catch {
      throw new PresenceError('password_errata', 'Password presenze non corretta.');
    }
    if (!payload) throw new PresenceError('giorno_assente', 'Per questa data le presenze non sono disponibili (il file copre oggi e domani).');
    return {
      date,
      stays: payload.stays.map(feedStayToPresence),
      dataAsOf: feed.data_as_of,
      generatedAt: feed.generated,
      loadedAt: new Date().toISOString(),
    };
  }
}

/** Presenze di esempio per il prototipo: camere vere dell'Hartmann, ospiti inventati. */
export class DemoPresenceSource implements PresenceSource {
  readonly label = 'dati di esempio';
  readonly needsPassword = false;
  constructor(private readonly now: () => number) {}
  hasPassword(): boolean {
    return true;
  }
  setPassword(): void {
    /* non serve */
  }

  async load(date: IsoDate): Promise<PresenceSnapshot> {
    const p = (room: string, name: string, adults: number, children: number, fromDays: number, toDays: number, state: Presence['state']): Presence => ({
      reservationId: `demo-res-${room}`,
      room,
      adults,
      children,
      arrival: addDays(date, fromDays),
      departure: addDays(date, toDays),
      state,
      name,
    });
    const ago = (min: number) => new Date(this.now() - min * 60000).toISOString();
    return {
      date,
      stays: [
        p('101', 'Bianchi L.', 2, 0, -2, 3, 'in_casa'),
        p('102', 'Huber K.', 2, 0, -2, 0, 'parte'),
        p('105', 'Meyer S.', 2, 0, -2, 2, 'in_casa'),
        p('107', 'Andersen T.', 2, 1, -2, 4, 'in_casa'),
        p('108', 'Novak P.', 2, 0, -3, 0, 'partito'),
        p('119', 'Clarke E.', 2, 0, -2, 1, 'in_casa'),
        p('121', 'Rossi G.', 2, 0, -2, 5, 'in_casa'),
        p('122', 'Weber F.', 2, 0, 0, 3, 'arriva'),
      ],
      dataAsOf: ago(14),
      generatedAt: ago(9),
      loadedAt: new Date(this.now()).toISOString(),
    };
  }
}

/** Quadro per camera: la prenotazione che dorme stanotte (o arriva) e quella che parte oggi. */
export interface RoomPresence {
  room: string;
  /** Prenotazione che occupa la camera stanotte (in casa o in arrivo). */
  current: Presence | null;
  /** Prenotazione che lascia la camera oggi. */
  leaving: Presence | null;
}

export function roomPresences(rooms: readonly string[], snap: PresenceSnapshot | null): RoomPresence[] {
  const all = new Set<string>(rooms);
  snap?.stays.forEach((s) => all.add(s.room));
  return [...all]
    .sort((a, b) => a.localeCompare(b, 'it', { numeric: true }))
    .map((room) => {
      const stays = snap?.stays.filter((s) => s.room === room) ?? [];
      return {
        room,
        current: stays.find((s) => s.departure > (snap?.date ?? '')) ?? null,
        leaving: stays.find((s) => s.departure === snap?.date) ?? null,
      };
    });
}

/**
 * Quale prenotazione abilita la camera oggi: chi parte e non ha ancora lasciato la camera resta attivo
 * finché il nuovo ospite non fa il check-in (può ancora sciare l'ultimo giorno); poi tocca al nuovo.
 * Gli ID di Slope si passano invariati.
 */
export function roomsToSync(rooms: RoomPresence[]): RoomSyncItem[] {
  const items: RoomSyncItem[] = [];
  for (const rp of rooms) {
    const c = rp.current;
    const l = rp.leaving;
    const pick = l && l.state !== 'partito' && (!c || c.state !== 'in_casa') ? l : c ?? l;
    if (!pick) continue;
    items.push({ room: pick.room, reservationId: pick.reservationId, persons: Math.max(1, pick.adults + pick.children), validUntil: pick.departure });
  }
  return items;
}
