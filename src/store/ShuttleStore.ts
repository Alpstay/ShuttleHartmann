import type {
  BusySlot,
  ChargeDecision,
  DriverMessageKind,
  GuestSession,
  IsoDate,
  IsoTimestamp,
  Ride,
  RideEvent,
  RideInput,
  RoomSyncItem,
  ShuttleSettings,
  ShuttleStay,
  Unsubscribe,
} from '../domain/types';

export type StaffRole = 'reception' | 'autista';

export interface StaffUser {
  /** Identificativo del dispositivo collegato (utente anonimo Supabase in produzione). */
  id: string;
  role: StaffRole;
}

/**
 * Accesso dello staff con PIN: il PIN decide il ruolo (reception o autista).
 * La sessione resta sul dispositivo finché non si blocca, si cambia il PIN o la reception lo scollega.
 */
export interface StaffAuth {
  current(): Promise<StaffUser | null>;
  signInWithPin(pin: string): Promise<StaffUser>;
  signOut(): Promise<void>;
}

export interface StaffDevices {
  role: StaffRole;
  count: number;
  lastLoginAt: IsoTimestamp | null;
}

/** Operazioni dello staff. Ogni scrittura passa per funzioni lato server che applicano le regole. */
export interface StaffApi {
  getSettings(): Promise<ShuttleSettings>;
  saveSettings(settings: ShuttleSettings): Promise<ShuttleSettings>;

  /** Solo reception: cambia il PIN di un ruolo e scollega gli altri dispositivi di quel ruolo. */
  setPin(role: StaffRole, pin: string): Promise<void>;
  devices(): Promise<StaffDevices[]>;
  /** Solo reception: scollega tutti i dispositivi del ruolo tranne quello in uso. Restituisce quanti. */
  disconnect(role: StaffRole): Promise<number>;

  /** Corse di una data, aggiornate in tempo reale. Il callback riceve sempre l'elenco completo. */
  watchRides(date: IsoDate, onChange: (rides: Ride[]) => void, onError?: (e: Error) => void): Unsubscribe;
  rideEvents(rideId: string): Promise<RideEvent[]>;

  watchStays(onChange: (stays: ShuttleStay[]) => void, onError?: (e: Error) => void): Unsubscribe;
  /**
   * Allinea le camere attive con le presenze di oggi. `complete` = elenco completo e aggiornato:
   * le camere abilitate dalle presenze che non compaiono più (partenza anticipata) vengono chiuse.
   */
  syncRooms(items: RoomSyncItem[], complete: boolean): Promise<void>;
  /** Abilita a mano una camera (presenza non disponibile). */
  enableRoom(input: { room: string; persons: number | null; validUntil: IsoDate }): Promise<ShuttleStay>;
  revokeStay(stayId: string): Promise<void>;

  createRide(input: RideInput & { room: string; stayId: string | null; reservationId: string | null }): Promise<Ride>;
  cancelRide(rideId: string): Promise<Ride>;
  setCharge(rideId: string, decision: ChargeDecision): Promise<Ride>;

  driverMessage(rideId: string, kind: DriverMessageKind): Promise<Ride>;
  driverDone(rideId: string): Promise<Ride>;
  driverNoShow(rideId: string): Promise<Ride>;
}

/** Operazioni dell'ospite: si riconosce con il numero di camera e riceve un token di sessione. */
export interface GuestApi {
  login(room: string): Promise<GuestSession>;
  settings(token: string): Promise<ShuttleSettings>;
  rides(token: string): Promise<Ride[]>;
  /** Viaggi già prenotati in una data (orario, punto di ritiro, persone), senza dati delle camere. */
  busy(token: string, date: IsoDate): Promise<BusySlot[]>;
  createRide(token: string, input: RideInput): Promise<Ride>;
  cancelRide(token: string, rideId: string): Promise<Ride>;
}

export interface ShuttleBackend {
  auth: StaffAuth;
  staff: StaffApi;
  guest: GuestApi;
  /** Ogni quanto l'area ospite ricarica lo stato (ms). */
  guestPollMs: number;
}
