-- Aggiornamento impianti (ottobre 2026), da eseguire nell'SQL Editor di Supabase su un database già in uso
-- (si può rieseguire senza danni): Col Raiser diventa «Col Raiser (Gardena Ronda/Saslong)», Resciesa viene
-- tolta, si aggiunge «Palmer (Campetti scuola)» e ogni impianto riceve i campi del meeting point (stazione a
-- valle dove nota; quelli già compilati dalla reception non si toccano). Per Col Raiser il punto d'incontro è la
-- stazione a valle della Gardena Ronda (Saslong): corregge anche la prima versione «cabinovia Col Raiser».
-- Gli altri impianti e l'ordine restano. Se manca, imposta il telefono dell'hotel per «Telefona in hotel».
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

-- Meeting point: si aggiunge solo dove manca (i valori scritti dalla reception restano).
update public.shuttle_settings s
set destinations = (
      select jsonb_agg(
               case when e.d ->> 'id' = 'col-raiser'
                         and coalesce(e.d ->> 'meetingPoint', '') in ('', 'Stazione a valle della cabinovia Col Raiser')
                         and coalesce(e.d ->> 'mapLink', '') in ('', 'Cabinovia Col Raiser, Santa Cristina Valgardena')
                    then e.d || '{"meetingPoint":"Stazione a valle della Gardena Ronda (Saslong)","mapLink":"Gardena Ronda Express Saslong, Santa Cristina Valgardena"}'::jsonb
                    when e.d ? 'meetingPoint' then e.d
                    else e.d || case e.d ->> 'id'
                      when 'seceda' then '{"meetingPoint":"Stazione a valle della funivia Ortisei–Seceda","mapLink":"Funivia Ortisei Seceda, Ortisei"}'::jsonb
                      when 'alpe-di-siusi' then '{"meetingPoint":"Stazione a valle della cabinovia Ortisei–Alpe di Siusi","mapLink":"Cabinovia Ortisei Alpe di Siusi, Ortisei"}'::jsonb
                      else '{"meetingPoint":"","mapLink":""}'::jsonb
                    end
               end
               order by e.o)
        from jsonb_array_elements(s.destinations) with ordinality as e(d, o)
    ),
    updated_at = now()
where id = 1 and jsonb_array_length(destinations) > 0;

-- Telefono dell'hotel per il pulsante «Telefona in hotel» nelle informazioni dell'ospite (solo se ancora vuoto).
update public.shuttle_settings set reception_phone = '+39 0471 774440', updated_at = now()
 where id = 1 and coalesce(trim(reception_phone), '') = '';

select string_agg(d ->> 'name' || coalesce(nullif(' → ' || (d ->> 'meetingPoint'), ' → '), ''), ' · ') as impianti
  from public.shuttle_settings, jsonb_array_elements(destinations) d
 where id = 1;
