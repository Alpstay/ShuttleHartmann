import { describe, expect, it } from 'vitest';
import { HARTMANN_ROOMS } from '../src/config';
import {
  HARTMANN_PROPERTY_ID,
  buildPresenze,
  decryptJson,
  encryptJson,
  feedAad,
  shortName,
  stateOn,
  type ScatolaReservationRow,
} from '../src/feed/presenzeFeed';

const G = '2026-10-17';
const G1 = '2026-10-18';

const row = (over: Partial<ScatolaReservationRow>): ScatolaReservationRow => ({
  reservation_id: '1f1b20fe-9a4e-6a90-b1fc-9374bc708599',
  property_id: HARTMANN_PROPERTY_ID,
  room_name: '103',
  arrival: '2026-10-16',
  departure: '2026-10-20',
  adults: 2,
  children: 0,
  is_option: false,
  booking_status: 'CONFIRMED',
  stay_status: 'IN_HOUSE',
  check_in_at: '2026-10-16T14:23:00+00:00',
  check_out_at: null,
  ...over,
});

describe('presenze.json', () => {
  it('cifra e decifra con lo stesso schema delle colazioni (AES-GCM, PBKDF2, dato aggiuntivo)', async () => {
    const enc = await encryptJson({ stays: [{ room: '105' }] }, 'Shuttle-TEST-PASSWORD', feedAad(G));
    expect(enc.alg).toBe('AES-GCM/PBKDF2-SHA256');
    expect(enc.iter).toBe(250000);
    expect(await decryptJson(enc, 'Shuttle-TEST-PASSWORD', feedAad(G))).toEqual({ stays: [{ room: '105' }] });
    await expect(decryptJson(enc, 'password-sbagliata', feedAad(G))).rejects.toThrow();
    // Un blocco di un altro giorno non si può riusare.
    await expect(decryptJson(enc, 'Shuttle-TEST-PASSWORD', feedAad(G1))).rejects.toThrow();
  });

  it('rifiuta righe di altre strutture: solo Hartmann', () => {
    const res = buildPresenze({ rows: [row({}), row({ reservation_id: '1f1c70fe-e193-6742-9f9d-13b1b916a116', property_id: '33333333-3333-4333-8333-333333333333', room_name: '310' })], guests: [], contacts: [], days: [G], knownRooms: HARTMANN_ROOMS });
    expect(res.errors.join(' ')).toMatch(/altra struttura/);
  });

  it('calcola in casa, arrivi e partenze per ogni giorno e copia gli ID invariati', () => {
    const rows = [
      row({}),
      row({ reservation_id: '1f19800f-fea8-634c-ab9e-a7f952e83f57', room_name: '101', arrival: G, departure: '2026-10-20', check_in_at: null, stay_status: 'TO_ARRIVE' }),
      row({ reservation_id: '1f1c9317-3cbf-69a6-affe-c342a716003b', room_name: '122', arrival: '2026-10-15', departure: G, check_out_at: null }),
      row({ reservation_id: '06ede22d-302b-4ffa-bca2-712f8026bcd5', room_name: '121', arrival: G1, departure: '2026-10-19', check_in_at: null, stay_status: 'TO_ARRIVE' }),
      row({ reservation_id: '2c2ff13f-402a-4776-9b5f-1835e9d4b784', room_name: '107', is_option: true }),
    ];
    const res = buildPresenze({ rows, guests: [], contacts: [], days: [G, G1], knownRooms: HARTMANN_ROOMS });
    expect(res.errors).toEqual([]);
    const today = res.payloads[G]!.stays;
    expect(today.map((s) => [s.room, s.state])).toEqual([
      ['101', 'arriva'],
      ['103', 'in_casa'],
      ['122', 'parte'],
    ]);
    expect(today.find((s) => s.room === '101')!.reservation_id).toBe('1f19800f-fea8-634c-ab9e-a7f952e83f57');
    expect(res.payloads[G1]!.stays.map((s) => s.room)).toEqual(['101', '103', '121']);
    expect(res.report[0]).toMatch(/^RIEPILOGO 2026-10-17: 3 camere/);
  });

  it('prende il nome dall’ospite principale, poi dall’intestatario, senza stamparlo nel riepilogo', () => {
    const rows = [row({}), row({ reservation_id: '1f19800f-fea8-634c-ab9e-a7f952e83f57', room_name: '101' })];
    const res = buildPresenze({
      rows,
      guests: [
        { reservation_id: '1f1b20fe-9a4e-6a90-b1fc-9374bc708599', is_primary_guest: false, first_name: 'anna', last_name: 'MÜLLER' },
        { reservation_id: '1f1b20fe-9a4e-6a90-b1fc-9374bc708599', is_primary_guest: true, first_name: 'Karl', last_name: 'Müller' },
      ],
      contacts: [{ reservation_id: '1f19800f-fea8-634c-ab9e-a7f952e83f57', booker_type: 'INDIVIDUAL', first_name: 'Emma', last_name: 'Clarke' }],
      days: [G],
      knownRooms: HARTMANN_ROOMS,
    });
    const names = Object.fromEntries(res.payloads[G]!.stays.map((s) => [s.room, s.name]));
    expect(names).toEqual({ '101': 'Clarke E.', '103': 'Müller K.' });
    expect(res.report.join(' ')).not.toMatch(/Müller|Clarke/);
  });

  it('segnala ID trascritti male e doppie prenotazioni nella stessa camera', () => {
    const rows = [row({}), row({ reservation_id: '1f19800f-fea8-634c-ab9e-a7f952e83f57' })];
    const res = buildPresenze({
      rows,
      guests: [{ reservation_id: '1f1b20fe-9a4e-6a90-b1fc-9374bc708590', is_primary_guest: true, first_name: 'X', last_name: 'Y' }],
      contacts: [],
      days: [G],
      knownRooms: HARTMANN_ROOMS,
    });
    expect(res.warnings.some((w) => /trascritto male/.test(w))).toBe(true);
    expect(res.warnings.some((w) => /camera 103 ha 2 prenotazioni/.test(w))).toBe(true);
  });

  it('blocca la stessa prenotazione trascritta due volte con dati diversi', () => {
    const res = buildPresenze({ rows: [row({}), row({ room_name: '105' })], guests: [], contacts: [], days: [G], knownRooms: HARTMANN_ROOMS });
    expect(res.errors.join(' ')).toMatch(/due volte con dati diversi/);
  });

  it('stato del giorno e nome breve', () => {
    expect(stateOn(row({ departure: G, check_out_at: '2026-10-17T08:00:00Z' }), G)).toBe('partito');
    expect(stateOn(row({ arrival: G, check_in_at: null, stay_status: 'TO_ARRIVE' }), G)).toBe('arriva');
    expect(shortName('VAN DER BERG', 'jan')).toBe('Van Der Berg J.');
    expect(shortName('', '')).toBeNull();
  });
});
