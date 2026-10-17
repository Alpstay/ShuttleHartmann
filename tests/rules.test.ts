import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  applyCancel,
  applyDone,
  applyDriverMessage,
  applyNoShow,
  departLabel,
  departState,
  earliestSlot,
  groupBySlot,
  normalizeRoom,
  pickupPlace,
  ridesToCsv,
  shiftTime,
  staffPinProblem,
  suggestedTime,
  validateRideInput,
  waitState,
} from '../src/domain/rules';
import { addDays, romeDate } from '../src/domain/time';
import type { Ride, RideInput } from '../src/domain/types';

// Sabato 17 ottobre 2026, 10:00 a Ortisei (UTC+2)
const NOW = Date.parse('2026-10-17T08:00:00Z');
const TODAY = '2026-10-17';

const input = (over: Partial<RideInput> = {}): RideInput => ({
  serviceDate: TODAY,
  time: '11:00',
  direction: 'andata',
  destinationId: 'seceda',
  persons: 2,
  note: null,
  conditionsAccepted: true,
  ...over,
});

const ride = (over: Partial<Ride> = {}): Ride => ({
  id: 'r1',
  stayId: 's1',
  room: '105',
  reservationId: '1f1c70fe-e193-6742-9f9d-13b1b916a116',
  serviceDate: TODAY,
  time: '11:00',
  direction: 'ritorno',
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
  conditionsAcceptedAt: null,
  createdAt: '2026-10-17T07:00:00Z',
  updatedAt: '2026-10-17T07:00:00Z',
  ...over,
});

describe('date e orari Europe/Rome', () => {
  it('calcola la data di servizio nel fuso italiano anche a cavallo della mezzanotte UTC', () => {
    expect(romeDate(Date.parse('2026-10-17T22:30:00Z'))).toBe('2026-10-18');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('validazione richiesta', () => {
  const ctx = { settings: DEFAULT_SETTINGS, nowMs: NOW, actor: 'ospite' as const };

  it('accetta una richiesta valida', () => {
    expect(validateRideInput(input(), ctx)).toEqual([]);
  });

  it('richiede l’accettazione delle condizioni solo all’ospite', () => {
    expect(validateRideInput(input({ conditionsAccepted: false }), ctx)).toEqual(['condizioni_non_accettate']);
    expect(validateRideInput(input({ conditionsAccepted: false }), { ...ctx, actor: 'reception' })).toEqual([]);
  });

  it('impone l’anticipo minimo di 15 minuti all’ospite, non alla reception', () => {
    expect(validateRideInput(input({ time: '10:10' }), ctx)).toEqual(['troppo_presto']);
    expect(validateRideInput(input({ time: '10:15' }), ctx)).toEqual([]);
    expect(validateRideInput(input({ time: '10:00' }), { ...ctx, actor: 'reception' })).toEqual([]);
  });

  it('rifiuta orari fuori servizio, giorni oltre domani e oltre la partenza', () => {
    expect(validateRideInput(input({ serviceDate: '2026-10-18', time: '07:30' }), ctx)).toEqual(['fuori_orario_servizio']);
    expect(validateRideInput(input({ serviceDate: '2026-10-19', time: '09:00' }), ctx)).toEqual(['data_troppo_lontana']);
    expect(validateRideInput(input({ serviceDate: '2026-10-18', time: '09:00' }), { ...ctx, stay: { validFrom: TODAY, validUntil: TODAY } })).toEqual(['data_fuori_soggiorno']);
  });

  it('controlla persone e impianto', () => {
    expect(validateRideInput(input({ persons: 9 }), ctx)).toEqual(['persone_non_valide']);
    expect(validateRideInput(input({ destinationId: 'nessuno' }), ctx)).toEqual(['destinazione_non_valida']);
    const off = { ...DEFAULT_SETTINGS, destinations: DEFAULT_SETTINGS.destinations.map((d) => ({ ...d, active: d.id !== 'seceda' })) };
    expect(validateRideInput(input(), { ...ctx, settings: off })).toEqual(['destinazione_non_valida']);
  });
});

describe('orari proposti', () => {
  it('propone il primo slot utile arrotondato a 5 minuti', () => {
    expect(earliestSlot(DEFAULT_SETTINGS, Date.parse('2026-10-17T08:02:00Z'), TODAY, 'ospite')).toBe('10:20');
    expect(suggestedTime(DEFAULT_SETTINGS, NOW, TODAY, 'andata', 'ospite')).toBe('10:15');
    expect(suggestedTime(DEFAULT_SETTINGS, NOW, TODAY, 'ritorno', 'ospite')).toBe('16:00');
    expect(suggestedTime(DEFAULT_SETTINGS, NOW, '2026-10-18', 'andata', 'ospite')).toBe('09:00');
  });

  it('a fine servizio non lascia prenotare oggi', () => {
    expect(earliestSlot(DEFAULT_SETTINGS, Date.parse('2026-10-17T15:20:00Z'), TODAY, 'ospite')).toBeNull();
  });

  it('il selettore resta dentro la finestra prenotabile', () => {
    expect(shiftTime('10:15', -30, DEFAULT_SETTINGS, NOW, TODAY, 'ospite')).toBe('10:15');
    expect(shiftTime('17:20', 30, DEFAULT_SETTINGS, NOW, TODAY, 'ospite')).toBe('17:30');
  });
});

describe('accessi', () => {
  it('PIN dello staff: 4 cifre e diversi tra reception e autista', () => {
    expect(staffPinProblem('123', null)).toMatch(/4 cifre/);
    expect(staffPinProblem('12a4', null)).toMatch(/4 cifre/);
    expect(staffPinProblem('4711', '4711')).toMatch(/diversi/);
    expect(staffPinProblem('4711', '9090')).toBeNull();
  });

  it('numero di camera ripulito dagli spazi', () => {
    expect(normalizeRoom(' 1 05 ')).toBe('105');
  });

  it('elenco camere iniziale dell’Hartmann e accesso solo camere occupate', () => {
    expect(DEFAULT_SETTINGS.rooms).toEqual(['101', '102', '103', '105', '107', '108', '119', '121', '122']);
    expect(DEFAULT_SETTINGS.guestAccess).toBe('camere_occupate');
  });
});

describe('flusso autista', () => {
  const at = (min: number) => new Date(NOW + min * 60000).toISOString();

  it('il primo messaggio vale come conferma di lettura', () => {
    const r = applyDriverMessage(ride(), 'sette_minuti', at(0));
    expect(r.status).toBe('confermata');
    expect(r.readAt).toBe(at(0));
    expect(r.arrivedAt).toBeNull();
  });

  it('«Sono arrivato» avvia l’attesa e altri messaggi non la azzerano', () => {
    let r = applyDriverMessage(ride(), 'arrivato', at(0));
    expect(r.status).toBe('sul_posto');
    r = applyDriverMessage(r, 'traffico', at(2));
    expect(r.arrivedAt).toBe(at(0));
    expect(r.readAt).toBe(at(0));
  });

  it('«Fatto!» richiede prima la conferma di lettura', () => {
    expect(() => applyDone(ride(), at(0))).toThrow();
    const r = applyDone(applyDriverMessage(ride(), 'arrivato', at(0)), at(1));
    expect(r.status).toBe('completata');
  });

  it('non presentato solo dopo 5 minuti dall’arrivo', () => {
    const r = applyDriverMessage(ride(), 'arrivato', at(0));
    expect(waitState(r, DEFAULT_SETTINGS, NOW + 4 * 60000 + 59000)?.expired).toBe(false);
    expect(() => applyNoShow(r, DEFAULT_SETTINGS, NOW + 4 * 60000 + 59000)).toThrow(/non è ancora finita/);
    const ns = applyNoShow(r, DEFAULT_SETTINGS, NOW + 5 * 60000);
    expect(ns.status).toBe('no_show');
    expect(ns.chargeDecision).toBe('da_valutare');
  });

  it('avviso di partenza 7 minuti prima, fino all’arrivo dell’autista', () => {
    // NOW = 10:00 a Ortisei
    expect(departState(ride({ time: '10:08' }), NOW)).toBeNull();
    expect(departState(ride({ time: '10:07' }), NOW)).toEqual({ minutesLeft: 7 });
    expect(departState(ride({ time: '10:07' }), NOW + 59000)).toEqual({ minutesLeft: 7 });
    expect(departState(ride({ time: '09:58' }), NOW)).toEqual({ minutesLeft: -2 });
    expect(departState(ride({ time: '09:30' }), NOW)).toEqual({ minutesLeft: -30 });
    expect(departState(ride({ time: '09:29' }), NOW)).toBeNull();
    const confirmed = applyDriverMessage(ride({ time: '10:05' }), 'sette_minuti', at(0));
    expect(departState(confirmed, NOW)).toEqual({ minutesLeft: 5 });
    expect(departState(applyDriverMessage(confirmed, 'arrivato', at(1)), NOW)).toBeNull();
    expect(departState(ride({ time: '10:05', status: 'annullata' }), NOW)).toBeNull();
    expect(departState(ride({ time: '10:05', serviceDate: addDays(TODAY, 1) }), NOW)).toBeNull();
    expect(pickupPlace(ride({ direction: 'andata' }))).toBe('Hotel');
    expect(pickupPlace(ride({ direction: 'ritorno', destinationName: 'Seceda' }))).toBe('Seceda');
    expect([departLabel(5), departLabel(0), departLabel(-3)]).toEqual(['fra 5 min', 'adesso', '3 min di ritardo']);
  });

  it('l’ospite cancella finché l’autista non è arrivato, la reception fino alla chiusura', () => {
    expect(applyCancel(ride(), 'ospite', at(0)).cancelledBy).toBe('ospite');
    const confirmed = applyDriverMessage(ride(), 'sette_minuti', at(0));
    expect(applyCancel(confirmed, 'ospite', at(1)).status).toBe('annullata');
    const arrived = applyDriverMessage(confirmed, 'arrivato', at(2));
    expect(() => applyCancel(arrived, 'ospite', at(3))).toThrow(/già arrivato/);
    expect(applyCancel(arrived, 'reception', at(3)).cancelledBy).toBe('reception');
    expect(() => applyCancel(applyDone(arrived, at(4)), 'reception', at(5))).toThrow();
  });
});

describe('viste reception', () => {
  it('raggruppa per orario e segnala il superamento dei posti', () => {
    const rides = [
      ride({ id: 'a', time: '16:00', persons: 5 }),
      ride({ id: 'b', time: '16:00', persons: 4, room: '107' }),
      ride({ id: 'c', time: '16:00', persons: 3, room: '119', status: 'annullata' }),
      ride({ id: 'd', time: '16:30', persons: 2 }),
    ];
    const g = groupBySlot(rides, 'ritorno', 8);
    expect(g.map((x) => [x.time, x.persons, x.overCapacity])).toEqual([
      ['16:00', 9, true],
      ['16:30', 2, false],
    ]);
  });

  it('esporta il CSV con separatore ; e ID Slope invariato', () => {
    const csv = ridesToCsv([ride({ note: 'sci; scarponi' })]);
    expect(csv.split('\r\n')[0]).toContain('Camera;Persone');
    expect(csv).toContain('"sci; scarponi"');
    expect(csv).toContain('1f1c70fe-e193-6742-9f9d-13b1b916a116');
  });
});
