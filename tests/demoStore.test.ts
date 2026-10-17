import { describe, expect, it } from 'vitest';
import { OffsetClock, addDays, romeDate } from '../src/domain/time';
import type { Presence, Ride } from '../src/domain/types';
import { roomPresences, roomsToSync } from '../src/presence/presence';
import { createDemoBackend } from '../src/store/demoStore';

// PIN di prova: quelli veri non stanno nel codice.
const PINS = { reception: '4711', autista: '9090' } as const;

describe('accessi con PIN e numero di camera (backend demo)', () => {
  it('il PIN decide il ruolo; senza PIN non si legge né si scrive', async () => {
    const hub = createDemoBackend({ pins: { ...PINS } });
    const rec = hub.device('banco');
    const drv = hub.device('mezzo');
    expect(await rec.auth.current()).toBeNull();
    await expect(rec.staff.getSettings()).rejects.toMatchObject({ code: 'non_autorizzato' });
    await expect(rec.auth.signInWithPin('0000')).rejects.toMatchObject({ code: 'pin_errato' });
    expect((await rec.auth.signInWithPin(PINS.reception)).role).toBe('reception');
    expect((await drv.auth.signInWithPin(PINS.autista)).role).toBe('autista');
    await expect(drv.staff.setPin('autista', '1357')).rejects.toMatchObject({ code: 'non_autorizzato' });
    await expect(rec.staff.setPin('autista', PINS.reception)).rejects.toMatchObject({ code: 'non_valida' });
    await rec.staff.setPin('autista', '1357');
    expect(await drv.auth.current()).toBeNull();
    expect((await drv.auth.signInWithPin('1357')).role).toBe('autista');
    expect((await rec.staff.devices()).find((d) => d.role === 'autista')?.count).toBe(1);
    expect(await rec.staff.disconnect('autista')).toBe(1);
    expect(await drv.auth.current()).toBeNull();
  });

  it('blocca dopo 5 PIN errati sullo stesso dispositivo', async () => {
    const hub = createDemoBackend({ pins: { ...PINS } });
    const d = hub.device('x');
    for (let i = 0; i < 5; i++) await expect(d.auth.signInWithPin('0000')).rejects.toMatchObject({ code: 'pin_errato' });
    await expect(d.auth.signInWithPin(PINS.reception)).rejects.toMatchObject({ code: 'troppi_tentativi' });
  });

  it('l’ospite entra con il numero di camera solo se la camera è attiva', async () => {
    const hub = createDemoBackend({ pins: { ...PINS }, signedIn: { banco: 'reception' } });
    const b = hub.device('banco');
    await expect(b.guest.login('103')).rejects.toMatchObject({ code: 'camera_non_attiva' });
    await expect(b.guest.login('999')).rejects.toMatchObject({ code: 'camera_non_attiva' });
    expect((await b.guest.login(' 105 ')).room).toBe('105');
    const s = await b.staff.getSettings();
    await b.staff.saveSettings({ ...s, guestAccess: 'tutte_le_camere' });
    expect((await b.guest.login('103')).room).toBe('103');
  });
});

describe('flusso completo ospite → autista → reception', () => {
  it('prenota, conferma, attende 5 minuti, segnala il non presentato e decide l’addebito', async () => {
    const clock = new OffsetClock();
    const hub = createDemoBackend({ clock, pins: { ...PINS }, signedIn: { banco: 'reception', mezzo: 'autista' } });
    const rec = hub.device('banco');
    const drv = hub.device('mezzo');
    const tomorrow = addDays(romeDate(clock.now()), 1);

    await rec.staff.syncRooms([{ room: '103', reservationId: '1f1b20fe-9a4e-6a90-b1fc-9374bc708599', persons: 2, validUntil: tomorrow }], false);
    const s = await rec.guest.login('103');
    expect(s.persons).toBe(2);

    let seen: Ride[] = [];
    const off = drv.staff.watchRides(tomorrow, (l) => (seen = l));
    const ride = await rec.guest.createRide(s.token, { serviceDate: tomorrow, time: '16:00', direction: 'ritorno', destinationId: 'seceda', persons: 2, note: null, conditionsAccepted: true });
    expect(ride.reservationId).toBe('1f1b20fe-9a4e-6a90-b1fc-9374bc708599');
    expect(seen.map((r) => r.id)).toContain(ride.id);

    await drv.staff.driverMessage(ride.id, 'arrivato');
    expect((await rec.guest.rides(s.token)).find((r) => r.id === ride.id)?.lastMessage).toBe('arrivato');
    await expect(rec.guest.cancelRide(s.token, ride.id)).rejects.toMatchObject({ code: 'stato_non_valido' });
    await expect(drv.staff.driverNoShow(ride.id)).rejects.toMatchObject({ code: 'attesa_in_corso' });
    clock.advance(5);
    expect((await drv.staff.driverNoShow(ride.id)).status).toBe('no_show');
    await expect(drv.staff.setCharge(ride.id, 'addebitare')).rejects.toMatchObject({ code: 'non_autorizzato' });
    expect((await rec.staff.setCharge(ride.id, 'addebitare')).chargeDecision).toBe('addebitare');
    expect((await rec.staff.rideEvents(ride.id)).map((e) => `${e.kind}:${e.actor}`)).toEqual(['creata:ospite', 'messaggio:autista', 'no_show:autista', 'addebito:reception']);
    off();
  });

  it('nuovo ospite nella stessa camera: la sessione del precedente si chiude', async () => {
    const hub = createDemoBackend({ pins: { ...PINS }, signedIn: { banco: 'reception' } });
    const rec = hub.device('banco');
    const until = addDays(romeDate(Date.now()), 1);
    await rec.staff.syncRooms([{ room: '108', reservationId: 'res-a', persons: 2, validUntil: until }], false);
    const s = await rec.guest.login('108');
    await rec.staff.syncRooms([{ room: '108', reservationId: 'res-b', persons: 1, validUntil: until }], false);
    await expect(rec.guest.rides(s.token)).rejects.toMatchObject({ code: 'sessione_scaduta' });
    expect((await rec.guest.login('108')).persons).toBe(1);
  });
});

describe('camere da attivare dalle presenze', () => {
  const p = (room: string, state: Presence['state'], arrival: string, departure: string, id: string): Presence => ({
    reservationId: id, room, adults: 2, children: 0, arrival, departure, state, name: null,
  });
  const D = '2026-10-17';
  const snap = (stays: Presence[]) => ({ date: D, stays, dataAsOf: null, generatedAt: null, loadedAt: '' });

  it('nel giorno del cambio resta attivo chi parte finché il nuovo ospite non fa il check-in', () => {
    const before = roomsToSync(roomPresences(['105'], snap([p('105', 'parte', '2026-10-14', D, 'old'), p('105', 'arriva', D, '2026-10-20', 'new')])));
    expect(before.map((i) => i.reservationId)).toEqual(['old']);
    const checkedOut = roomsToSync(roomPresences(['105'], snap([p('105', 'partito', '2026-10-14', D, 'old'), p('105', 'arriva', D, '2026-10-20', 'new')])));
    expect(checkedOut.map((i) => i.reservationId)).toEqual(['new']);
    const checkedIn = roomsToSync(roomPresences(['105'], snap([p('105', 'parte', '2026-10-14', D, 'old'), p('105', 'in_casa', D, '2026-10-20', 'new')])));
    expect(checkedIn.map((i) => i.reservationId)).toEqual(['new']);
  });

  it('camera libera: niente da attivare; ID di Slope invariati', () => {
    const items = roomsToSync(roomPresences(['101', '103'], snap([p('101', 'in_casa', '2026-10-15', '2026-10-19', '1f1c70fe-e193-6742-9f9d-13b1b916a116')])));
    expect(items).toEqual([{ room: '101', reservationId: '1f1c70fe-e193-6742-9f9d-13b1b916a116', persons: 2, validUntil: '2026-10-19' }]);
  });
});
