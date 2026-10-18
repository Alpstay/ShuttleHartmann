-- =============================================================================
-- Shuttle Chalet Hotel Hartmann · schema Supabase / PostgreSQL
--
-- Principi
--  * Slope (via La Scatola) è la fonte di verità per le presenze: qui si copiano solo
--    room_name e reservation_id, senza mai modificarli.
--  * Le tabelle sono in sola lettura per lo staff (RLS). Ogni scrittura passa da funzioni
--    SECURITY DEFINER che applicano le stesse regole di src/domain/rules.ts.
--  * Accessi con PIN: reception e autista entrano con un PIN di 4 cifre (salvato solo come hash)
--    su una sessione anonima di Supabase Auth; il PIN decide il ruolo.
--  * L'ospite non ha accesso alle tabelle: si riconosce con il numero di camera (solo camere con un
--    soggiorno attivo) e riceve un token di sessione.
--
-- Esecuzione: incollare tutto nell'SQL Editor del progetto Supabase ed eseguire.
-- Lo script è rieseguibile (create or replace / if not exists).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------

create table if not exists public.shuttle_settings (
  id               smallint primary key default 1 check (id = 1),
  rooms            jsonb not null default '["101","102","103","105","107","108","119","121","122"]'::jsonb,
  guest_access     text not null default 'camere_occupate' check (guest_access in ('camere_occupate', 'tutte_le_camere')),
  destinations     jsonb not null,
  seats            int  not null default 8  check (seats between 1 and 60),
  wait_minutes     int  not null default 5  check (wait_minutes between 1 and 30),
  service_start    time not null default '08:00',
  service_end      time not null default '17:30',
  min_lead_minutes int  not null default 15 check (min_lead_minutes between 0 and 240),
  reception_phone  text not null default '+39 0471 774440',
  updated_at       timestamptz not null default now(),
  check (service_start < service_end),
  check (jsonb_typeof(destinations) = 'array'),
  check (jsonb_typeof(rooms) = 'array')
);

-- Aggiunte successive (lo script resta rieseguibile su un database già in uso).
alter table public.shuttle_settings
  add column if not exists pickup_gap_minutes int not null default 20 check (pickup_gap_minutes between 0 and 120),
  -- Pausa di metà giornata (servizio 08:00–11:30 e 14:00–17:30): vuote = nessuna pausa.
  add column if not exists pause_start time default '11:30',
  add column if not exists pause_end   time default '14:00',
  -- Taxi proposto all'ospite fuori orario.
  add column if not exists taxi_name  text not null default 'Taxi Fleur',
  add column if not exists taxi_phone text not null default '+39 335 63 45 264';

insert into public.shuttle_settings (id, destinations)
values (1, '[
  {"id":"seceda","name":"Seceda","place":"Ortisei","active":true,
   "meetingPoint":"Stazione a valle della funivia Ortisei–Seceda","mapLink":"Funivia Ortisei Seceda, Ortisei"},
  {"id":"alpe-di-siusi","name":"Alpe di Siusi","place":"Ortisei","active":true,
   "meetingPoint":"Stazione a valle della cabinovia Ortisei–Alpe di Siusi","mapLink":"Cabinovia Ortisei Alpe di Siusi, Ortisei"},
  {"id":"palmer","name":"Palmer (Campetti scuola)","place":"Ortisei","active":true,"meetingPoint":"","mapLink":""},
  {"id":"col-raiser","name":"Col Raiser (Gardena Ronda/Saslong)","place":"S. Cristina","active":true,
   "meetingPoint":"Stazione a valle della Gardena Ronda (Saslong)","mapLink":"Gardena Ronda Express Saslong, Santa Cristina Valgardena"},
  {"id":"monte-pana","name":"Monte Pana","place":"S. Cristina","active":true,"meetingPoint":"","mapLink":""}
]'::jsonb)
on conflict (id) do nothing;

-- PIN di reception e autista, salvati solo come hash con sale.
create table if not exists public.shuttle_access (
  role       text primary key check (role in ('reception', 'autista')),
  pin_salt   text not null,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);

-- Dispositivi collegati: utente (anonimo) di Supabase Auth che ha inserito un PIN valido.
create table if not exists public.shuttle_staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('reception', 'autista')),
  created_at timestamptz not null default now()
);

create table if not exists public.shuttle_pin_failures (
  id      bigint generated always as identity primary key,
  user_id uuid,
  at      timestamptz not null default now()
);
create index if not exists shuttle_pin_failures_at on public.shuttle_pin_failures (at);

-- Camera abilitata allo shuttle per la durata del soggiorno (l'ospite entra con il numero di camera).
create table if not exists public.shuttle_stays (
  id             uuid primary key default gen_random_uuid(),
  room           text not null check (char_length(room) between 1 and 20),
  reservation_id text,                         -- reservation_id di Slope, invariato
  source         text not null default 'presenze' check (source in ('presenze', 'manuale')),
  synced_at      timestamptz,                  -- ultimo allineamento con le presenze di La Scatola
  persons        int check (persons between 1 and 60),
  valid_from     date not null,
  valid_until    date not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id),
  revoked_at     timestamptz,
  check (valid_from <= valid_until)
);
create unique index if not exists shuttle_stays_one_active_per_room
  on public.shuttle_stays (room) where revoked_at is null;

create table if not exists public.shuttle_rides (
  id                     uuid primary key default gen_random_uuid(),
  stay_id                uuid references public.shuttle_stays (id),
  room                   text not null,
  reservation_id         text,                 -- reservation_id di Slope, invariato
  service_date           date not null,
  ride_time              time not null,
  direction              text not null check (direction in ('andata', 'ritorno')),
  destination_id         text not null,
  destination_name       text not null,
  persons                int  not null check (persons between 1 and 60),
  note                   text check (char_length(note) <= 200),
  created_by             text not null check (created_by in ('ospite', 'reception')),
  status                 text not null default 'richiesta'
                         check (status in ('richiesta', 'confermata', 'sul_posto', 'completata', 'no_show', 'annullata')),
  read_at                timestamptz,
  last_message           text check (last_message in ('arrivato', 'sette_minuti', 'traffico')),
  last_message_at        timestamptz,
  arrived_at             timestamptz,
  completed_at           timestamptz,
  no_show_at             timestamptz,
  cancelled_at           timestamptz,
  cancelled_by           text check (cancelled_by in ('ospite', 'reception', 'autista', 'sistema')),
  charge_decision        text check (charge_decision in ('da_valutare', 'addebitare', 'non_addebitare')),
  conditions_accepted_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists shuttle_rides_day on public.shuttle_rides (service_date, ride_time);
create index if not exists shuttle_rides_stay on public.shuttle_rides (stay_id);

-- Registro immutabile: chi ha fatto cosa e quando (utile per contestazioni sugli addebiti).
create table if not exists public.shuttle_ride_events (
  id              bigint generated always as identity primary key,
  ride_id         uuid not null references public.shuttle_rides (id) on delete cascade,
  kind            text not null check (kind in ('creata', 'messaggio', 'completata', 'no_show', 'annullata', 'addebito')),
  actor           text not null check (actor in ('ospite', 'reception', 'autista', 'sistema')),
  actor_user      uuid,
  message         text,
  charge_decision text,
  at              timestamptz not null default now()
);
create index if not exists shuttle_ride_events_ride on public.shuttle_ride_events (ride_id, at);

create table if not exists public.shuttle_guest_sessions (
  token        uuid primary key default gen_random_uuid(),
  stay_id      uuid not null references public.shuttle_stays (id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.shuttle_login_failures (
  id   bigint generated always as identity primary key,
  room text not null,
  at   timestamptz not null default now()
);
create index if not exists shuttle_login_failures_room on public.shuttle_login_failures (room, at);

-- ---------------------------------------------------------------------------
-- Sicurezza: RLS in sola lettura per lo staff, nessun accesso diretto per gli anonimi
-- ---------------------------------------------------------------------------

alter table public.shuttle_settings       enable row level security;
alter table public.shuttle_access         enable row level security;
alter table public.shuttle_pin_failures   enable row level security;
alter table public.shuttle_staff          enable row level security;
alter table public.shuttle_stays          enable row level security;
alter table public.shuttle_rides          enable row level security;
alter table public.shuttle_ride_events    enable row level security;
alter table public.shuttle_guest_sessions enable row level security;
alter table public.shuttle_login_failures enable row level security;

revoke insert, update, delete, truncate on
  public.shuttle_settings, public.shuttle_staff, public.shuttle_stays, public.shuttle_rides,
  public.shuttle_ride_events, public.shuttle_guest_sessions, public.shuttle_login_failures,
  public.shuttle_access, public.shuttle_pin_failures
from anon, authenticated;
revoke select on public.shuttle_guest_sessions, public.shuttle_login_failures,
  public.shuttle_access, public.shuttle_pin_failures from anon, authenticated;

create or replace function public.shuttle_role()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select role from public.shuttle_staff where user_id = auth.uid()
$$;

drop policy if exists shuttle_staff_self on public.shuttle_staff;
create policy shuttle_staff_self on public.shuttle_staff
  for select to authenticated using (user_id = auth.uid());

drop policy if exists shuttle_settings_staff on public.shuttle_settings;
create policy shuttle_settings_staff on public.shuttle_settings
  for select to authenticated using (public.shuttle_role() is not null);

drop policy if exists shuttle_stays_staff on public.shuttle_stays;
create policy shuttle_stays_staff on public.shuttle_stays
  for select to authenticated using (public.shuttle_role() is not null);

drop policy if exists shuttle_rides_staff on public.shuttle_rides;
create policy shuttle_rides_staff on public.shuttle_rides
  for select to authenticated using (public.shuttle_role() is not null);

drop policy if exists shuttle_ride_events_staff on public.shuttle_ride_events;
create policy shuttle_ride_events_staff on public.shuttle_ride_events
  for select to authenticated using (public.shuttle_role() is not null);

-- ---------------------------------------------------------------------------
-- Funzioni di supporto
-- ---------------------------------------------------------------------------

drop function if exists public.shuttle_issue_pin(text, text, int, date);
drop function if exists public.shuttle_new_pin(text);
drop function if exists public.shuttle_guest_login(text, text);

create or replace function public.shuttle_today()
returns date
language sql stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Europe/Rome')::date
$$;

create or replace function public.shuttle_require_staff(p_roles text[] default array['reception', 'autista'])
returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  r text := public.shuttle_role();
begin
  if r is null or not (r = any (p_roles)) then
    raise exception 'non_autorizzato' using errcode = 'P0001';
  end if;
  return r;
end
$$;

-- Stesse regole di validateRideInput() in src/domain/rules.ts.
create or replace function public.shuttle_ride_problems(
  p_date date, p_time time, p_destination text, p_persons int,
  p_conditions boolean, p_actor text, p_valid_from date, p_valid_until date
)
returns text[]
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  s       public.shuttle_settings;
  today   date := public.shuttle_today();
  now_t   time := (now() at time zone 'Europe/Rome')::time;
  probs   text[] := array[]::text[];
  lead    int;
  dest    jsonb;
begin
  select * into s from public.shuttle_settings where id = 1;

  if p_date is null or p_date < today then
    probs := array_append(probs, 'data_non_valida');
  elsif p_actor = 'ospite' and p_date > today + 1 then
    probs := array_append(probs, 'data_troppo_lontana');
  end if;

  if p_date is not null and p_valid_until is not null
     and (p_date > p_valid_until or p_date < p_valid_from) then
    probs := array_append(probs, 'data_fuori_soggiorno');
  end if;

  if p_time is null then
    probs := array_append(probs, 'orario_non_valido');
  else
    if p_time < s.service_start or p_time > s.service_end
       or (s.pause_start is not null and s.pause_end is not null and s.pause_start < s.pause_end
           and p_time > s.pause_start and p_time < s.pause_end) then
      probs := array_append(probs, 'fuori_orario_servizio');
    end if;
    if p_date = today then
      lead := case when p_actor = 'ospite' then s.min_lead_minutes else 0 end;
      if (extract(hour from p_time) * 60 + extract(minute from p_time))
         < (extract(hour from now_t) * 60 + extract(minute from now_t) + lead) then
        probs := array_append(probs, 'troppo_presto');
      end if;
    end if;
  end if;

  if p_persons is null or p_persons < 1 or p_persons > s.seats then
    probs := array_append(probs, 'persone_non_valide');
  end if;

  select d into dest from jsonb_array_elements(s.destinations) d where d ->> 'id' = p_destination limit 1;
  if dest is null or not coalesce((dest ->> 'active')::boolean, false) then
    probs := array_append(probs, 'destinazione_non_valida');
  end if;

  if p_actor = 'ospite' and not coalesce(p_conditions, false) then
    probs := array_append(probs, 'condizioni_non_accettate');
  end if;

  return probs;
end
$$;

-- Il mezzo è uno solo (stesse regole di checkTrip() in src/domain/rules.ts): un viaggio = stessa data,
-- stesso orario, stesso punto di ritiro (hotel all'andata, impianto al ritorno) e accoglie più camere fino
-- ai posti; due viaggi diversi devono stare ad almeno pickup_gap_minutes di distanza.
create or replace function public.shuttle_trip_problem(
  p_date date, p_time time, p_direction text, p_destination text, p_persons int
)
returns text
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  s    public.shuttle_settings;
  pick text := case when p_direction = 'andata' then 'hotel' else p_destination end;
  same int;
begin
  select * into s from public.shuttle_settings where id = 1;
  select coalesce(sum(r.persons), 0) into same
    from public.shuttle_rides r
   where r.service_date = p_date and r.ride_time = p_time
     and r.status in ('richiesta', 'confermata', 'sul_posto')
     and (case when r.direction = 'andata' then 'hotel' else r.destination_id end) = pick;
  if same > 0 and same + p_persons > s.seats then
    return 'posti_esauriti';
  end if;
  if s.pickup_gap_minutes > 0 and exists (
    select 1 from public.shuttle_rides r
     where r.service_date = p_date
       and r.status in ('richiesta', 'confermata', 'sul_posto')
       and not (r.ride_time = p_time and (case when r.direction = 'andata' then 'hotel' else r.destination_id end) = pick)
       and abs(extract(epoch from (r.ride_time - p_time))) / 60 < s.pickup_gap_minutes
  ) then
    return 'orario_occupato';
  end if;
  return null;
end
$$;

-- Hash del PIN dello staff (SHA-256 con sale casuale). Un PIN di 4 cifre resta indovinabile per
-- tentativi: per questo i tentativi sono limitati in shuttle_staff_login.
create or replace function public.shuttle_pin_hash(p_salt text, p_pin text)
returns text
language sql immutable
as $$
  select encode(sha256(convert_to(p_salt || ':' || p_pin, 'UTF8')), 'hex')
$$;

create or replace function public.shuttle_store_pin(p_role text, p_pin text)
returns void
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  salt text := replace(gen_random_uuid()::text, '-', '');
begin
  if p_role not in ('reception', 'autista') or coalesce(p_pin, '') !~ '^\d{4}$' then
    raise exception 'non_valida:Il PIN deve avere 4 cifre.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.shuttle_access a
              where a.role <> p_role and a.pin_hash = public.shuttle_pin_hash(a.pin_salt, p_pin)) then
    raise exception 'non_valida:Reception e autista devono avere PIN diversi.' using errcode = 'P0001';
  end if;
  insert into public.shuttle_access (role, pin_salt, pin_hash, updated_at)
  values (p_role, salt, public.shuttle_pin_hash(salt, p_pin), now())
  on conflict (role) do update set pin_salt = excluded.pin_salt, pin_hash = excluded.pin_hash, updated_at = now();
end
$$;

create or replace function public.shuttle_actor(p_role text)
returns text
language sql immutable
as $$
  select case when p_role = 'autista' then 'autista' else 'reception' end
$$;

create or replace function public.shuttle_destination_name(p_destination text)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select d ->> 'name' from public.shuttle_settings s, jsonb_array_elements(s.destinations) d
      where s.id = 1 and d ->> 'id' = p_destination limit 1),
    p_destination)
$$;

-- ---------------------------------------------------------------------------
-- Reception
-- ---------------------------------------------------------------------------

create or replace function public.shuttle_save_settings(p jsonb)
returns public.shuttle_settings
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  s public.shuttle_settings;
begin
  perform public.shuttle_require_staff(array['reception']);
  if p ? 'rooms' and (jsonb_typeof(p -> 'rooms') <> 'array' or jsonb_array_length(p -> 'rooms') = 0) then
    raise exception 'non_valida:Indica almeno una camera.' using errcode = 'P0001';
  end if;
  update public.shuttle_settings set
    rooms            = coalesce((select jsonb_agg(distinct trim(r)) from jsonb_array_elements_text(p -> 'rooms') r
                                  where trim(r) <> ''), rooms),
    guest_access     = coalesce(p ->> 'guestAccess', guest_access),
    destinations     = coalesce(p -> 'destinations', destinations),
    seats            = coalesce((p ->> 'seats')::int, seats),
    wait_minutes     = coalesce((p ->> 'waitMinutes')::int, wait_minutes),
    service_start    = coalesce((p ->> 'serviceStart')::time, service_start),
    service_end      = coalesce((p ->> 'serviceEnd')::time, service_end),
    min_lead_minutes = coalesce((p ->> 'minLeadMinutes')::int, min_lead_minutes),
    reception_phone  = coalesce(p ->> 'receptionPhone', reception_phone),
    pickup_gap_minutes = coalesce((p ->> 'pickupGapMinutes')::int, pickup_gap_minutes),
    pause_start      = case when p ? 'pauseStart' then nullif(p ->> 'pauseStart', '')::time else pause_start end,
    pause_end        = case when p ? 'pauseEnd' then nullif(p ->> 'pauseEnd', '')::time else pause_end end,
    taxi_name        = coalesce(p ->> 'taxiName', taxi_name),
    taxi_phone       = coalesce(p ->> 'taxiPhone', taxi_phone),
    updated_at       = now()
  where id = 1
  returning * into s;
  return s;
end
$$;

-- PIN dello staff: da cambiare solo dalla reception (il PIN iniziale si imposta dall'SQL Editor
-- con shuttle_admin_set_pin, che non è esposta all'app). Cambiare un PIN scollega gli altri
-- dispositivi di quel ruolo.
create or replace function public.shuttle_admin_set_pin(p_role text, p_pin text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.shuttle_store_pin(p_role, p_pin);
  delete from public.shuttle_staff where role = p_role;
end
$$;

create or replace function public.shuttle_set_pin(p_role text, p_pin text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.shuttle_require_staff(array['reception']);
  perform public.shuttle_store_pin(p_role, p_pin);
  delete from public.shuttle_staff where role = p_role and user_id <> auth.uid();
end
$$;

-- Accesso con PIN su una sessione anonima di Supabase Auth: il PIN decide il ruolo.
-- Restituisce {"role"} oppure {"error"} (niente eccezioni, così il tentativo fallito resta registrato).
create or replace function public.shuttle_staff_login(p_pin text)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid   uuid := auth.uid();
  r     text;
  mine  int;
  total int;
begin
  if uid is null then
    return json_build_object('error', 'non_autorizzato');
  end if;
  delete from public.shuttle_pin_failures where at < now() - interval '1 day';
  select count(*) into mine from public.shuttle_pin_failures where user_id = uid and at > now() - interval '10 minutes';
  select count(*) into total from public.shuttle_pin_failures where at > now() - interval '10 minutes';
  if mine >= 5 or total >= 30 then
    return json_build_object('error', 'troppi_tentativi');
  end if;
  select a.role into r from public.shuttle_access a
   where a.pin_hash = public.shuttle_pin_hash(a.pin_salt, trim(coalesce(p_pin, ''))) limit 1;
  if r is null then
    insert into public.shuttle_pin_failures (user_id) values (uid);
    return json_build_object('error', 'pin_errato');
  end if;
  delete from public.shuttle_pin_failures where user_id = uid;
  insert into public.shuttle_staff (user_id, role, created_at) values (uid, r, now())
  on conflict (user_id) do update set role = excluded.role, created_at = now();
  return json_build_object('role', r);
end
$$;

create or replace function public.shuttle_staff_logout()
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  delete from public.shuttle_staff where user_id = auth.uid()
$$;

create or replace function public.shuttle_staff_devices()
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.shuttle_require_staff(array['reception']);
  return (
    select json_agg(json_build_object('role', r.role, 'count', coalesce(c.n, 0), 'lastLoginAt', c.last) order by r.role desc)
      from (values ('reception'), ('autista')) r(role)
      left join (select role, count(*)::int n, max(created_at) last from public.shuttle_staff group by role) c on c.role = r.role
  );
end
$$;

create or replace function public.shuttle_disconnect(p_role text)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  perform public.shuttle_require_staff(array['reception']);
  delete from public.shuttle_staff where role = p_role and user_id <> auth.uid();
  get diagnostics n = row_count;
  return n;
end
$$;

-- Allinea le camere attive con le presenze di oggi (inviate dalla reception, che legge La Scatola).
-- p_items: [{"room","reservationId","persons","validUntil"}]. Stessa logica di syncRooms in demoStore.ts.
create or replace function public.shuttle_sync_rooms(p_items jsonb, p_complete boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  it     jsonb;
  act    public.shuttle_stays;
  today  date := public.shuttle_today();
  rm     text;
  res    text;
  pers   int;
  until  date;
begin
  perform public.shuttle_require_staff(array['reception']);
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'non_valida' using errcode = 'P0001';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    rm := trim(it ->> 'room');
    res := it ->> 'reservationId';
    pers := nullif(it ->> 'persons', '')::int;
    until := greatest((it ->> 'validUntil')::date, today);
    continue when coalesce(rm, '') = '' or coalesce(res, '') = '';
    select * into act from public.shuttle_stays where room = rm and revoked_at is null for update;
    if found and (act.reservation_id = res or act.reservation_id is null) then
      update public.shuttle_stays
         set reservation_id = res, source = 'presenze', persons = pers, valid_until = until, synced_at = now()
       where id = act.id;
    else
      if found then
        update public.shuttle_stays set revoked_at = now() where id = act.id;
      end if;
      insert into public.shuttle_stays (room, reservation_id, source, synced_at, persons, valid_from, valid_until, created_by)
      values (rm, res, 'presenze', now(), pers, today, until, auth.uid());
    end if;
  end loop;
  if p_complete then
    update public.shuttle_stays set revoked_at = now()
     where revoked_at is null and source = 'presenze' and reservation_id is not null
       and reservation_id not in (select x ->> 'reservationId' from jsonb_array_elements(p_items) x);
  end if;
end
$$;

-- Abilitazione manuale di una camera (presenza non disponibile).
create or replace function public.shuttle_enable_room(p_room text, p_persons int, p_valid_until date)
returns public.shuttle_stays
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  st    public.shuttle_stays;
  today date := public.shuttle_today();
  rm    text := trim(coalesce(p_room, ''));
begin
  perform public.shuttle_require_staff(array['reception']);
  if not exists (select 1 from public.shuttle_settings s, jsonb_array_elements_text(s.rooms) r where s.id = 1 and r = rm) then
    raise exception 'non_valida:Camera non presente nell''elenco.' using errcode = 'P0001';
  end if;
  select * into st from public.shuttle_stays
   where room = rm and revoked_at is null and today between valid_from and valid_until for update;
  if found then
    update public.shuttle_stays
       set persons = coalesce(p_persons, persons), valid_until = greatest(coalesce(p_valid_until, today), today)
     where id = st.id returning * into st;
    return st;
  end if;
  update public.shuttle_stays set revoked_at = now() where room = rm and revoked_at is null;
  insert into public.shuttle_stays (room, reservation_id, source, persons, valid_from, valid_until, created_by)
  values (rm, null, 'manuale', p_persons, today, greatest(coalesce(p_valid_until, today), today), auth.uid())
  returning * into st;
  return st;
end
$$;

create or replace function public.shuttle_revoke_stay(p_stay uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.shuttle_require_staff(array['reception']);
  update public.shuttle_stays set revoked_at = now() where id = p_stay and revoked_at is null;
end
$$;

create or replace function public.shuttle_reception_create_ride(
  p_room text, p_stay_id uuid, p_reservation_id text,
  p_date date, p_time time, p_direction text, p_destination text, p_persons int, p_note text
)
returns public.shuttle_rides
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  probs text[];
  r     public.shuttle_rides;
begin
  perform public.shuttle_require_staff(array['reception']);
  if coalesce(trim(p_room), '') = '' or p_direction not in ('andata', 'ritorno') then
    raise exception 'non_valida:camera' using errcode = 'P0001';
  end if;
  probs := public.shuttle_ride_problems(p_date, p_time, p_destination, p_persons, true, 'reception', null, null);
  if cardinality(probs) > 0 then
    raise exception 'non_valida:%', array_to_string(probs, ',') using errcode = 'P0001';
  end if;
  insert into public.shuttle_rides (stay_id, room, reservation_id, service_date, ride_time, direction,
                                    destination_id, destination_name, persons, note, created_by)
  values (p_stay_id, trim(p_room), p_reservation_id, p_date, p_time, p_direction,
          p_destination, public.shuttle_destination_name(p_destination), p_persons,
          nullif(left(trim(coalesce(p_note, '')), 200), ''), 'reception')
  returning * into r;
  insert into public.shuttle_ride_events (ride_id, kind, actor, actor_user) values (r.id, 'creata', 'reception', auth.uid());
  return r;
end
$$;

create or replace function public.shuttle_cancel_ride(p_ride uuid)
returns public.shuttle_rides
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r public.shuttle_rides;
begin
  perform public.shuttle_require_staff(array['reception']);
  select * into r from public.shuttle_rides where id = p_ride for update;
  if not found then raise exception 'non_valida' using errcode = 'P0001'; end if;
  if r.status not in ('richiesta', 'confermata', 'sul_posto') then
    raise exception 'stato_non_valido' using errcode = 'P0001';
  end if;
  update public.shuttle_rides
     set status = 'annullata', cancelled_at = now(), cancelled_by = 'reception', updated_at = now()
   where id = p_ride returning * into r;
  insert into public.shuttle_ride_events (ride_id, kind, actor, actor_user) values (r.id, 'annullata', 'reception', auth.uid());
  return r;
end
$$;

create or replace function public.shuttle_set_charge(p_ride uuid, p_decision text)
returns public.shuttle_rides
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  r public.shuttle_rides;
begin
  perform public.shuttle_require_staff(array['reception']);
  if p_decision not in ('da_valutare', 'addebitare', 'non_addebitare') then
    raise exception 'non_valida' using errcode = 'P0001';
  end if;
  select * into r from public.shuttle_rides where id = p_ride for update;
  if not found or r.status <> 'no_show' then
    raise exception 'stato_non_valido' using errcode = 'P0001';
  end if;
  update public.shuttle_rides set charge_decision = p_decision, updated_at = now()
   where id = p_ride returning * into r;
  insert into public.shuttle_ride_events (ride_id, kind, actor, actor_user, charge_decision)
  values (r.id, 'addebito', 'reception', auth.uid(), p_decision);
  return r;
end
$$;

-- ---------------------------------------------------------------------------
-- Autista (consentito anche alla reception, registrata come tale nel log)
-- ---------------------------------------------------------------------------

create or replace function public.shuttle_driver_message(p_ride uuid, p_kind text)
returns public.shuttle_rides
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  who     text := public.shuttle_require_staff();
  r       public.shuttle_rides;
  arrived timestamptz;
begin
  if p_kind not in ('arrivato', 'sette_minuti', 'traffico') then
    raise exception 'non_valida' using errcode = 'P0001';
  end if;
  select * into r from public.shuttle_rides where id = p_ride for update;
  if not found then raise exception 'non_valida' using errcode = 'P0001'; end if;
  if r.status not in ('richiesta', 'confermata', 'sul_posto') then
    raise exception 'stato_non_valido' using errcode = 'P0001';
  end if;
  -- L'attesa parte dal primo «Sono arrivato» e non si azzera con altri messaggi.
  arrived := coalesce(r.arrived_at, case when p_kind = 'arrivato' then now() end);
  update public.shuttle_rides set
    read_at         = coalesce(read_at, now()),
    last_message    = p_kind,
    last_message_at = now(),
    arrived_at      = arrived,
    status          = case when arrived is not null then 'sul_posto' else 'confermata' end,
    updated_at      = now()
  where id = p_ride returning * into r;
  insert into public.shuttle_ride_events (ride_id, kind, actor, actor_user, message)
  values (r.id, 'messaggio', public.shuttle_actor(who), auth.uid(), p_kind);
  return r;
end
$$;

create or replace function public.shuttle_driver_done(p_ride uuid)
returns public.shuttle_rides
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  who text := public.shuttle_require_staff();
  r   public.shuttle_rides;
begin
  select * into r from public.shuttle_rides where id = p_ride for update;
  if not found or r.status not in ('confermata', 'sul_posto') then
    raise exception 'stato_non_valido' using errcode = 'P0001';
  end if;
  update public.shuttle_rides set status = 'completata', completed_at = now(), updated_at = now()
   where id = p_ride returning * into r;
  insert into public.shuttle_ride_events (ride_id, kind, actor, actor_user)
  values (r.id, 'completata', public.shuttle_actor(who), auth.uid());
  return r;
end
$$;

create or replace function public.shuttle_driver_no_show(p_ride uuid)
returns public.shuttle_rides
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  who  text := public.shuttle_require_staff();
  r    public.shuttle_rides;
  wait int;
begin
  select wait_minutes into wait from public.shuttle_settings where id = 1;
  select * into r from public.shuttle_rides where id = p_ride for update;
  if not found or r.status <> 'sul_posto' then
    raise exception 'stato_non_valido' using errcode = 'P0001';
  end if;
  -- Controllo sull'orologio del server: l'attesa massima deve essere trascorsa.
  if now() < r.arrived_at + make_interval(mins => wait) then
    raise exception 'attesa_in_corso' using errcode = 'P0001';
  end if;
  update public.shuttle_rides
     set status = 'no_show', no_show_at = now(), charge_decision = 'da_valutare', updated_at = now()
   where id = p_ride returning * into r;
  insert into public.shuttle_ride_events (ride_id, kind, actor, actor_user)
  values (r.id, 'no_show', public.shuttle_actor(who), auth.uid());
  return r;
end
$$;

-- ---------------------------------------------------------------------------
-- Ospite (anonimo, camera + PIN → token di sessione)
-- ---------------------------------------------------------------------------

-- Restituisce un oggetto con "error" invece di sollevare eccezioni, così il tentativo fallito
-- resta registrato (un'eccezione annullerebbe anche l'insert del fallimento).
create or replace function public.shuttle_guest_login(p_room text)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  st    public.shuttle_stays;
  cfg   public.shuttle_settings;
  fails int;
  tok   uuid;
  rm    text := regexp_replace(coalesce(p_room, ''), '\s+', '', 'g');
  known boolean;
begin
  select * into cfg from public.shuttle_settings where id = 1;
  delete from public.shuttle_login_failures where at < now() - interval '1 day';
  select count(*) into fails from public.shuttle_login_failures
   where room = left(rm, 20) and at > now() - interval '10 minutes';
  if fails >= 5 then
    return json_build_object('error', 'troppi_tentativi');
  end if;

  known := exists (select 1 from jsonb_array_elements_text(cfg.rooms) r where r = rm);
  if known then
    select * into st from public.shuttle_stays
     where room = rm and revoked_at is null
       and public.shuttle_today() between valid_from and valid_until
     limit 1;
    -- Modalità «tutte le camere»: la camera si abilita da sola fino a domani.
    if not found and cfg.guest_access = 'tutte_le_camere' then
      update public.shuttle_stays set revoked_at = now() where room = rm and revoked_at is null;
      insert into public.shuttle_stays (room, source, valid_from, valid_until)
      values (rm, 'manuale', public.shuttle_today(), public.shuttle_today() + 1)
      returning * into st;
    end if;
  end if;
  if st.id is null then
    insert into public.shuttle_login_failures (room) values (left(rm, 20));
    return json_build_object('error', 'camera_non_attiva');
  end if;

  delete from public.shuttle_login_failures where room = rm;
  delete from public.shuttle_guest_sessions where last_seen_at < now() - interval '30 days';
  insert into public.shuttle_guest_sessions (stay_id) values (st.id) returning token into tok;
  return json_build_object('token', tok, 'stay_id', st.id, 'room', st.room,
                           'persons', st.persons, 'valid_until', st.valid_until);
end
$$;

create or replace function public.shuttle_guest_stay(p_token uuid)
returns public.shuttle_stays
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  st public.shuttle_stays;
begin
  select s.* into st
    from public.shuttle_guest_sessions g
    join public.shuttle_stays s on s.id = g.stay_id
   where g.token = p_token and s.revoked_at is null
     and public.shuttle_today() between s.valid_from and s.valid_until;
  if not found then
    raise exception 'sessione_scaduta' using errcode = 'P0001';
  end if;
  update public.shuttle_guest_sessions set last_seen_at = now() where token = p_token;
  return st;
end
$$;

create or replace function public.shuttle_guest_settings(p_token uuid)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  s public.shuttle_settings;
begin
  perform public.shuttle_guest_stay(p_token);
  select * into s from public.shuttle_settings where id = 1;
  return json_build_object(
    'destinations', s.destinations, 'seats', s.seats, 'waitMinutes', s.wait_minutes,
    'serviceStart', to_char(s.service_start, 'HH24:MI'), 'serviceEnd', to_char(s.service_end, 'HH24:MI'),
    'minLeadMinutes', s.min_lead_minutes, 'receptionPhone', s.reception_phone,
    'pickupGapMinutes', s.pickup_gap_minutes,
    'pauseStart', coalesce(to_char(s.pause_start, 'HH24:MI'), ''), 'pauseEnd', coalesce(to_char(s.pause_end, 'HH24:MI'), ''),
    'taxiName', s.taxi_name, 'taxiPhone', s.taxi_phone, 'updatedAt', s.updated_at);
end
$$;

create or replace function public.shuttle_guest_rides(p_token uuid)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  st public.shuttle_stays := public.shuttle_guest_stay(p_token);
begin
  return coalesce((
    select json_agg(to_jsonb(r) - 'reservation_id' order by r.service_date, r.ride_time)
      from public.shuttle_rides r
     where r.stay_id = st.id and r.service_date >= public.shuttle_today()
  ), '[]'::json);
end
$$;

-- Viaggi già prenotati in una data, senza camere: l'ospite sceglie un orario libero.
create or replace function public.shuttle_guest_busy(p_token uuid, p_date date)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.shuttle_guest_stay(p_token);
  return coalesce((
    select json_agg(json_build_object('time', to_char(t.ride_time, 'HH24:MI'), 'pickup', t.pickup, 'persons', t.persons)
                    order by t.ride_time, t.pickup)
      from (select r.ride_time,
                   case when r.direction = 'andata' then 'hotel' else r.destination_id end as pickup,
                   sum(r.persons)::int as persons
              from public.shuttle_rides r
             where r.service_date = p_date and r.status in ('richiesta', 'confermata', 'sul_posto')
             group by 1, 2) t
  ), '[]'::json);
end
$$;

create or replace function public.shuttle_guest_create_ride(
  p_token uuid, p_date date, p_time time, p_direction text, p_destination text,
  p_persons int, p_note text, p_conditions boolean
)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  st    public.shuttle_stays := public.shuttle_guest_stay(p_token);
  probs text[];
  trip  text;
  r     public.shuttle_rides;
begin
  if p_direction not in ('andata', 'ritorno') then
    raise exception 'non_valida' using errcode = 'P0001';
  end if;
  probs := public.shuttle_ride_problems(p_date, p_time, p_destination, p_persons, p_conditions,
                                        'ospite', st.valid_from, st.valid_until);
  if cardinality(probs) > 0 then
    raise exception 'non_valida:%', array_to_string(probs, ',') using errcode = 'P0001';
  end if;
  -- Un ospite alla volta per giorno: due prenotazioni contemporanee non possono superare il controllo insieme.
  perform pg_advisory_xact_lock(hashtext('shuttle_trip_' || p_date::text));
  trip := public.shuttle_trip_problem(p_date, p_time, p_direction, p_destination, p_persons);
  if trip is not null then
    raise exception 'non_valida:%', trip using errcode = 'P0001';
  end if;
  insert into public.shuttle_rides (stay_id, room, reservation_id, service_date, ride_time, direction,
                                    destination_id, destination_name, persons, note, created_by,
                                    conditions_accepted_at)
  values (st.id, st.room, st.reservation_id, p_date, p_time, p_direction,
          p_destination, public.shuttle_destination_name(p_destination), p_persons,
          nullif(left(trim(coalesce(p_note, '')), 200), ''), 'ospite', now())
  returning * into r;
  insert into public.shuttle_ride_events (ride_id, kind, actor) values (r.id, 'creata', 'ospite');
  return to_jsonb(r) - 'reservation_id';
end
$$;

create or replace function public.shuttle_guest_cancel_ride(p_token uuid, p_ride uuid)
returns json
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  st public.shuttle_stays := public.shuttle_guest_stay(p_token);
  r  public.shuttle_rides;
begin
  select * into r from public.shuttle_rides where id = p_ride and stay_id = st.id for update;
  if not found then raise exception 'non_autorizzato' using errcode = 'P0001'; end if;
  -- L'ospite cancella finché l'autista non ha avvisato di essere arrivato (stessa regola di canGuestCancel).
  if r.status not in ('richiesta', 'confermata') then raise exception 'stato_non_valido' using errcode = 'P0001'; end if;
  update public.shuttle_rides
     set status = 'annullata', cancelled_at = now(), cancelled_by = 'ospite', updated_at = now()
   where id = p_ride returning * into r;
  insert into public.shuttle_ride_events (ride_id, kind, actor) values (r.id, 'annullata', 'ospite');
  return to_jsonb(r) - 'reservation_id';
end
$$;

-- ---------------------------------------------------------------------------
-- Permessi sulle funzioni
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
  guest_fns text[] := array['shuttle_guest_login', 'shuttle_guest_settings', 'shuttle_guest_rides',
                            'shuttle_guest_busy', 'shuttle_guest_create_ride', 'shuttle_guest_cancel_ride'];
  staff_fns text[] := array['shuttle_role', 'shuttle_save_settings', 'shuttle_enable_room', 'shuttle_sync_rooms',
                            'shuttle_revoke_stay', 'shuttle_staff_login', 'shuttle_staff_logout', 'shuttle_set_pin',
                            'shuttle_staff_devices', 'shuttle_disconnect',
                            'shuttle_reception_create_ride', 'shuttle_cancel_ride', 'shuttle_set_charge',
                            'shuttle_driver_message', 'shuttle_driver_done', 'shuttle_driver_no_show'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'shuttle\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname = any (guest_fns) then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    elsif f.proname = any (staff_fns) then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end
$$;

-- shuttle_role() è usata dentro le policy RLS: deve restare eseguibile da authenticated (vedi sopra).

-- ---------------------------------------------------------------------------
-- Tempo reale per reception e autista
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.shuttle_rides;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.shuttle_stays;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- PIN iniziali (una volta sola, dall'SQL Editor; non salvare i PIN in nessun file del repository):
--   select public.shuttle_admin_set_pin('reception', '<PIN reception>');
--   select public.shuttle_admin_set_pin('autista',   '<PIN autista>');
-- Poi in Authentication → Sign In / Providers attivare «Allow anonymous sign-ins».
-- Da lì in avanti i PIN si cambiano dalla reception: Impostazioni → Accessi.
-- ---------------------------------------------------------------------------
