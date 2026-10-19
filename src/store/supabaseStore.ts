/**
 * Backend di produzione su Supabase. Lo staff legge le tabelle (RLS) e scrive solo tramite
 * funzioni RPC; l'ospite usa esclusivamente le funzioni shuttle_guest_* con il token di sessione.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS, compareRides } from '../domain/rules';
import type {
  Actor,
  ChargeDecision,
  Destination,
  DriverMessageKind,
  GuestSession,
  Ride,
  RideEvent,
  RideInput,
  RideStatus,
  GuestAccessMode,
  ShuttleSettings,
  ShuttleStay,
  StaySource,
} from '../domain/types';
import { ShuttleError } from '../domain/types';
import type { GuestApi, PinFailuresInfo, ShuttleBackend, StaffApi, StaffAuth, StaffDevices, StaffRole, StaffUser } from './ShuttleStore';

// ---------------------------------------------------------------------------
// Righe del database (snake_case) e conversione verso il modello dell'app
// ---------------------------------------------------------------------------

interface RideRow {
  id: string;
  stay_id: string | null;
  room: string;
  reservation_id?: string | null;
  service_date: string;
  ride_time: string;
  direction: 'andata' | 'ritorno';
  destination_id: string;
  destination_name: string;
  persons: number;
  note: string | null;
  created_by: Actor;
  status: RideStatus;
  read_at: string | null;
  last_message: DriverMessageKind | null;
  last_message_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  no_show_at: string | null;
  cancelled_at: string | null;
  cancelled_by: Actor | null;
  charge_decision: ChargeDecision | null;
  conditions_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StayRow {
  id: string;
  room: string;
  reservation_id: string | null;
  source: StaySource;
  persons: number | null;
  valid_from: string;
  valid_until: string;
  created_at: string;
  revoked_at: string | null;
}

interface SettingsRow {
  rooms: string[];
  guest_access: GuestAccessMode;
  destinations: Destination[];
  seats: number;
  wait_minutes: number;
  service_start: string;
  service_end: string;
  min_lead_minutes: number;
  reception_phone: string;
  pickup_gap_minutes?: number;
  pause_start?: string | null;
  pause_end?: string | null;
  taxi_name?: string;
  taxi_phone?: string;
  updated_at: string;
}

interface EventRow {
  id: number;
  ride_id: string;
  kind: RideEvent['kind'];
  actor: Actor;
  message: DriverMessageKind | null;
  charge_decision: ChargeDecision | null;
  at: string;
}

const hhmm = (t: string): string => t.slice(0, 5);

export function rideFromRow(r: RideRow): Ride {
  return {
    id: r.id,
    stayId: r.stay_id,
    room: r.room,
    reservationId: r.reservation_id ?? null,
    serviceDate: r.service_date,
    time: hhmm(r.ride_time),
    direction: r.direction,
    destinationId: r.destination_id,
    destinationName: r.destination_name,
    persons: r.persons,
    note: r.note,
    createdBy: r.created_by,
    status: r.status,
    readAt: r.read_at,
    lastMessage: r.last_message,
    lastMessageAt: r.last_message_at,
    arrivedAt: r.arrived_at,
    completedAt: r.completed_at,
    noShowAt: r.no_show_at,
    cancelledAt: r.cancelled_at,
    cancelledBy: r.cancelled_by,
    chargeDecision: r.charge_decision,
    conditionsAcceptedAt: r.conditions_accepted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function stayFromRow(s: StayRow): ShuttleStay {
  return {
    id: s.id,
    room: s.room,
    reservationId: s.reservation_id,
    source: s.source,
    persons: s.persons,
    validFrom: s.valid_from,
    validUntil: s.valid_until,
    createdAt: s.created_at,
    revokedAt: s.revoked_at,
  };
}

function settingsFromRow(s: SettingsRow): ShuttleSettings {
  return {
    rooms: s.rooms,
    guestAccess: s.guest_access,
    destinations: s.destinations,
    seats: s.seats,
    waitMinutes: s.wait_minutes,
    serviceStart: hhmm(s.service_start),
    serviceEnd: hhmm(s.service_end),
    minLeadMinutes: s.min_lead_minutes,
    receptionPhone: s.reception_phone,
    pickupGapMinutes: s.pickup_gap_minutes ?? DEFAULT_SETTINGS.pickupGapMinutes,
    // Database non ancora aggiornato (colonne assenti): valori iniziali; colonna presente ma vuota: nessuna pausa.
    pauseStart: s.pause_start === undefined ? DEFAULT_SETTINGS.pauseStart : s.pause_start ? hhmm(s.pause_start) : '',
    pauseEnd: s.pause_end === undefined ? DEFAULT_SETTINGS.pauseEnd : s.pause_end ? hhmm(s.pause_end) : '',
    taxiName: s.taxi_name ?? DEFAULT_SETTINGS.taxiName,
    taxiPhone: s.taxi_phone ?? DEFAULT_SETTINGS.taxiPhone,
    updatedAt: s.updated_at,
  };
}

/** Nuovi accessi dello staff sospesi per troppi PIN errati in tutto (vedi shuttle_staff_login). */
export const STAFF_BLOCKED_MESSAGE =
  'Accesso staff sospeso per sicurezza: troppi PIN errati. Riprova più tardi oppure fatti sbloccare da un dispositivo della reception già collegato (Impostazioni → Accessi).';

/** Traduce gli errori sollevati dalle funzioni SQL (es. «non_valida:troppo_presto») in ShuttleError. */
function toShuttleError(e: { message?: string } | null | undefined): ShuttleError {
  const msg = e?.message ?? 'rete';
  const [code = '', detail = ''] = msg.split(':');
  switch (code) {
    case 'pin_errato':
    case 'camera_non_attiva':
    case 'troppi_tentativi':
    case 'accesso_bloccato':
    case 'sessione_scaduta':
    case 'stato_non_valido':
    case 'attesa_in_corso':
    case 'non_autorizzato':
      return new ShuttleError(code, detail || msg);
    case 'non_valida':
      return new ShuttleError('non_valida', detail);
    default:
      return new ShuttleError('rete', msg);
  }
}

/** Errore dell'accesso anonimo dello staff tradotto in una causa chiara (impostazione di Supabase, limite, rete). */
function anonymousSignInError(e: { message?: string; code?: string; status?: number }): ShuttleError {
  const text = `${e.code ?? ''} ${e.message ?? ''}`.toLowerCase();
  if (text.includes('signup')) {
    return new ShuttleError('non_autorizzato', 'Su Supabase le nuove iscrizioni sono chiuse: attiva «Allow new users to sign up» in Authentication → Sign In / Providers.');
  }
  if (text.includes('anonymous')) {
    return new ShuttleError('non_autorizzato', 'Su Supabase l’accesso anonimo è spento: attiva «Allow anonymous sign-ins» in Authentication → Sign In / Providers.');
  }
  if (e.status === 429 || text.includes('rate limit')) {
    return new ShuttleError('troppi_tentativi', 'Troppi accessi da questa rete: riprova tra qualche minuto.');
  }
  return new ShuttleError('rete', `Accesso non disponibile: controlla la connessione${e.message ? ` (${e.message})` : ''}.`);
}

async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw toShuttleError(error);
  return data as T;
}

// ---------------------------------------------------------------------------

export function createSupabaseBackend(url: string, anonKey: string): ShuttleBackend {
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'shuttle-hartmann-auth' },
  });

  /**
   * Lo staff entra con il PIN su una sessione anonima di Supabase Auth («Allow anonymous sign-ins»):
   * la sessione resta sul dispositivo e si riusa a ogni accesso, il PIN decide il ruolo sul server.
   */
  async function staffUser(): Promise<StaffUser | null> {
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: row, error } = await client.from('shuttle_staff').select('role').eq('user_id', user.id).maybeSingle();
    if (error) throw toShuttleError(error);
    if (!row) return null;
    return { id: user.id, role: (row as { role: StaffRole }).role };
  }

  const auth: StaffAuth = {
    current: staffUser,
    async signInWithPin(pin) {
      const { data } = await client.auth.getSession();
      if (!data.session) {
        const { error } = await client.auth.signInAnonymously();
        if (error) throw anonymousSignInError(error);
      }
      const res = await rpc<{ role?: StaffRole; error?: 'pin_errato' | 'troppi_tentativi' | 'accesso_bloccato' | 'non_autorizzato' }>(client, 'shuttle_staff_login', { p_pin: pin });
      if (res.error === 'troppi_tentativi') throw new ShuttleError('troppi_tentativi', 'Troppi tentativi: riprova tra 10 minuti.');
      if (res.error === 'accesso_bloccato') throw new ShuttleError('accesso_bloccato', STAFF_BLOCKED_MESSAGE);
      if (res.error || !res.role) throw new ShuttleError('pin_errato', 'PIN non corretto.');
      const user = await staffUser();
      if (!user) throw new ShuttleError('non_autorizzato', 'Accesso non riuscito: riprova.');
      return user;
    },
    async signOut() {
      // Si chiude solo il ruolo: la sessione anonima resta per il prossimo accesso con PIN.
      await rpc<null>(client, 'shuttle_staff_logout', {});
    },
  };

  /** Abbonamento realtime con ricarica completa a ogni modifica + controllo periodico di sicurezza. */
  function watch<T>(table: string, filter: string | undefined, load: () => Promise<T>, onChange: (v: T) => void, onError?: (e: Error) => void) {
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (!alive || pending) return;
      pending = true;
      try {
        const v = await load();
        if (alive) onChange(v);
      } catch (e) {
        if (alive) onError?.(e as Error);
      } finally {
        pending = false;
      }
    };
    const channel: RealtimeChannel = client
      .channel(`${table}-${filter ?? 'all'}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => void refresh())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refresh();
      });
    const timer = window.setInterval(refresh, 30000);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    void refresh();
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      void client.removeChannel(channel);
    };
  }

  const staff: StaffApi = {
    async getSettings() {
      const { data, error } = await client.from('shuttle_settings').select('*').eq('id', 1).single();
      if (error) throw toShuttleError(error);
      return settingsFromRow(data as SettingsRow);
    },
    async saveSettings(settings) {
      const row = await rpc<SettingsRow>(client, 'shuttle_save_settings', {
        p: {
          rooms: settings.rooms,
          guestAccess: settings.guestAccess,
          destinations: settings.destinations,
          seats: settings.seats,
          waitMinutes: settings.waitMinutes,
          serviceStart: settings.serviceStart,
          serviceEnd: settings.serviceEnd,
          minLeadMinutes: settings.minLeadMinutes,
          receptionPhone: settings.receptionPhone,
          pickupGapMinutes: settings.pickupGapMinutes,
          pauseStart: settings.pauseStart,
          pauseEnd: settings.pauseEnd,
          taxiName: settings.taxiName,
          taxiPhone: settings.taxiPhone,
        },
      });
      return settingsFromRow(row);
    },
    watchRides(date, onChange, onError) {
      return watch(
        'shuttle_rides',
        `service_date=eq.${date}`,
        async () => {
          const { data, error } = await client.from('shuttle_rides').select('*').eq('service_date', date);
          if (error) throw toShuttleError(error);
          return (data as RideRow[]).map(rideFromRow).sort(compareRides);
        },
        onChange,
        onError,
      );
    },
    async rideEvents(rideId) {
      const { data, error } = await client.from('shuttle_ride_events').select('*').eq('ride_id', rideId).order('at');
      if (error) throw toShuttleError(error);
      return (data as EventRow[]).map((e) => ({
        id: String(e.id),
        rideId: e.ride_id,
        kind: e.kind,
        actor: e.actor,
        message: e.message,
        chargeDecision: e.charge_decision,
        at: e.at,
      }));
    },
    watchStays(onChange, onError) {
      return watch(
        'shuttle_stays',
        undefined,
        async () => {
          const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
          const { data, error } = await client.from('shuttle_stays').select('*').gte('valid_until', since);
          if (error) throw toShuttleError(error);
          return (data as StayRow[]).map(stayFromRow);
        },
        onChange,
        onError,
      );
    },
    async setPin(role, pin) {
      await rpc<null>(client, 'shuttle_set_pin', { p_role: role, p_pin: pin });
    },
    devices: async () => rpc<StaffDevices[]>(client, 'shuttle_staff_devices', {}),
    disconnect: async (role) => rpc<number>(client, 'shuttle_disconnect', { p_role: role }),
    pinFailures: async () => rpc<PinFailuresInfo>(client, 'shuttle_pin_failures_info', {}),
    clearPinFailures: async () => rpc<number>(client, 'shuttle_clear_pin_failures', {}),
    async syncRooms(items, complete) {
      await rpc<null>(client, 'shuttle_sync_rooms', { p_items: items, p_complete: complete });
    },
    async enableRoom({ room, persons, validUntil }) {
      const row = await rpc<StayRow>(client, 'shuttle_enable_room', { p_room: room, p_persons: persons, p_valid_until: validUntil });
      return stayFromRow(row);
    },
    async revokeStay(stayId) {
      await rpc<null>(client, 'shuttle_revoke_stay', { p_stay: stayId });
    },
    async createRide(input) {
      const row = await rpc<RideRow>(client, 'shuttle_reception_create_ride', {
        p_room: input.room,
        p_stay_id: input.stayId,
        p_reservation_id: input.reservationId,
        p_date: input.serviceDate,
        p_time: input.time,
        p_direction: input.direction,
        p_destination: input.destinationId,
        p_persons: input.persons,
        p_note: input.note,
      });
      return rideFromRow(row);
    },
    cancelRide: async (rideId) => rideFromRow(await rpc<RideRow>(client, 'shuttle_cancel_ride', { p_ride: rideId })),
    setCharge: async (rideId, decision) =>
      rideFromRow(await rpc<RideRow>(client, 'shuttle_set_charge', { p_ride: rideId, p_decision: decision })),
    driverMessage: async (rideId, kind) =>
      rideFromRow(await rpc<RideRow>(client, 'shuttle_driver_message', { p_ride: rideId, p_kind: kind })),
    driverDone: async (rideId) => rideFromRow(await rpc<RideRow>(client, 'shuttle_driver_done', { p_ride: rideId })),
    driverNoShow: async (rideId) => rideFromRow(await rpc<RideRow>(client, 'shuttle_driver_no_show', { p_ride: rideId })),
  };

  const guest: GuestApi = {
    async login(room) {
      const res = await rpc<{ error?: 'camera_non_attiva' | 'troppi_tentativi'; token: string; stay_id: string; room: string; persons: number | null; valid_until: string }>(
        client,
        'shuttle_guest_login',
        { p_room: room },
      );
      if (res.error) throw new ShuttleError(res.error, res.error);
      return { token: res.token, stayId: res.stay_id, room: res.room, persons: res.persons, validUntil: res.valid_until } satisfies GuestSession;
    },
    settings: async (token) => {
      const s = await rpc<Partial<ShuttleSettings>>(client, 'shuttle_guest_settings', { p_token: token });
      return {
        ...DEFAULT_SETTINGS,
        ...s,
        pickupGapMinutes: s.pickupGapMinutes ?? DEFAULT_SETTINGS.pickupGapMinutes,
        pauseStart: s.pauseStart ?? DEFAULT_SETTINGS.pauseStart,
        pauseEnd: s.pauseEnd ?? DEFAULT_SETTINGS.pauseEnd,
        taxiName: s.taxiName ?? DEFAULT_SETTINGS.taxiName,
        taxiPhone: s.taxiPhone ?? DEFAULT_SETTINGS.taxiPhone,
      } as ShuttleSettings;
    },
    rides: async (token) => (await rpc<RideRow[]>(client, 'shuttle_guest_rides', { p_token: token })).map(rideFromRow),
    async busy(token, date) {
      try {
        const rows = await rpc<{ time: string; pickup: string; persons: number }[] | null>(client, 'shuttle_guest_busy', { p_token: token, p_date: date });
        return (rows ?? []).map((b) => ({ time: hhmm(b.time), pickup: b.pickup, persons: b.persons }));
      } catch (e) {
        if ((e as ShuttleError).code === 'sessione_scaduta') throw e;
        return []; // database non ancora aggiornato: il controllo resta alla reception
      }
    },
    async createRide(token, input: RideInput) {
      const row = await rpc<RideRow>(client, 'shuttle_guest_create_ride', {
        p_token: token,
        p_date: input.serviceDate,
        p_time: input.time,
        p_direction: input.direction,
        p_destination: input.destinationId,
        p_persons: input.persons,
        p_note: input.note,
        p_conditions: input.conditionsAccepted,
      });
      return rideFromRow(row);
    },
    cancelRide: async (token, rideId) =>
      rideFromRow(await rpc<RideRow>(client, 'shuttle_guest_cancel_ride', { p_token: token, p_ride: rideId })),
  };

  return { auth, staff, guest, guestPollMs: 10000 };
}
