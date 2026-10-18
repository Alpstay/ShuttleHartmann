// Prova dello schema Supabase su PostgreSQL incorporato (PGlite): permessi, RLS, regole del servizio.
// Uso: npm run test:sql   (i PIN qui sono di prova: quelli veri non vanno mai nel repository)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const schemaPath = process.argv[2] ?? new URL('../../supabase/schema.sql', import.meta.url).pathname;
const db = new PGlite();

const stubs = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, is_anonymous boolean default true);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create publication supabase_realtime;
`;

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log('FAIL', msg);
  } else console.log('ok  ', msg);
};
async function expectError(promise, code, msg) {
  try {
    await promise;
    ok(false, `${msg} (nessun errore, atteso ${code})`);
  } catch (e) {
    ok(String(e.message).startsWith(code), `${msg} → ${e.message}`);
  }
}

process.on('uncaughtException', (e) => {
  console.log('ERRORE', e.message);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.log('ERRORE', e?.message ?? e);
  process.exit(1);
});

await db.exec(stubs);
await db.exec(readFileSync(schemaPath, 'utf8'));
await db.exec(`grant select on all tables in schema public to anon, authenticated;`);
await db.exec(readFileSync(schemaPath, 'utf8')); // rieseguibile
ok(true, 'schema eseguito due volte senza errori');

const PIN_R = '4711';
const PIN_D = '9090';
const DEV_R = '11111111-0000-4000-8000-000000000001';
const DEV_D = '11111111-0000-4000-8000-000000000002';
const STRANGER = '11111111-0000-4000-8000-000000000003';
const DEV_R2 = '11111111-0000-4000-8000-000000000004';
await db.exec(`insert into auth.users (id) values ('${DEV_R}'),('${DEV_D}'),('${STRANGER}'),('${DEV_R2}');`);

async function as(role, uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
const one = async (role, uid, sql, params) => (await as(role, uid, sql, params)).rows[0];

// --- PIN iniziali (solo dall'SQL Editor)
await expectError(as('authenticated', STRANGER, `select public.shuttle_admin_set_pin('reception', '1234')`), 'permission denied', 'PIN iniziale non impostabile dall’app');
await db.query(`select public.shuttle_admin_set_pin('reception', $1)`, [PIN_R]);
await db.query(`select public.shuttle_admin_set_pin('autista', $1)`, [PIN_D]);
const stored = (await db.query(`select pin_hash from public.shuttle_access`)).rows.map((r) => r.pin_hash);
ok(stored.every((h) => h.length === 64 && h !== PIN_R && h !== PIN_D), 'PIN salvati solo come hash');
await expectError(db.query(`select public.shuttle_admin_set_pin('autista', $1)`, [PIN_R]), 'non_valida:Reception e autista devono avere PIN diversi', 'PIN uguali per i due ruoli rifiutati');

// --- Accesso staff con PIN
ok((await one('authenticated', DEV_R, `select public.shuttle_staff_login('0000') j`)).j.error === 'pin_errato', 'PIN errato rifiutato');
await expectError(as('anon', null, `select public.shuttle_staff_login($1) j`, [PIN_R]), 'permission denied', 'senza sessione anonima di Supabase non si entra');
ok((await one('authenticated', DEV_R, `select public.shuttle_staff_login($1) j`, [PIN_R])).j.role === 'reception', 'PIN reception → ruolo reception');
ok((await one('authenticated', DEV_D, `select public.shuttle_staff_login($1) j`, [PIN_D])).j.role === 'autista', 'PIN autista → ruolo autista');
ok((await one('authenticated', DEV_R, `select role from public.shuttle_staff`)).role === 'reception', 'il dispositivo legge solo il proprio ruolo');
for (let i = 0; i < 5; i++) await as('authenticated', STRANGER, `select public.shuttle_staff_login('0001')`);
ok((await one('authenticated', STRANGER, `select public.shuttle_staff_login($1) j`, [PIN_R])).j.error === 'troppi_tentativi', 'blocco dopo 5 PIN errati sullo stesso dispositivo');

// --- Impostazioni e camere
const s0 = await one('authenticated', DEV_R, `select rooms, guest_access from public.shuttle_settings`);
ok(JSON.stringify(s0.rooms) === JSON.stringify(['101', '102', '103', '105', '107', '108', '119', '121', '122']) && s0.guest_access === 'camere_occupate', 'camere Hartmann e accesso «camere occupate» di base');
await expectError(as('authenticated', DEV_D, `select * from public.shuttle_save_settings('{"seats":7}'::jsonb)`), 'non_autorizzato', 'autista non modifica le impostazioni');

const tomorrow = (await db.query(`select (public.shuttle_today() + 1)::text as d`)).rows[0].d;

// --- Ospite con il numero di camera
ok((await one('anon', null, `select public.shuttle_guest_login('105') j`)).j.error === 'camera_non_attiva', 'camera senza ospiti in casa: accesso negato');
await as('authenticated', DEV_R, `select public.shuttle_sync_rooms($1::jsonb, true)`, [
  JSON.stringify([
    { room: '105', reservationId: 'res-105-a', persons: 2, validUntil: tomorrow },
    { room: '107', reservationId: 'res-107-a', persons: 3, validUntil: tomorrow },
  ]),
]);
await expectError(as('authenticated', DEV_D, `select public.shuttle_sync_rooms('[]'::jsonb, true)`), 'non_autorizzato', 'autista non allinea le camere');
const login = (await one('anon', null, `select public.shuttle_guest_login(' 105 ') j`)).j;
ok(!!login.token && login.room === '105' && login.persons === 2, 'ospite entra con il numero di camera (camera in casa)');
ok((await one('anon', null, `select public.shuttle_guest_login('999') j`)).j.error === 'camera_non_attiva', 'camera inesistente rifiutata');

await expectError(as('anon', null, `select public.shuttle_guest_create_ride($1::uuid, $2::date, '09:00', 'andata', 'seceda', 2, null, false)`, [login.token, tomorrow]), 'non_valida:condizioni_non_accettate', 'condizioni obbligatorie per l’ospite');
const ride = (await one('anon', null, `select public.shuttle_guest_create_ride($1::uuid, $2::date, '09:15', 'andata', 'seceda', 2, '  sci  ', true) j`, [login.token, tomorrow])).j;
ok(ride.status === 'richiesta' && ride.destination_name === 'Seceda' && ride.note === 'sci' && !('reservation_id' in ride), 'ospite crea corsa (senza esporre reservation_id)');
ok((await db.query(`select reservation_id from public.shuttle_rides where id = $1`, [ride.id])).rows[0].reservation_id === 'res-105-a', 'corsa legata alla prenotazione Slope');

// RLS
ok((await one('anon', null, `select count(*)::int c from public.shuttle_rides`)).c === 0, 'anonimo non legge le tabelle');
ok((await one('authenticated', STRANGER, `select count(*)::int c from public.shuttle_rides`)).c === 0, 'sessione senza PIN valido non legge le corse');
ok((await one('authenticated', DEV_D, `select count(*)::int c from public.shuttle_rides`)).c === 1, 'autista legge le corse');
await expectError(as('authenticated', DEV_D, `update public.shuttle_rides set status='completata'`), 'permission denied', 'scrittura diretta bloccata');
await expectError(as('authenticated', DEV_R, `select * from public.shuttle_access`), 'permission denied', 'hash dei PIN non leggibili dall’app');

// --- Autista
await expectError(as('authenticated', DEV_D, `select * from public.shuttle_driver_done($1::uuid)`, [ride.id]), 'stato_non_valido', '«Fatto» richiede prima la conferma di lettura');
let r = await one('authenticated', DEV_D, `select * from public.shuttle_driver_message($1::uuid, 'sette_minuti')`, [ride.id]);
ok(r.status === 'confermata' && r.read_at, 'messaggio «7 minuti» = conferma di lettura');
r = await one('authenticated', DEV_D, `select * from public.shuttle_driver_message($1::uuid, 'arrivato')`, [ride.id]);
const firstArrived = String(r.arrived_at);
await expectError(as('anon', null, `select public.shuttle_guest_cancel_ride($1::uuid, $2::uuid)`, [login.token, ride.id]), 'stato_non_valido', 'ospite non cancella dopo l’arrivo dell’autista');
r = await one('authenticated', DEV_D, `select * from public.shuttle_driver_message($1::uuid, 'traffico')`, [ride.id]);
ok(String(r.arrived_at) === firstArrived && r.status === 'sul_posto', '«Sono arrivato» avvia l’attesa, altri messaggi non la azzerano');
await expectError(as('authenticated', DEV_D, `select * from public.shuttle_driver_no_show($1::uuid)`, [ride.id]), 'attesa_in_corso', 'no-show bloccato prima di 5 minuti');
await db.query(`update public.shuttle_rides set arrived_at = now() - interval '5 minutes 1 second' where id = $1`, [ride.id]);
r = await one('authenticated', DEV_D, `select * from public.shuttle_driver_no_show($1::uuid)`, [ride.id]);
ok(r.status === 'no_show' && r.charge_decision === 'da_valutare', 'no-show dopo 5 minuti, addebito da valutare');
await expectError(as('authenticated', DEV_D, `select * from public.shuttle_set_charge($1::uuid, 'addebitare')`, [ride.id]), 'non_autorizzato', 'l’autista non decide l’addebito');
ok((await one('authenticated', DEV_R, `select * from public.shuttle_set_charge($1::uuid, 'addebitare')`, [ride.id])).charge_decision === 'addebitare', 'reception decide l’addebito');
const evs = (await as('authenticated', DEV_R, `select kind, actor from public.shuttle_ride_events where ride_id = $1 order by id`, [ride.id])).rows;
ok(evs.map((e) => `${e.kind}:${e.actor}`).join(',') === 'creata:ospite,messaggio:autista,messaggio:autista,messaggio:autista,no_show:autista,addebito:reception', 'registro eventi completo');

// --- L'ospite cancella una corsa già confermata: resta nel registro come cancellata dall'ospite
const rc = (await one('anon', null, `select public.shuttle_guest_create_ride($1::uuid, $2::date, '10:30', 'andata', 'monte-pana', 2, null, true) j`, [login.token, tomorrow])).j;
await as('authenticated', DEV_D, `select * from public.shuttle_driver_message($1::uuid, 'sette_minuti')`, [rc.id]);
const cc = (await one('anon', null, `select public.shuttle_guest_cancel_ride($1::uuid, $2::uuid) j`, [login.token, rc.id])).j;
ok(cc.status === 'annullata' && cc.cancelled_by === 'ospite', 'ospite cancella una corsa già confermata');
const cev = (await as('authenticated', DEV_R, `select kind, actor from public.shuttle_ride_events where ride_id = $1 order by id`, [rc.id])).rows.map((e) => `${e.kind}:${e.actor}`).join(',');
ok(cev === 'creata:ospite,messaggio:autista,annullata:ospite', 'cancellazione registrata nello storico');

// --- Il mezzo è uno solo: viaggi alla stessa ora da posti diversi
const guestRide = (time, dir, dest, persons) =>
  as('anon', null, `select public.shuttle_guest_create_ride($1::uuid, $2::date, $3::time, $4, $5, $6, null, true) j`, [login.token, tomorrow, time, dir, dest, persons]);
ok((await guestRide('16:00', 'ritorno', 'seceda', 2)).rows[0].j.status === 'richiesta', 'ritorno da Seceda alle 16:00');
await expectError(guestRide('16:00', 'ritorno', 'monte-pana', 2), 'non_valida:orario_occupato', 'stessa ora da un altro impianto: rifiutata');
await expectError(guestRide('16:10', 'ritorno', 'seceda', 2), 'non_valida:orario_occupato', 'stesso impianto 10 minuti dopo: rifiutata (si viaggia insieme alle 16:00)');
await expectError(guestRide('15:50', 'andata', 'alpe-di-siusi', 2), 'non_valida:orario_occupato', 'andata dall’hotel 10 minuti prima: rifiutata');
ok((await guestRide('16:00', 'ritorno', 'seceda', 3)).rows[0].j.status === 'richiesta', 'stesso viaggio (ora e impianto): un’altra prenotazione si aggiunge');
await expectError(guestRide('16:00', 'ritorno', 'seceda', 4), 'non_valida:posti_esauriti', 'stesso viaggio oltre gli 8 posti: rifiutata');
ok((await guestRide('16:20', 'ritorno', 'monte-pana', 2)).rows[0].j.status === 'richiesta', 'altro impianto a 20 minuti di distanza: ammessa');
const busy = (await one('anon', null, `select public.shuttle_guest_busy($1::uuid, $2::date) j`, [login.token, tomorrow])).j;
ok(JSON.stringify(busy) === JSON.stringify([{ time: '16:00', pickup: 'seceda', persons: 5 }, { time: '16:20', pickup: 'monte-pana', persons: 2 }]), `viaggi del giorno per l’ospite, senza camere: ${JSON.stringify(busy)}`);
const forced = await one('authenticated', DEV_R, `select * from public.shuttle_reception_create_ride('103', null, null, $1::date, '16:05', 'ritorno', 'col-raiser', 2, null)`, [tomorrow]);
ok(forced.status === 'richiesta', 'la reception può inserire anche un viaggio in conflitto (decide lei, la pagina avvisa)');
await as('authenticated', DEV_R, `select * from public.shuttle_save_settings('{"pickupGapMinutes":0}'::jsonb)`);
ok((await guestRide('16:10', 'ritorno', 'alpe-di-siusi', 1)).rows[0].j.status === 'richiesta', 'tempo tra viaggi a 0: controllo spento');
ok((await one('anon', null, `select public.shuttle_guest_settings($1::uuid) j`, [login.token])).j.pickupGapMinutes === 0, 'l’ospite riceve il tempo tra viaggi');
await as('authenticated', DEV_R, `select * from public.shuttle_save_settings('{"pickupGapMinutes":20}'::jsonb)`);

// --- Cambio ospite nella stessa camera e partenza anticipata
await as('authenticated', DEV_R, `select public.shuttle_sync_rooms($1::jsonb, true)`, [JSON.stringify([{ room: '105', reservationId: 'res-105-b', persons: 1, validUntil: tomorrow }])]);
await expectError(as('anon', null, `select public.shuttle_guest_rides($1::uuid)`, [login.token]), 'sessione_scaduta', 'nuovo ospite in camera: la sessione del precedente si chiude');
ok((await db.query(`select count(*)::int c from public.shuttle_stays where room='105' and revoked_at is null`)).rows[0].c === 1, 'un solo soggiorno attivo per camera');
ok((await db.query(`select revoked_at is not null x from public.shuttle_stays where reservation_id='res-107-a'`)).rows[0].x === true, 'prenotazione sparita dalle presenze: camera chiusa');
const login2 = (await one('anon', null, `select public.shuttle_guest_login('105') j`)).j;
ok(login2.persons === 1, 'il nuovo ospite entra con il numero di camera');

// --- Abilitazione manuale e modalità «tutte le camere»
await expectError(as('authenticated', DEV_R, `select * from public.shuttle_enable_room('999', 2, $1::date)`, [tomorrow]), 'non_valida:Camera non presente', 'camera fuori elenco non abilitabile');
const man = await one('authenticated', DEV_R, `select * from public.shuttle_enable_room('103', 2, $1::date)`, [tomorrow]);
ok(man.source === 'manuale' && man.reservation_id === null, 'reception abilita una camera a mano');
await as('authenticated', DEV_R, `select public.shuttle_sync_rooms($1::jsonb, false)`, [JSON.stringify([{ room: '103', reservationId: 'res-103-a', persons: 2, validUntil: tomorrow }])]);
ok((await db.query(`select source, reservation_id from public.shuttle_stays where id = $1`, [man.id])).rows[0].reservation_id === 'res-103-a', 'la presenza arrivata dopo completa la camera abilitata a mano senza chiuderla');
await as('authenticated', DEV_R, `select * from public.shuttle_save_settings('{"guestAccess":"tutte_le_camere"}'::jsonb)`);
ok(!!(await one('anon', null, `select public.shuttle_guest_login('122') j`)).j.token, 'modalità «tutte le camere»: si entra anche senza presenza');
await as('authenticated', DEV_R, `select * from public.shuttle_save_settings('{"guestAccess":"camere_occupate","rooms":["101","102","103","105","107","108","119","121","122","201"]}'::jsonb)`);
ok((await db.query(`select jsonb_array_length(rooms) n from public.shuttle_settings`)).rows[0].n === 10, 'reception aggiunge una camera all’elenco');
await expectError(as('authenticated', DEV_R, `select * from public.shuttle_save_settings('{"rooms":[]}'::jsonb)`), 'non_valida:Indica almeno una camera', 'elenco camere vuoto rifiutato');

// --- Cambio PIN, dispositivi, scollegamento
await one('authenticated', DEV_R2, `select public.shuttle_staff_login($1) j`, [PIN_R]);
const devs = (await one('authenticated', DEV_R, `select public.shuttle_staff_devices() j`)).j;
ok(devs.find((d) => d.role === 'reception').count === 2 && devs.find((d) => d.role === 'autista').count === 1, 'reception vede i dispositivi collegati per ruolo');
await expectError(as('authenticated', DEV_D, `select public.shuttle_set_pin('autista', '1357')`), 'non_autorizzato', 'l’autista non cambia i PIN');
await expectError(as('authenticated', DEV_R, `select public.shuttle_set_pin('autista', $1)`, [PIN_R]), 'non_valida:Reception e autista devono avere PIN diversi', 'PIN autista uguale alla reception rifiutato');
await as('authenticated', DEV_R, `select public.shuttle_set_pin('autista', '1357')`);
ok((await one('authenticated', DEV_D, `select count(*)::int c from public.shuttle_rides`)).c === 0, 'cambio PIN autista: il dispositivo dell’autista viene scollegato');
ok((await one('authenticated', DEV_D, `select public.shuttle_staff_login('1357') j`)).j.role === 'autista', 'l’autista rientra con il nuovo PIN');
ok((await one('authenticated', DEV_R, `select public.shuttle_disconnect('reception') n`)).n === 1, 'reception scollega gli altri dispositivi reception (non sé stessa)');
ok((await one('authenticated', DEV_R, `select count(*)::int c from public.shuttle_staff`)).c === 1, 'la reception che scollega resta collegata');
await as('authenticated', DEV_D, `select public.shuttle_staff_logout()`);
ok((await one('authenticated', DEV_D, `select count(*)::int c from public.shuttle_rides`)).c === 0, 'blocca: il dispositivo esce');

// --- Pubblicazione realtime e funzioni esposte
const pub = (await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).rows.map((x) => x.tablename).join(',');
ok(pub === 'shuttle_rides,shuttle_stays', `tabelle in realtime: ${pub}`);
const exposed = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'shuttle%' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).rows.map((x) => x.proname).join(',');
ok(exposed === 'shuttle_guest_busy,shuttle_guest_cancel_ride,shuttle_guest_create_ride,shuttle_guest_login,shuttle_guest_rides,shuttle_guest_settings', `funzioni eseguibili da anonimo: ${exposed}`);
const adminExposed = (await db.query(`select has_function_privilege('authenticated', 'public.shuttle_admin_set_pin(text,text)', 'execute') x`)).rows[0].x;
ok(adminExposed === false, 'shuttle_admin_set_pin non eseguibile dall’app');

// --- Lo schema si può rieseguire su un database in uso (aggiornamenti): impostazioni e corse restano
const before = (await db.query(`select destinations::text d, pickup_gap_minutes g, (select count(*)::int from public.shuttle_rides) n from public.shuttle_settings`)).rows[0];
await db.exec(readFileSync(schemaPath, 'utf8'));
const after = (await db.query(`select destinations::text d, pickup_gap_minutes g, (select count(*)::int from public.shuttle_rides) n from public.shuttle_settings`)).rows[0];
ok(before.d === after.d && before.g === after.g && before.n === after.n, 'schema rieseguibile senza perdere impostazioni e corse');

console.log(failures ? `\n${failures} FALLITI` : '\nTutti i controlli SQL superati');
process.exit(failures ? 1 : 0);
