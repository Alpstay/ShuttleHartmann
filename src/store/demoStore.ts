/**
 * Backend dimostrativo in memoria: applica le stesse regole del database di produzione
 * (src/domain/rules.ts ↔ supabase/schema.sql). I dati sono di esempio e restano nel browser.
 * Ogni area del prototipo è un «dispositivo» con la propria sessione PIN.
 */
import {
  DEFAULT_SETTINGS,
  applyCancel,
  applyCharge,
  applyDone,
  applyDriverMessage,
  applyNoShow,
  busySlots,
  checkTrip,
  compareRides,
  isStayValid,
  normalizeRoom,
  staffPinProblem,
  validateRideInput,
} from '../domain/rules';
import { addDays, fromMinutes, romeDate, romeMinutesOfDay, systemClock, type Clock } from '../domain/time';
import type {
  Actor,
  ChargeDecision,
  DriverMessageKind,
  GuestSession,
  Ride,
  RideEvent,
  RideEventKind,
  RideInput,
  ShuttleSettings,
  ShuttleStay,
  Unsubscribe,
} from '../domain/types';
import { ShuttleError } from '../domain/types';
import type { GuestApi, ShuttleBackend, StaffApi, StaffAuth, StaffDevices, StaffRole, StaffUser } from './ShuttleStore';

interface DemoState {
  version: 4;
  settings: ShuttleSettings;
  stays: ShuttleStay[];
  rides: Ride[];
  events: RideEvent[];
  /** token ospite → id soggiorno */
  sessions: Record<string, string>;
  pins: Record<StaffRole, string>;
  /** dispositivo → ruolo collegato */
  staffSessions: Record<string, { role: StaffRole; at: string }>;
}

const STORAGE_KEY = 'shuttle-hartmann-demo-v4';
const MAX_FAILED = 5;
const LOCK_MS = 10 * 60000;

function uid(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}_${rnd}`;
}

export interface DemoOptions {
  clock?: Clock;
  persist?: boolean;
  /** PIN iniziali di reception e autista (nel prototipo arrivano dal build, non dal codice). */
  pins?: Record<StaffRole, string>;
  /** Dispositivi già collegati all'avvio, per aprire il prototipo in stato di lavoro. */
  signedIn?: Record<string, StaffRole>;
  initial?: DemoState;
}

export interface DemoHub {
  /** Vista del backend per un dispositivo (ogni area del prototipo ne ha uno). */
  device(deviceId: string): ShuttleBackend;
  reset(): void;
  state(): DemoState;
}

export function createDemoBackend(opts: DemoOptions = {}): DemoHub {
  const clock = opts.clock ?? systemClock;
  const persist = opts.persist ?? false;
  const pins = opts.pins ?? { reception: '0000', autista: '1111' };
  const nowIso = () => new Date(clock.now()).toISOString();
  const fresh = () => seed(clock.now(), pins, opts.signedIn ?? {});

  let state: DemoState = opts.initial ?? (persist ? load() : null) ?? fresh();
  const listeners = new Set<() => void>();
  const guestFailures = new Map<string, number[]>();
  const pinFailures = new Map<string, number[]>();

  function load(): DemoState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.version !== 4 || !parsed.rides.some((r) => r.serviceDate >= romeDate(clock.now()))) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function commit(next: DemoState): void {
    state = next;
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* archiviazione non disponibile: si resta in memoria */
      }
    }
    listeners.forEach((l) => l());
  }

  const subscribe = (l: () => void): Unsubscribe => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  function recent(map: Map<string, number[]>, key: string): number[] {
    const now = clock.now();
    return (map.get(key) ?? []).filter((t) => now - t < LOCK_MS);
  }

  function event(rideId: string, kind: RideEventKind, actor: Actor, extra: Partial<RideEvent> = {}): RideEvent {
    return { id: uid('ev'), rideId, kind, actor, message: null, chargeDecision: null, at: nowIso(), ...extra };
  }

  function updateRide(rideId: string, fn: (r: Ride) => Ride, ev: (r: Ride) => RideEvent): Ride {
    const current = state.rides.find((r) => r.id === rideId);
    if (!current) throw new ShuttleError('non_valida', 'Corsa non trovata.');
    const next = fn(current);
    commit({ ...state, rides: state.rides.map((r) => (r.id === rideId ? next : r)), events: [...state.events, ev(next)] });
    return next;
  }

  function newRide(input: RideInput, base: { room: string; stayId: string | null; reservationId: string | null; createdBy: Actor }): Ride {
    const dest = state.settings.destinations.find((d) => d.id === input.destinationId);
    const at = nowIso();
    return {
      id: uid('ride'),
      stayId: base.stayId,
      room: base.room,
      reservationId: base.reservationId,
      serviceDate: input.serviceDate,
      time: input.time,
      direction: input.direction,
      destinationId: input.destinationId,
      destinationName: dest?.name ?? input.destinationId,
      persons: input.persons,
      note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
      createdBy: base.createdBy,
      status: 'richiesta',
      readAt: null,
      lastMessage: null,
      lastMessageAt: null,
      arrivedAt: null,
      completedAt: null,
      noShowAt: null,
      cancelledAt: null,
      cancelledBy: null,
      chargeDecision: null,
      conditionsAcceptedAt: input.conditionsAccepted && base.createdBy === 'ospite' ? at : null,
      createdAt: at,
      updatedAt: at,
    };
  }

  const activeStay = (room: string) => state.stays.find((s) => s.room === room && !s.revokedAt);

  function sessionStay(token: string): ShuttleStay {
    const stayId = state.sessions[token];
    const stay = stayId ? state.stays.find((s) => s.id === stayId) : undefined;
    if (!stay || !isStayValid(stay, clock.now())) throw new ShuttleError('sessione_scaduta', 'Sessione scaduta: accedi di nuovo.');
    return stay;
  }

  const devices = new Map<string, ShuttleBackend>();
  function device(deviceId: string): ShuttleBackend {
    let b = devices.get(deviceId);
    if (!b) devices.set(deviceId, (b = makeDevice(deviceId)));
    return b;
  }

  function makeDevice(deviceId: string): ShuttleBackend {
    const role = (): StaffRole | null => state.staffSessions[deviceId]?.role ?? null;
    const need = (...roles: StaffRole[]): StaffRole => {
      const r = role();
      if (!r || !roles.includes(r)) throw new ShuttleError('non_autorizzato', 'Accesso non consentito: inserisci il PIN.');
      return r;
    };
    const actorOf = (r: StaffRole): Actor => (r === 'autista' ? 'autista' : 'reception');

    const auth: StaffAuth = {
      current: async () => {
        const r = role();
        return r ? ({ id: deviceId, role: r } satisfies StaffUser) : null;
      },
      signInWithPin: async (pin) => {
        const tries = recent(pinFailures, deviceId);
        if (tries.length >= MAX_FAILED) throw new ShuttleError('troppi_tentativi', 'Troppi tentativi: riprova tra 10 minuti.');
        const r = (Object.keys(state.pins) as StaffRole[]).find((k) => state.pins[k] === pin.trim());
        if (!r) {
          pinFailures.set(deviceId, [...tries, clock.now()]);
          throw new ShuttleError('pin_errato', 'PIN non corretto.');
        }
        pinFailures.delete(deviceId);
        commit({ ...state, staffSessions: { ...state.staffSessions, [deviceId]: { role: r, at: nowIso() } } });
        return { id: deviceId, role: r };
      },
      signOut: async () => {
        const { [deviceId]: _gone, ...rest } = state.staffSessions;
        void _gone;
        commit({ ...state, staffSessions: rest });
      },
    };

    const staff: StaffApi = {
      getSettings: async () => (need('reception', 'autista'), state.settings),
      saveSettings: async (settings) => {
        need('reception');
        const next = { ...settings, rooms: [...new Set(settings.rooms.map(normalizeRoom).filter(Boolean))], updatedAt: nowIso() };
        commit({ ...state, settings: next });
        return next;
      },
      setPin: async (r, pin) => {
        need('reception');
        const other: StaffRole = r === 'reception' ? 'autista' : 'reception';
        const problem = staffPinProblem(pin, state.pins[other]);
        if (problem) throw new ShuttleError('non_valida', problem);
        const sessions = Object.fromEntries(Object.entries(state.staffSessions).filter(([id, s]) => s.role !== r || id === deviceId));
        commit({ ...state, pins: { ...state.pins, [r]: pin }, staffSessions: sessions });
      },
      devices: async () => {
        need('reception');
        return (['reception', 'autista'] as StaffRole[]).map((r): StaffDevices => {
          const list = Object.values(state.staffSessions).filter((s) => s.role === r);
          return { role: r, count: list.length, lastLoginAt: list.map((s) => s.at).sort().at(-1) ?? null };
        });
      },
      disconnect: async (r) => {
        need('reception');
        const keep = Object.entries(state.staffSessions).filter(([id, s]) => s.role !== r || id === deviceId);
        const removed = Object.keys(state.staffSessions).length - keep.length;
        commit({ ...state, staffSessions: Object.fromEntries(keep) });
        return removed;
      },
      watchRides(date, onChange) {
        const emit = () => onChange(state.rides.filter((r) => r.serviceDate === date).sort(compareRides));
        emit();
        return subscribe(emit);
      },
      rideEvents: async (rideId) => state.events.filter((e) => e.rideId === rideId).sort((a, b) => a.at.localeCompare(b.at)),
      watchStays(onChange) {
        const emit = () => onChange([...state.stays]);
        emit();
        return subscribe(emit);
      },
      syncRooms: async (items, complete) => {
        need('reception');
        const today = romeDate(clock.now());
        const at = nowIso();
        let stays = [...state.stays];
        let changed = false;
        for (const it of items) {
          const active = stays.find((s) => s.room === it.room && !s.revokedAt);
          if (active && (active.reservationId === it.reservationId || active.reservationId === null)) {
            if (active.reservationId !== it.reservationId || active.persons !== it.persons || active.validUntil !== it.validUntil) {
              stays = stays.map((s) => (s.id === active.id ? { ...s, reservationId: it.reservationId, source: 'presenze', persons: it.persons, validUntil: it.validUntil } : s));
              changed = true;
            }
            continue;
          }
          if (active) stays = stays.map((s) => (s.id === active.id ? { ...s, revokedAt: at } : s));
          stays.push({ id: uid('stay'), room: it.room, reservationId: it.reservationId, source: 'presenze', persons: it.persons, validFrom: today, validUntil: it.validUntil, createdAt: at, revokedAt: null });
          changed = true;
        }
        if (complete) {
          const ids = new Set(items.map((i) => i.reservationId));
          stays = stays.map((s) => {
            if (!s.revokedAt && s.source === 'presenze' && s.reservationId && !ids.has(s.reservationId)) {
              changed = true;
              return { ...s, revokedAt: at };
            }
            return s;
          });
        }
        if (changed) commit({ ...state, stays });
      },
      enableRoom: async ({ room, persons, validUntil }) => {
        need('reception');
        const r = normalizeRoom(room);
        if (!state.settings.rooms.includes(r)) throw new ShuttleError('non_valida', 'Camera non presente nell’elenco.');
        const today = romeDate(clock.now());
        const until = validUntil < today ? today : validUntil;
        const active = activeStay(r);
        if (active && isStayValid(active, clock.now())) {
          const upd = { ...active, persons: persons ?? active.persons, validUntil: until };
          commit({ ...state, stays: state.stays.map((s) => (s.id === active.id ? upd : s)) });
          return upd;
        }
        const at = nowIso();
        const stay: ShuttleStay = { id: uid('stay'), room: r, reservationId: null, source: 'manuale', persons, validFrom: today, validUntil: until, createdAt: at, revokedAt: null };
        const stays = state.stays.map((s) => (s.room === r && !s.revokedAt ? { ...s, revokedAt: at } : s));
        commit({ ...state, stays: [...stays, stay] });
        return stay;
      },
      revokeStay: async (stayId) => {
        need('reception');
        const at = nowIso();
        commit({ ...state, stays: state.stays.map((s) => (s.id === stayId && !s.revokedAt ? { ...s, revokedAt: at } : s)) });
      },
      createRide: async (input) => {
        need('reception');
        const problems = validateRideInput(input, { settings: state.settings, nowMs: clock.now(), actor: 'reception' });
        if (problems.length) throw new ShuttleError('non_valida', problems.join(','));
        const ride = newRide(input, { room: input.room, stayId: input.stayId, reservationId: input.reservationId, createdBy: 'reception' });
        commit({ ...state, rides: [...state.rides, ride], events: [...state.events, event(ride.id, 'creata', 'reception')] });
        return ride;
      },
      cancelRide: async (rideId) => (need('reception'), updateRide(rideId, (r) => applyCancel(r, 'reception', nowIso()), (r) => event(r.id, 'annullata', 'reception'))),
      setCharge: async (rideId, decision: ChargeDecision) =>
        (need('reception'), updateRide(rideId, (r) => applyCharge(r, decision, nowIso()), (r) => event(r.id, 'addebito', 'reception', { chargeDecision: decision }))),
      driverMessage: async (rideId, kind: DriverMessageKind) => {
        const r = need('reception', 'autista');
        return updateRide(rideId, (x) => applyDriverMessage(x, kind, nowIso()), (x) => event(x.id, 'messaggio', actorOf(r), { message: kind }));
      },
      driverDone: async (rideId) => {
        const r = need('reception', 'autista');
        return updateRide(rideId, (x) => applyDone(x, nowIso()), (x) => event(x.id, 'completata', actorOf(r)));
      },
      driverNoShow: async (rideId) => {
        const r = need('reception', 'autista');
        return updateRide(rideId, (x) => applyNoShow(x, state.settings, clock.now()), (x) => event(x.id, 'no_show', actorOf(r)));
      },
    };

    return { auth, staff, guest, guestPollMs: 1500 };
  }

  const guest: GuestApi = {
    login: async (roomInput) => {
      const room = normalizeRoom(roomInput);
      const tries = recent(guestFailures, room);
      if (tries.length >= MAX_FAILED) throw new ShuttleError('troppi_tentativi', 'Troppi tentativi.');
      const now = clock.now();
      let stay = state.settings.rooms.includes(room) ? state.stays.find((s) => s.room === room && isStayValid(s, now)) : undefined;
      if (!stay && state.settings.rooms.includes(room) && state.settings.guestAccess === 'tutte_le_camere') {
        const today = romeDate(now);
        const at = nowIso();
        stay = { id: uid('stay'), room, reservationId: null, source: 'manuale', persons: null, validFrom: today, validUntil: addDays(today, 1), createdAt: at, revokedAt: null };
        const stays = state.stays.map((s) => (s.room === room && !s.revokedAt ? { ...s, revokedAt: at } : s));
        commit({ ...state, stays: [...stays, stay] });
      }
      if (!stay) {
        guestFailures.set(room, [...tries, now]);
        throw new ShuttleError('camera_non_attiva', 'Camera non attiva.');
      }
      guestFailures.delete(room);
      const token = uid('gst');
      commit({ ...state, sessions: { ...state.sessions, [token]: stay.id } });
      return { token, stayId: stay.id, room: stay.room, persons: stay.persons, validUntil: stay.validUntil } satisfies GuestSession;
    },
    settings: async (token) => (sessionStay(token), state.settings),
    busy: async (token, date) => (sessionStay(token), busySlots(state.rides, date)),
    rides: async (token) => {
      const stay = sessionStay(token);
      const today = romeDate(clock.now());
      return state.rides
        .filter((r) => r.stayId === stay.id && r.serviceDate >= today)
        .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || compareRides(a, b));
    },
    createRide: async (token, input) => {
      const stay = sessionStay(token);
      const problems = validateRideInput(input, { settings: state.settings, nowMs: clock.now(), actor: 'ospite', stay });
      if (problems.length) throw new ShuttleError('non_valida', problems.join(','));
      // Il mezzo è uno solo: niente viaggi sovrapposti né oltre i posti (come shuttle_trip_problem sul server).
      const trip = checkTrip(input, busySlots(state.rides, input.serviceDate), state.settings);
      if (trip) throw new ShuttleError('non_valida', trip);
      const ride = newRide(input, { room: stay.room, stayId: stay.id, reservationId: stay.reservationId, createdBy: 'ospite' });
      commit({ ...state, rides: [...state.rides, ride], events: [...state.events, event(ride.id, 'creata', 'ospite')] });
      return ride;
    },
    cancelRide: async (token, rideId) => {
      const stay = sessionStay(token);
      const ride = state.rides.find((r) => r.id === rideId);
      if (!ride || ride.stayId !== stay.id) throw new ShuttleError('non_autorizzato', 'Corsa non trovata.');
      return updateRide(rideId, (r) => applyCancel(r, 'ospite', nowIso()), (r) => event(r.id, 'annullata', 'ospite'));
    },
  };

  return {
    device,
    reset() {
      commit(fresh());
    },
    state: () => state,
  };
}

// ---------------------------------------------------------------------------
// Dati di esempio (inventati: nessun dato reale di ospiti)
// ---------------------------------------------------------------------------

export const DEMO_GUEST_ROOM = '105';

function seed(nowMs: number, pins: Record<StaffRole, string>, signedIn: Record<string, StaffRole>): DemoState {
  const today = romeDate(nowMs);
  const iso = (offsetMin: number) => new Date(nowMs + offsetMin * 60000).toISOString();
  const nowMin = romeMinutesOfDay(nowMs);
  // Orari ancorati all'ora attuale (dalle 10 alle 23), così la demo è viva a ogni ora: le corse «fra 10 minuti»
  // sono davvero fra 10 minuti e con «+5 min» scatta l'avviso di partenza dell'autista.
  const anchor = Math.min(Math.max(nowMin, 10 * 60), 23 * 60);
  const t = (delta: number) => fromMinutes(Math.round((anchor + delta) / 5) * 5);

  const stay = (room: string, persons: number, nights: number): ShuttleStay => ({
    id: `stay_demo_${room}`,
    room,
    reservationId: `demo-res-${room}`,
    source: 'presenze',
    persons,
    validFrom: addDays(today, -2),
    validUntil: addDays(today, nights),
    createdAt: iso(-2 * 24 * 60),
    revokedAt: null,
  });
  const stays = [stay('101', 2, 3), stay('102', 2, 0), stay('105', 2, 2), stay('107', 3, 4), stay('119', 2, 1), stay('121', 2, 5)];

  const base = (room: string, over: Partial<Ride>): Ride => ({
    id: `ride_demo_${room}_${over.direction}_${over.time}`,
    stayId: `stay_demo_${room}`,
    room,
    reservationId: `demo-res-${room}`,
    serviceDate: today,
    time: '09:00',
    direction: 'andata',
    destinationId: 'seceda',
    destinationName: 'Seceda',
    persons: 2,
    note: null,
    createdBy: 'ospite',
    status: 'richiesta',
    readAt: null,
    lastMessage: null,
    lastMessageAt: null,
    arrivedAt: null,
    completedAt: null,
    noShowAt: null,
    cancelledAt: null,
    cancelledBy: null,
    chargeDecision: null,
    conditionsAcceptedAt: iso(-600),
    createdAt: iso(-600),
    updatedAt: iso(-600),
    ...over,
  });

  const rides: Ride[] = [
    base('101', { direction: 'andata', time: t(-120), status: 'completata', readAt: iso(-135), lastMessage: 'arrivato', lastMessageAt: iso(-121), arrivedAt: iso(-121), completedAt: iso(-118) }),
    base('107', { direction: 'andata', time: t(-120), persons: 3, status: 'completata', readAt: iso(-134), lastMessage: 'arrivato', lastMessageAt: iso(-121), arrivedAt: iso(-121), completedAt: iso(-118), note: 'Sci e scarponi' }),
    base('119', { direction: 'andata', time: t(-90), destinationId: 'col-raiser', destinationName: 'Col Raiser (Gardena Ronda/Saslong)', status: 'completata', readAt: iso(-100), lastMessage: 'sette_minuti', lastMessageAt: iso(-100), arrivedAt: iso(-91), completedAt: iso(-89) }),
    base('121', { direction: 'ritorno', time: t(-45), destinationId: 'alpe-di-siusi', destinationName: 'Alpe di Siusi', status: 'no_show', readAt: iso(-60), lastMessage: 'arrivato', lastMessageAt: iso(-46), arrivedAt: iso(-46), noShowAt: iso(-40), chargeDecision: 'da_valutare' }),
    base('105', { direction: 'ritorno', time: t(10), status: 'confermata', readAt: iso(-3), lastMessage: 'sette_minuti', lastMessageAt: iso(-3) }),
    base('107', { direction: 'ritorno', time: t(10), persons: 3, status: 'confermata', readAt: iso(-3), lastMessage: 'sette_minuti', lastMessageAt: iso(-3) }),
    base('101', { direction: 'ritorno', time: t(40), status: 'richiesta', createdAt: iso(-8), updatedAt: iso(-8) }),
    // Stessa ora del ritorno da Seceda della 101: conflitto da mostrare a reception e autista.
    base('119', { direction: 'ritorno', time: t(40), destinationId: 'col-raiser', destinationName: 'Col Raiser (Gardena Ronda/Saslong)', status: 'richiesta', createdBy: 'reception', conditionsAcceptedAt: null, createdAt: iso(-15), updatedAt: iso(-15) }),
    base('105', { direction: 'andata', serviceDate: addDays(today, 1), time: '09:15', destinationId: 'alpe-di-siusi', destinationName: 'Alpe di Siusi', status: 'richiesta', createdAt: iso(-20), updatedAt: iso(-20) }),
  ];

  const events: RideEvent[] = rides.flatMap((r) => {
    const list: RideEvent[] = [{ id: `ev_${r.id}_c`, rideId: r.id, kind: 'creata', actor: r.createdBy, message: null, chargeDecision: null, at: r.createdAt }];
    if (r.readAt && r.lastMessage) list.push({ id: `ev_${r.id}_m`, rideId: r.id, kind: 'messaggio', actor: 'autista', message: r.lastMessage, chargeDecision: null, at: r.lastMessageAt ?? r.readAt });
    if (r.completedAt) list.push({ id: `ev_${r.id}_d`, rideId: r.id, kind: 'completata', actor: 'autista', message: null, chargeDecision: null, at: r.completedAt });
    if (r.noShowAt) list.push({ id: `ev_${r.id}_n`, rideId: r.id, kind: 'no_show', actor: 'autista', message: null, chargeDecision: null, at: r.noShowAt });
    return list;
  });

  return {
    version: 4,
    settings: { ...DEFAULT_SETTINGS, rooms: [...DEFAULT_SETTINGS.rooms], updatedAt: iso(-24 * 60) },
    stays,
    rides,
    events,
    sessions: {},
    pins: { ...pins },
    staffSessions: Object.fromEntries(Object.entries(signedIn).map(([id, role]) => [id, { role, at: iso(-180) }])),
  };
}
