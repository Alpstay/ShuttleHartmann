import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  applyCancel,
  applyDone,
  applyDriverMessage,
  applyNoShow,
  busySlots,
  checkTrip,
  departLabel,
  departState,
  earliestSlot,
  groupBySlot,
  groupTrips,
  inServiceHours,
  rideConflicts,
  serviceHoursLabel,
  suggestTimes,
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
    expect(staffPinProblem('4711', null)).toMatch(/da 6 a 8 cifre/);
    expect(staffPinProblem('12a456', null)).toMatch(/da 6 a 8 cifre/);
    expect(staffPinProblem('471193471', null)).toMatch(/da 6 a 8 cifre/);
    expect(staffPinProblem('123456', null)).toMatch(/troppo facile/);
    expect(staffPinProblem('000000', null)).toMatch(/troppo facile/);
    expect(staffPinProblem('98765432', null)).toMatch(/troppo facile/);
    expect(staffPinProblem('471193', '471193')).toMatch(/diversi/);
    expect(staffPinProblem('471193', '909012')).toBeNull();
    expect(staffPinProblem('30081975', null)).toBeNull();
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

describe('il mezzo è uno solo: viaggi', () => {
  const S = { ...DEFAULT_SETTINGS, seats: 8, pickupGapMinutes: 20 };
  const r = (id: string, time: string, direction: 'andata' | 'ritorno', destinationId: string, persons = 2, status: Ride['status'] = 'richiesta'): Ride =>
    ride({ id, time, direction, destinationId, destinationName: destinationId, persons, status });
  const rides = [r('a', '16:00', 'ritorno', 'seceda', 2), r('b', '16:00', 'ritorno', 'seceda', 3), r('c', '09:00', 'andata', 'seceda'), r('d', '09:00', 'andata', 'monte-pana')];

  it('stesso orario e stesso punto di ritiro = un solo viaggio (all’andata il ritiro è sempre in hotel)', () => {
    const trips = groupTrips(rides);
    expect(trips.map((t) => `${t.time}|${t.pickup}|${t.rides.length}|${t.persons}`)).toEqual(['09:00|hotel|2|4', '16:00|seceda|2|5']);
  });

  it('due viaggi diversi devono stare ad almeno 20 minuti', () => {
    const busy = busySlots(rides, TODAY);
    expect(busy).toEqual([
      { time: '09:00', pickup: 'hotel', persons: 4 },
      { time: '16:00', pickup: 'seceda', persons: 5 },
    ]);
    const q = (time: string, direction: 'andata' | 'ritorno', destinationId: string, persons = 2) => checkTrip({ time, direction, destinationId, persons }, busy, S);
    expect(q('16:00', 'ritorno', 'monte-pana')).toBe('orario_occupato'); // stessa ora, altro impianto
    expect(q('16:10', 'ritorno', 'seceda')).toBe('orario_occupato'); // stesso impianto, troppo vicino
    expect(q('15:45', 'andata', 'seceda')).toBe('orario_occupato'); // dall'hotel 15 minuti prima
    expect(q('16:00', 'ritorno', 'seceda', 3)).toBeNull(); // si aggiunge al viaggio
    expect(q('16:00', 'ritorno', 'seceda', 4)).toBe('posti_esauriti');
    expect(q('16:20', 'ritorno', 'monte-pana')).toBeNull();
    expect(q('09:00', 'andata', 'alpe-di-siusi')).toBeNull(); // stesso ritiro in hotel
    expect(checkTrip({ time: '16:05', direction: 'ritorno', destinationId: 'monte-pana', persons: 2 }, busy, { ...S, pickupGapMinutes: 0 })).toBeNull();
    expect(busySlots([...rides, r('x', '12:00', 'ritorno', 'seceda', 2, 'annullata')], TODAY).some((b) => b.time === '12:00')).toBe(false);
  });

  it('propone gli orari validi più vicini, compreso il viaggio da condividere', () => {
    const busy = busySlots(rides, TODAY);
    const s = suggestTimes({ serviceDate: TODAY, time: '16:05', direction: 'ritorno', destinationId: 'seceda', persons: 2 }, busy, S, NOW, 'ospite');
    expect(s).toEqual([
      { time: '15:40', join: false },
      { time: '16:00', join: true },
      { time: '16:20', join: false },
      { time: '16:25', join: false },
    ]);
    const other = suggestTimes({ serviceDate: TODAY, time: '16:00', direction: 'ritorno', destinationId: 'monte-pana', persons: 2 }, busy, S, NOW, 'ospite');
    expect(other.every((x) => !x.join && checkTrip({ time: x.time, direction: 'ritorno', destinationId: 'monte-pana', persons: 2 }, busy, S) === null)).toBe(true);
    expect(other.map((x) => x.time)).toEqual(['15:35', '15:40', '16:20', '16:25']);
  });

  it('segnala alla reception e all’autista le corse già in conflitto', () => {
    const list = [...rides, r('e', '16:05', 'ritorno', 'col-raiser'), r('f', '16:05', 'ritorno', 'monte-pana', 2, 'completata')];
    const c = rideConflicts(list, S);
    expect([...c.keys()].sort()).toEqual(['a', 'b', 'e']);
    expect(c.get('e')!.map((x) => x.id).sort()).toEqual(['a', 'b']);
    const full = rideConflicts([r('g', '10:00', 'andata', 'seceda', 5), r('h', '10:00', 'andata', 'palmer', 4)], S);
    expect([...full.keys()].sort()).toEqual(['g', 'h']); // stesso viaggio oltre gli 8 posti
  });
});

describe('orari spezzati: 08:00–11:30 e 14:00–17:30', () => {
  const S = DEFAULT_SETTINGS;
  it('la pausa di metà giornata è fuori servizio, gli estremi no', () => {
    expect(serviceHoursLabel(S)).toBe('08:00–11:30 · 14:00–17:30');
    expect(['08:00', '11:30', '14:00', '17:30'].every((t) => inServiceHours(t, S))).toBe(true);
    expect(['07:55', '11:35', '12:30', '13:55', '17:35'].some((t) => inServiceHours(t, S))).toBe(false);
    expect(validateRideInput(input({ serviceDate: addDays(TODAY, 1), time: '12:30' }), { settings: S, nowMs: NOW, actor: 'ospite' })).toContain('fuori_orario_servizio');
    expect(serviceHoursLabel({ ...S, pauseStart: '', pauseEnd: '' })).toBe('08:00–17:30');
    expect(inServiceHours('12:30', { ...S, pauseStart: '', pauseEnd: '' })).toBe(true);
  });
  it('primo orario e orari proposti saltano la pausa', () => {
    const at1125 = Date.parse('2026-10-17T09:25:00Z'); // 11:25 a Ortisei: con 15 minuti di anticipo si va alle 14:00
    expect(earliestSlot(S, at1125, TODAY, 'ospite')).toBe('14:00');
    expect(earliestSlot(S, at1125, TODAY, 'reception')).toBe('11:25');
    const s = suggestTimes({ serviceDate: addDays(TODAY, 1), time: '11:30', direction: 'andata', destinationId: 'seceda', persons: 2 }, [{ time: '11:30', pickup: 'hotel', persons: 8 }], S, NOW, 'ospite');
    expect(s.every((x) => inServiceHours(x.time, S))).toBe(true);
    expect(s.map((x) => x.time)).toEqual(['11:05', '11:10', '14:00', '14:05']);
  });
});
