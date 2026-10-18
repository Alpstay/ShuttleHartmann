/**
 * Modello dati del servizio shuttle Chalet Hotel Hartmann.
 *
 * Regola fondamentale: gli identificativi che arrivano da Slope (reservation_id, room_name,
 * property_id) vengono copiati così come sono e non vengono mai modificati né rigenerati.
 * Gli id generati da questa app (corse, soggiorni-PIN) sono separati e hanno prefissi propri.
 */

/** Data di servizio in formato ISO `YYYY-MM-DD`, sempre nel fuso Europe/Rome. */
export type IsoDate = string;
/** Orario `HH:MM` (24h), fuso Europe/Rome. */
export type HhMm = string;
/** Timestamp ISO 8601 completo (UTC). */
export type IsoTimestamp = string;

/** andata = hotel → impianto · ritorno = impianto → hotel */
export type Direction = 'andata' | 'ritorno';

/**
 * Ciclo di vita della corsa:
 *  richiesta → confermata (l'autista ha letto e mandato un messaggio)
 *            → sul_posto (l'autista ha segnalato «Sono arrivato», parte l'attesa)
 *            → completata («Fatto!») | no_show (dopo l'attesa massima)
 *  richiesta | confermata | sul_posto → annullata
 */
export type RideStatus =
  | 'richiesta'
  | 'confermata'
  | 'sul_posto'
  | 'completata'
  | 'no_show'
  | 'annullata';

/** I tre messaggi che l'autista può inviare all'ospite. Il primo vale come conferma di lettura. */
export type DriverMessageKind = 'arrivato' | 'sette_minuti' | 'traffico';

export type Actor = 'ospite' | 'reception' | 'autista' | 'sistema';

/** Decisione della reception su una corsa non presentata. */
export type ChargeDecision = 'da_valutare' | 'addebitare' | 'non_addebitare';

export interface Destination {
  id: string;
  /** Nome mostrato a ospite e autista, es. «Seceda». */
  name: string;
  /** Località della stazione a valle, es. «Ortisei». */
  place: string;
  active: boolean;
}

/**
 * Chi può entrare nell'area ospite con il solo numero di camera:
 *  - camere_occupate: solo le camere con un soggiorno attivo (presenze di La Scatola o abilitate a mano)
 *  - tutte_le_camere: qualsiasi camera dell'elenco (da usare se le presenze non arrivano)
 */
export type GuestAccessMode = 'camere_occupate' | 'tutte_le_camere';

export interface ShuttleSettings {
  /** Camere della struttura (room_name di Slope, invariati). */
  rooms: string[];
  guestAccess: GuestAccessMode;
  destinations: Destination[];
  /** Posti a sedere del mezzo, usati per segnalare le fasce sovraccariche. */
  seats: number;
  /** Attesa massima al punto di ritiro prima di poter segnalare l'ospite come non presentato. */
  waitMinutes: number;
  /** Prima e ultima corsa prenotabile. */
  serviceStart: HhMm;
  serviceEnd: HhMm;
  /** Anticipo minimo con cui l'ospite può prenotare per oggi. */
  minLeadMinutes: number;
  /** Numero della reception mostrato all'ospite per modifiche dopo la conferma (facoltativo). */
  receptionPhone: string;
  /**
   * Minuti minimi tra due viaggi diversi del mezzo (altro punto di ritiro o altro orario).
   * Lo stesso viaggio (stesso orario e stesso punto di ritiro) accoglie più camere fino ai posti. 0 = nessun controllo.
   */
  pickupGapMinutes: number;
  updatedAt: IsoTimestamp;
}

/** Viaggio già prenotato in una data, senza dati delle camere: serve all'ospite per scegliere un orario libero. */
export interface BusySlot {
  time: HhMm;
  /** Punto di ritiro: "hotel" oppure l'id dell'impianto. */
  pickup: string;
  persons: number;
}

/** Origine dell'abilitazione di una camera allo shuttle. */
export type StaySource = 'presenze' | 'manuale';

/**
 * Soggiorno abilitato allo shuttle: la camera è attiva per l'ospite (che entra con il numero di camera)
 * dall'arrivo fino alle 23:59 del giorno di partenza. Si crea da solo dalle presenze di La Scatola
 * oppure a mano dalla reception; un nuovo ospite nella stessa camera chiude il soggiorno precedente.
 */
export interface ShuttleStay {
  /** Id generato da questa app. */
  id: string;
  /** room_name di Slope, invariato. */
  room: string;
  /** reservation_id di Slope, invariato. Null se abilitata a mano senza presenza. */
  reservationId: string | null;
  source: StaySource;
  /** Persone in camera (adulti + bambini), per precompilare le richieste. */
  persons: number | null;
  validFrom: IsoDate;
  /** Data di partenza: l'accesso vale fino alle 23:59 di questo giorno. */
  validUntil: IsoDate;
  createdAt: IsoTimestamp;
  revokedAt: IsoTimestamp | null;
}

/** Camera da allineare con le presenze di La Scatola (inviata dalla reception al server). */
export interface RoomSyncItem {
  room: string;
  reservationId: string;
  persons: number;
  validUntil: IsoDate;
}

export interface Ride {
  /** Id generato da questa app. */
  id: string;
  stayId: string | null;
  /** room_name di Slope, invariato. */
  room: string;
  /** reservation_id di Slope, invariato. */
  reservationId: string | null;
  serviceDate: IsoDate;
  /** Orario desiderato dall'ospite. */
  time: HhMm;
  direction: Direction;
  destinationId: string;
  /** Copia del nome al momento della richiesta, così lo storico resta leggibile anche se la lista cambia. */
  destinationName: string;
  persons: number;
  note: string | null;
  createdBy: Actor;
  status: RideStatus;
  /** Prima risposta dell'autista = conferma di lettura. */
  readAt: IsoTimestamp | null;
  lastMessage: DriverMessageKind | null;
  lastMessageAt: IsoTimestamp | null;
  /** Momento in cui l'autista ha segnalato «Sono arrivato»: da qui parte l'attesa massima. */
  arrivedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  noShowAt: IsoTimestamp | null;
  cancelledAt: IsoTimestamp | null;
  cancelledBy: Actor | null;
  chargeDecision: ChargeDecision | null;
  conditionsAcceptedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type RideEventKind =
  | 'creata'
  | 'messaggio'
  | 'completata'
  | 'no_show'
  | 'annullata'
  | 'addebito';

/** Registro immutabile di ogni passaggio: serve in caso di contestazione di un addebito. */
export interface RideEvent {
  id: string;
  rideId: string;
  kind: RideEventKind;
  actor: Actor;
  message: DriverMessageKind | null;
  chargeDecision: ChargeDecision | null;
  at: IsoTimestamp;
}

/** Dati inseriti dall'ospite (o dalla reception per conto dell'ospite). */
export interface RideInput {
  serviceDate: IsoDate;
  time: HhMm;
  direction: Direction;
  destinationId: string;
  persons: number;
  note: string | null;
  conditionsAccepted: boolean;
}

/** Sessione dell'ospite dopo l'accesso con camera + PIN. */
export interface GuestSession {
  token: string;
  stayId: string;
  room: string;
  persons: number | null;
  validUntil: IsoDate;
}

/** Situazione di una prenotazione in un dato giorno, calcolata dalle date e dai check-in/out di Slope. */
export type PresenceState = 'in_casa' | 'arriva' | 'parte' | 'partito';

/**
 * Presenza letta da La Scatola (in casa + partenze, solo Chalet Hotel Hartmann) tramite il file
 * cifrato presenze.json. Il nome serve solo alla reception; autista e ospite vedono la camera.
 */
export interface Presence {
  /** reservation_id di Slope, invariato. */
  reservationId: string;
  /** room_name di Slope, invariato. */
  room: string;
  adults: number;
  children: number;
  arrival: IsoDate;
  departure: IsoDate;
  state: PresenceState;
  /** «Cognome N.» dell'ospite registrato principale o dell'intestatario. */
  name: string | null;
}

export interface PresenceSnapshot {
  date: IsoDate;
  stays: Presence[];
  /** Ultimo aggiornamento di La Scatola dalle prenotazioni Hartmann. */
  dataAsOf: IsoTimestamp | null;
  /** Quando l'attività pianificata ha generato il file. */
  generatedAt: IsoTimestamp | null;
  loadedAt: IsoTimestamp;
}

export type Unsubscribe = () => void;

export class ShuttleError extends Error {
  constructor(
    public readonly code:
      | 'pin_errato'
      | 'camera_non_attiva'
      | 'troppi_tentativi'
      | 'sessione_scaduta'
      | 'non_valida'
      | 'stato_non_valido'
      | 'attesa_in_corso'
      | 'non_autorizzato'
      | 'rete',
    message: string,
  ) {
    super(message);
    this.name = 'ShuttleError';
  }
}
