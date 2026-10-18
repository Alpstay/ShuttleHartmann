-- Aggiornamento impianti (ottobre 2026), da eseguire una volta nell'SQL Editor di Supabase
-- su un database già in uso: Col Raiser diventa «Col Raiser (Gardena Ronda/Saslong)», Resciesa viene tolta,
-- si aggiunge «Palmer (Campetti scuola)». Gli altri impianti e l'ordine restano come sono.
-- Le corse già registrate non cambiano: ognuna conserva il nome dell'impianto con cui è stata prenotata.
update public.shuttle_settings s
set destinations = (
      select coalesce(jsonb_agg(
               case when e.d ->> 'id' = 'col-raiser'
                    then jsonb_set(e.d, '{name}', '"Col Raiser (Gardena Ronda/Saslong)"')
                    else e.d end
               order by e.o), '[]'::jsonb)
        from jsonb_array_elements(s.destinations) with ordinality as e(d, o)
       where e.d ->> 'id' <> 'resciesa'
    )
    || case when exists (select 1 from jsonb_array_elements(s.destinations) x where x ->> 'id' = 'palmer')
            then '[]'::jsonb
            else '[{"id":"palmer","name":"Palmer (Campetti scuola)","place":"Ortisei","active":true}]'::jsonb
       end,
    updated_at = now()
where id = 1;

select string_agg(d ->> 'name', ' · ') as impianti
  from public.shuttle_settings, jsonb_array_elements(destinations) d
 where id = 1;
