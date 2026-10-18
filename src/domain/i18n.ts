import type { DriverMessageKind, RideStatus } from './types';
import type { RideInputProblem } from './rules';

export type Lang = 'it' | 'de' | 'en';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'it', label: 'IT' },
  { code: 'de', label: 'DE' },
  { code: 'en', label: 'EN' },
];

export interface GuestStrings {
  appTitle: string;
  hotel: string;
  loginIntro: string;
  room: string;
  login: string;
  loginError: string;
  tooManyAttempts: string;
  logout: string;
  roomLabel: (room: string) => string;
  newRide: string;
  toLift: string;
  toLiftHint: string;
  toHotel: string;
  toHotelHint: string;
  destination: string;
  pickupAt: string;
  persons: string;
  day: string;
  today: string;
  tomorrow: string;
  time: string;
  note: string;
  notePlaceholder: string;
  conditionsTitle: string;
  conditions: (minutes: number) => string;
  accept: string;
  send: string;
  sending: string;
  sent: string;
  myRides: string;
  noRides: string;
  cancel: string;
  cancelConfirm: string;
  keep: string;
  cancelled: string;
  afterConfirmCall: (phone: string) => string;
  afterConfirmReception: string;
  noSlots: string;
  waitUntil: (time: string) => string;
  status: Record<RideStatus, string>;
  driverMessage: Record<DriverMessageKind, string>;
  problems: Record<RideInputProblem, string>;
  from: string;
  to: string;
  hotelName: string;
  soundOn: string;
  validUntil: (date: string) => string;
  offline: string;
  // prenotazione a passi (telefono)
  whereTo: string;
  goLift: string;
  goLiftHint: string;
  goHotel: string;
  goHotelHint: string;
  whichLift: string;
  fromWhichLift: string;
  whenWho: string;
  next: string;
  back: string;
  close: string;
  summary: string;
  acceptAndBook: string;
  addNote: string;
  nextRide: string;
  otherRides: string;
  changeTime: string;
  soundOff: string;
  // intestazione (etichette brevi sotto le icone)
  soundShort: string;
  languageShort: string;
  // viaggi: il mezzo è uno solo
  busyTitle: string;
  busyHint: string;
  fullTitle: string;
  freeTimes: string;
  joinTrip: string;
  noFreeTimes: string;
  meetingPoint: string;
  openMap: string;
  // fuori orario: taxi
  outOfServiceTitle: string;
  serviceHours: (hours: string) => string;
  taxiHint: (name: string) => string;
  // pagina informazioni
  info: string;
  infoTitle: string;
  infoHours: string;
  infoHow: string;
  infoSteps: (waitMinutes: number) => string[];
  infoMeeting: string;
  infoSeats: (seats: number) => string;
  infoOutside: string;
  infoReception: string;
  /** Pulsante della pagina Info che chiama la reception dell'hotel. */
  callHotel: string;
  stepOf: (n: number, total: number) => string;
}

const it: GuestStrings = {
  appTitle: 'Shuttle impianti',
  hotel: 'Chalet Hotel Hartmann',
  loginIntro: 'Inserisci il numero della tua camera.',
  room: 'Camera',
  login: 'Accedi',
  loginError: 'Questa camera non è attiva per lo shuttle. Rivolgiti alla reception.',
  tooManyAttempts: 'Troppi tentativi. Riprova tra qualche minuto o chiedi alla reception.',
  logout: 'Esci',
  roomLabel: (r) => `Camera ${r}`,
  newRide: 'Prenota una corsa',
  toLift: 'Andata',
  toLiftHint: 'Hotel → impianto',
  toHotel: 'Ritorno',
  toHotelHint: 'Impianto → hotel',
  destination: 'Impianto di arrivo',
  pickupAt: 'Ritiro all’impianto',
  persons: 'Persone',
  day: 'Giorno',
  today: 'Oggi',
  tomorrow: 'Domani',
  time: 'Orario desiderato',
  note: 'Nota per l’autista',
  notePlaceholder: 'Facoltativa, es. sci e scarponi',
  conditionsTitle: 'Condizioni',
  conditions: (m) =>
    `Al punto di ritiro l’autista attende al massimo ${m} minuti. Trascorso questo tempo può ripartire e la corsa non utilizzata può esservi addebitata.`,
  accept: 'Ho letto e accetto',
  send: 'Invia richiesta',
  sending: 'Invio…',
  sent: 'Richiesta inviata. Riceverai qui la conferma dell’autista.',
  myRides: 'Le tue corse',
  noRides: 'Nessuna corsa prenotata.',
  cancel: 'Cancella corsa',
  cancelConfirm: 'Cancellare questa corsa? L’autista e la reception vengono avvisati.',
  keep: 'No, mantieni',
  cancelled: 'Corsa cancellata: autista e reception sono stati avvisati.',
  afterConfirmCall: (p) => `L’autista è già arrivato. Per modifiche chiama la reception: ${p}`,
  afterConfirmReception: 'L’autista è già arrivato. Per modifiche rivolgiti alla reception.',
  noSlots: 'Per oggi non ci sono più orari prenotabili. Scegli domani.',
  waitUntil: (t) => `L’autista vi attende fino alle ${t}.`,
  status: {
    richiesta: 'Inviata, in attesa dell’autista',
    confermata: 'Confermata dall’autista',
    sul_posto: 'L’autista è sul posto',
    completata: 'Completata',
    no_show: 'Non presentati, l’autista è ripartito',
    annullata: 'Cancellata',
  },
  driverMessage: {
    arrivato: 'L’autista è arrivato.',
    sette_minuti: 'L’autista arriva fra 7 minuti. Vi preghiamo di pazientare un momento.',
    traffico: 'C’è traffico, l’autista sta arrivando.',
  },
  problems: {
    data_non_valida: 'Data non valida.',
    data_fuori_soggiorno: 'La data è oltre la fine del soggiorno.',
    data_troppo_lontana: 'Puoi prenotare solo per oggi o domani.',
    orario_non_valido: 'Orario non valido.',
    fuori_orario_servizio: 'L’orario è fuori dal servizio.',
    troppo_presto: 'Orario troppo vicino: scegline uno più avanti.',
    persone_non_valide: 'Numero di persone non valido.',
    destinazione_non_valida: 'Scegli un impianto.',
    condizioni_non_accettate: 'Accetta le condizioni per inviare.',
    orario_occupato: 'A quest’ora la navetta è già impegnata: scegli un altro orario.',
    posti_esauriti: 'La navetta di quest’ora è già piena: scegli un altro orario.',
  },
  from: 'Da',
  to: 'A',
  hotelName: 'Hotel Hartmann',
  soundOn: 'Avvisami con un suono',
  validUntil: (d) => `Valido fino al ${d}`,
  offline: 'Connessione assente: lo stato verrà aggiornato appena torna la rete.',
  whereTo: 'Dove vuoi andare?',
  goLift: 'Agli impianti',
  goLiftHint: 'Dall’hotel all’impianto',
  goHotel: 'In hotel',
  goHotelHint: 'Dall’impianto all’hotel',
  whichLift: 'Quale impianto?',
  fromWhichLift: 'Da quale impianto?',
  whenWho: 'Quando e quante persone?',
  next: 'Avanti',
  back: 'Indietro',
  close: 'Chiudi',
  summary: 'Controlla e conferma',
  acceptAndBook: 'Accetto e prenoto',
  addNote: 'Aggiungi una nota per l’autista',
  nextRide: 'La tua prossima corsa',
  otherRides: 'Altre corse',
  changeTime: 'Cambia orario',
  soundOff: 'Suono spento',
  soundShort: 'Avvisi',
  languageShort: 'Lingua',
  busyTitle: 'A quest’ora la navetta è già impegnata',
  busyHint: 'La navetta è una sola: scegli uno di questi orari.',
  fullTitle: 'La navetta di quest’ora è già piena',
  freeTimes: 'Orari disponibili',
  joinTrip: 'con altri ospiti',
  noFreeTimes: 'Nessun orario libero in questo giorno: chiama la reception.',
  meetingPoint: 'Punto d’incontro',
  openMap: 'Apri la mappa',
  outOfServiceTitle: 'A quest’ora la navetta non è in servizio',
  serviceHours: (h) => `Orari della navetta: ${h}.`,
  taxiHint: (n) => `Fuori orario puoi chiamare ${n}:`,
  info: 'Info',
  infoTitle: 'Informazioni sulla navetta',
  infoHours: 'Orari',
  infoHow: 'Come funziona',
  infoSteps: (w) => [
    'Prenota da qui: andata agli impianti o ritorno in hotel, per oggi o per domani.',
    'L’autista conferma e ti avvisa: «arrivo fra 7 minuti», poi «sono arrivato».',
    `All’impianto l’autista attende al massimo ${w} minuti: una corsa non utilizzata può essere addebitata.`,
    'Puoi cancellare la corsa finché l’autista non ti ha avvisato di essere arrivato.',
  ],
  infoMeeting: 'Punti d’incontro agli impianti',
  infoSeats: (n) => `La navetta ha ${n} posti: alla stessa ora e dallo stesso punto si viaggia insieme.`,
  infoOutside: 'Fuori orario',
  infoReception: 'Reception',
  callHotel: 'Telefona in hotel',
  stepOf: (n, t) => `Passo ${n} di ${t}`,
};

const de: GuestStrings = {
  appTitle: 'Shuttle zu den Liften',
  hotel: 'Chalet Hotel Hartmann',
  loginIntro: 'Geben Sie Ihre Zimmernummer ein.',
  room: 'Zimmer',
  login: 'Anmelden',
  loginError: 'Dieses Zimmer ist für den Shuttle nicht freigeschaltet. Bitte wenden Sie sich an die Rezeption.',
  tooManyAttempts: 'Zu viele Versuche. Bitte versuchen Sie es in einigen Minuten erneut oder fragen Sie an der Rezeption.',
  logout: 'Abmelden',
  roomLabel: (r) => `Zimmer ${r}`,
  newRide: 'Fahrt buchen',
  toLift: 'Hinfahrt',
  toLiftHint: 'Hotel → Lift',
  toHotel: 'Rückfahrt',
  toHotelHint: 'Lift → Hotel',
  destination: 'Ziel-Lift',
  pickupAt: 'Abholung am Lift',
  persons: 'Personen',
  day: 'Tag',
  today: 'Heute',
  tomorrow: 'Morgen',
  time: 'Gewünschte Uhrzeit',
  note: 'Hinweis für den Fahrer',
  notePlaceholder: 'Optional, z. B. Ski und Skischuhe',
  conditionsTitle: 'Bedingungen',
  conditions: (m) =>
    `Am Abholpunkt wartet der Fahrer höchstens ${m} Minuten. Danach kann er abfahren und die nicht genutzte Fahrt kann Ihnen in Rechnung gestellt werden.`,
  accept: 'Gelesen und akzeptiert',
  send: 'Anfrage senden',
  sending: 'Wird gesendet…',
  sent: 'Anfrage gesendet. Die Bestätigung des Fahrers erscheint hier.',
  myRides: 'Ihre Fahrten',
  noRides: 'Keine Fahrten gebucht.',
  cancel: 'Fahrt stornieren',
  cancelConfirm: 'Diese Fahrt stornieren? Fahrer und Rezeption werden benachrichtigt.',
  keep: 'Nein, behalten',
  cancelled: 'Fahrt storniert: Fahrer und Rezeption wurden benachrichtigt.',
  afterConfirmCall: (p) => `Der Fahrer ist bereits da. Für Änderungen rufen Sie bitte die Rezeption an: ${p}`,
  afterConfirmReception: 'Der Fahrer ist bereits da. Für Änderungen wenden Sie sich bitte an die Rezeption.',
  noSlots: 'Für heute sind keine Zeiten mehr buchbar. Bitte wählen Sie morgen.',
  waitUntil: (t) => `Der Fahrer wartet bis ${t} Uhr auf Sie.`,
  status: {
    richiesta: 'Gesendet, wartet auf den Fahrer',
    confermata: 'Vom Fahrer bestätigt',
    sul_posto: 'Der Fahrer ist vor Ort',
    completata: 'Erledigt',
    no_show: 'Nicht erschienen, der Fahrer ist abgefahren',
    annullata: 'Storniert',
  },
  driverMessage: {
    arrivato: 'Der Fahrer ist da.',
    sette_minuti: 'Der Fahrer ist in 7 Minuten bei Ihnen. Wir bitten um etwas Geduld.',
    traffico: 'Es herrscht Verkehr, der Fahrer ist unterwegs.',
  },
  problems: {
    data_non_valida: 'Ungültiges Datum.',
    data_fuori_soggiorno: 'Das Datum liegt nach Ihrem Aufenthalt.',
    data_troppo_lontana: 'Buchbar nur für heute oder morgen.',
    orario_non_valido: 'Ungültige Uhrzeit.',
    fuori_orario_servizio: 'Die Uhrzeit liegt außerhalb der Betriebszeit.',
    troppo_presto: 'Zu kurzfristig: bitte eine spätere Uhrzeit wählen.',
    persone_non_valide: 'Ungültige Personenzahl.',
    destinazione_non_valida: 'Bitte einen Lift wählen.',
    condizioni_non_accettate: 'Bitte akzeptieren Sie die Bedingungen.',
    orario_occupato: 'Zu dieser Zeit ist der Shuttle schon unterwegs: bitte eine andere Uhrzeit wählen.',
    posti_esauriti: 'Der Shuttle zu dieser Zeit ist voll: bitte eine andere Uhrzeit wählen.',
  },
  from: 'Von',
  to: 'Nach',
  hotelName: 'Hotel Hartmann',
  soundOn: 'Mit Ton benachrichtigen',
  validUntil: (d) => `Gültig bis ${d}`,
  offline: 'Keine Verbindung: der Status wird aktualisiert, sobald das Netz zurück ist.',
  whereTo: 'Wohin möchten Sie?',
  goLift: 'Zu den Liften',
  goLiftHint: 'Vom Hotel zum Lift',
  goHotel: 'Zum Hotel',
  goHotelHint: 'Vom Lift zum Hotel',
  whichLift: 'Welcher Lift?',
  fromWhichLift: 'Von welchem Lift?',
  whenWho: 'Wann und wie viele Personen?',
  next: 'Weiter',
  back: 'Zurück',
  close: 'Schließen',
  summary: 'Prüfen und bestätigen',
  acceptAndBook: 'Akzeptieren und buchen',
  addNote: 'Hinweis für den Fahrer hinzufügen',
  nextRide: 'Ihre nächste Fahrt',
  otherRides: 'Weitere Fahrten',
  changeTime: 'Uhrzeit ändern',
  soundOff: 'Ton aus',
  soundShort: 'Ton',
  languageShort: 'Sprache',
  busyTitle: 'Zu dieser Zeit ist der Shuttle schon unterwegs',
  busyHint: 'Es gibt nur einen Shuttle: bitte eine dieser Zeiten wählen.',
  fullTitle: 'Der Shuttle zu dieser Zeit ist voll',
  freeTimes: 'Freie Zeiten',
  joinTrip: 'mit anderen Gästen',
  noFreeTimes: 'An diesem Tag ist keine Zeit mehr frei: bitte die Rezeption anrufen.',
  meetingPoint: 'Treffpunkt',
  openMap: 'Karte öffnen',
  outOfServiceTitle: 'Zu dieser Zeit fährt der Shuttle nicht',
  serviceHours: (h) => `Shuttle-Zeiten: ${h}.`,
  taxiHint: (n) => `Außerhalb dieser Zeiten erreichen Sie ${n}:`,
  info: 'Info',
  infoTitle: 'Informationen zum Shuttle',
  infoHours: 'Fahrzeiten',
  infoHow: 'So funktioniert es',
  infoSteps: (w) => [
    'Hier buchen: Hinfahrt zum Lift oder Rückfahrt ins Hotel, für heute oder morgen.',
    'Der Fahrer bestätigt und benachrichtigt Sie: „Ankunft in 7 Minuten“, dann „Ich bin da“.',
    `Am Lift wartet der Fahrer höchstens ${w} Minuten: eine nicht genutzte Fahrt kann berechnet werden.`,
    'Sie können stornieren, bis der Fahrer seine Ankunft gemeldet hat.',
  ],
  infoMeeting: 'Treffpunkte an den Liften',
  infoSeats: (n) => `Der Shuttle hat ${n} Plätze: zur gleichen Zeit und vom gleichen Ort fährt man gemeinsam.`,
  infoOutside: 'Außerhalb der Fahrzeiten',
  infoReception: 'Rezeption',
  callHotel: 'Hotel anrufen',
  stepOf: (n, t) => `Schritt ${n} von ${t}`,
};

const en: GuestStrings = {
  appTitle: 'Ski shuttle',
  hotel: 'Chalet Hotel Hartmann',
  loginIntro: 'Enter your room number.',
  room: 'Room',
  login: 'Sign in',
  loginError: 'This room is not active for the shuttle. Please contact reception.',
  tooManyAttempts: 'Too many attempts. Please try again in a few minutes or ask at reception.',
  logout: 'Sign out',
  roomLabel: (r) => `Room ${r}`,
  newRide: 'Book a ride',
  toLift: 'Outbound',
  toLiftHint: 'Hotel → lift',
  toHotel: 'Return',
  toHotelHint: 'Lift → hotel',
  destination: 'Lift',
  pickupAt: 'Pick-up at the lift',
  persons: 'People',
  day: 'Day',
  today: 'Today',
  tomorrow: 'Tomorrow',
  time: 'Preferred time',
  note: 'Note for the driver',
  notePlaceholder: 'Optional, e.g. skis and boots',
  conditionsTitle: 'Conditions',
  conditions: (m) =>
    `At the pick-up point the driver waits for a maximum of ${m} minutes. After that the driver may leave and the unused ride may be charged to you.`,
  accept: 'I have read and accept',
  send: 'Send request',
  sending: 'Sending…',
  sent: 'Request sent. The driver’s confirmation will appear here.',
  myRides: 'Your rides',
  noRides: 'No rides booked.',
  cancel: 'Cancel ride',
  cancelConfirm: 'Cancel this ride? The driver and reception will be notified.',
  keep: 'No, keep it',
  cancelled: 'Ride cancelled: the driver and reception have been notified.',
  afterConfirmCall: (p) => `The driver is already there. For changes please call reception: ${p}`,
  afterConfirmReception: 'The driver is already there. For changes please contact reception.',
  noSlots: 'No more times can be booked for today. Please choose tomorrow.',
  waitUntil: (t) => `The driver waits for you until ${t}.`,
  status: {
    richiesta: 'Sent, waiting for the driver',
    confermata: 'Confirmed by the driver',
    sul_posto: 'The driver is at the pick-up point',
    completata: 'Completed',
    no_show: 'No-show, the driver has left',
    annullata: 'Cancelled',
  },
  driverMessage: {
    arrivato: 'Your driver has arrived.',
    sette_minuti: 'Your driver will be there in 7 minutes. Thank you for your patience.',
    traffico: 'There is traffic. Your driver is on the way.',
  },
  problems: {
    data_non_valida: 'Invalid date.',
    data_fuori_soggiorno: 'The date is after the end of your stay.',
    data_troppo_lontana: 'You can book for today or tomorrow only.',
    orario_non_valido: 'Invalid time.',
    fuori_orario_servizio: 'The time is outside service hours.',
    troppo_presto: 'Too soon: please choose a later time.',
    persone_non_valide: 'Invalid number of people.',
    destinazione_non_valida: 'Please choose a lift.',
    condizioni_non_accettate: 'Please accept the conditions to send.',
    orario_occupato: 'The shuttle is already busy at this time: please pick another time.',
    posti_esauriti: 'The shuttle at this time is already full: please pick another time.',
  },
  from: 'From',
  to: 'To',
  hotelName: 'Hotel Hartmann',
  soundOn: 'Notify me with a sound',
  validUntil: (d) => `Valid until ${d}`,
  offline: 'No connection: the status will update as soon as you are back online.',
  whereTo: 'Where would you like to go?',
  goLift: 'To the lifts',
  goLiftHint: 'From the hotel to the lift',
  goHotel: 'Back to the hotel',
  goHotelHint: 'From the lift to the hotel',
  whichLift: 'Which lift?',
  fromWhichLift: 'From which lift?',
  whenWho: 'When and how many people?',
  next: 'Next',
  back: 'Back',
  close: 'Close',
  summary: 'Check and confirm',
  acceptAndBook: 'Accept and book',
  addNote: 'Add a note for the driver',
  nextRide: 'Your next ride',
  otherRides: 'Other rides',
  changeTime: 'Change time',
  soundOff: 'Sound off',
  soundShort: 'Alerts',
  languageShort: 'Language',
  busyTitle: 'The shuttle is already busy at this time',
  busyHint: 'There is only one shuttle: please pick one of these times.',
  fullTitle: 'The shuttle at this time is already full',
  freeTimes: 'Available times',
  joinTrip: 'with other guests',
  noFreeTimes: 'No free time left on this day: please call reception.',
  meetingPoint: 'Meeting point',
  openMap: 'Open map',
  outOfServiceTitle: 'The shuttle is not running at this time',
  serviceHours: (h) => `Shuttle hours: ${h}.`,
  taxiHint: (n) => `Outside these hours you can call ${n}:`,
  info: 'Info',
  infoTitle: 'Shuttle information',
  infoHours: 'Hours',
  infoHow: 'How it works',
  infoSteps: (w) => [
    'Book here: to the lifts or back to the hotel, for today or tomorrow.',
    'The driver confirms and lets you know: “arriving in 7 minutes”, then “I’m here”.',
    `At the lift the driver waits up to ${w} minutes: an unused ride may be charged.`,
    'You can cancel until the driver has told you he has arrived.',
  ],
  infoMeeting: 'Meeting points at the lifts',
  infoSeats: (n) => `The shuttle has ${n} seats: same time and same place means you ride together.`,
  infoOutside: 'Outside shuttle hours',
  infoReception: 'Reception',
  callHotel: 'Call the hotel',
  stepOf: (n, t) => `Step ${n} of ${t}`,
};

export const GUEST_STRINGS: Record<Lang, GuestStrings> = { it, de, en };

export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'it';
  if (nav.startsWith('de')) return 'de';
  if (nav.startsWith('it')) return 'it';
  return 'en';
}
