# Aggiornamento delle presenze (La Scatola → Shuttle Hartmann)

Procedura per l'attività pianificata che ogni ora (alle :50, dalle 6:50 alle 18:50) rigenera
`presenze.json`: il file che la reception dello shuttle legge per vedere chi è in casa, chi arriva e
chi parte. Stesso schema dell'app colazioni (`Alpstay/ColazioniSAS`) e di `Alpstay/WelcomeHartmann`.
La **password presenze** che cifra il file NON è in questo repository (è pubblico): viene data nel
testo dell'attività pianificata.

## Regole

- **Solo Chalet Hotel Hartmann**: ogni chiamata a La Scatola usa il `property_id` dell'Hartmann. Il
  programma rifiuta il file se trova righe di un'altra struttura.
- Gli ID ricevuti da Slope / La Scatola non si modificano mai: si copiano identici. Il programma li
  ricontrolla (righe `ATTENZIONE`).
- Nomi e altri dati personali degli ospiti non si stampano, non si riassumono e non si scrivono in nessun
  file del repository. Vivono solo in file privati nello scratchpad e, cifrati, dentro `presenze.json`.
- Si pubblica solo `presenze.json` (oppure, in caso di errore, `stato-presenze.txt`).
  Non modificare `index.html`, `src/`, `supabase/` né `tools/`.
- Se La Scatola non risponde o il programma risponde `ERRORE`: **non pubblicare** `presenze.json`.
  La pagina continua con l'ultimo file riuscito e avvisa da sola quando i dati sono vecchi.

## Dati

- Struttura: Alpstay – Chalet Hotel Hartmann, `property_id` `22222222-2222-4222-8222-222222222222`.
- `G` = oggi nel fuso Europe/Rome (AAAA-MM-GG); il file copre `G` e `G+1`.

## Passi

1. **Prenotazioni** (senza dati personali): con `property_id` dell'Hartmann e `limit 100`
   - `list_in_house` con `date = G` e con `date = G+1`
   - `list_departures` con `date = G` e con `date = G+1`

   Segui `next_cursor` finché non è nullo. Scrivi nello scratchpad `presenze-scatola.json` con TUTTE le
   righe delle quattro chiamate (le doppie si possono lasciare: il programma le unisce se sono identiche),
   ID copiati identici:
   `{"vista": "list_in_house+list_departures", "freshness": <blocco freshness di una delle risposte, così com'è>,
   "rows": [{"reservation_id", "property_id", "room_name", "arrival", "departure", "adults", "children",
   "is_option", "booking_status", "stay_status", "check_in_at", "check_out_at"}, …]}`.
2. **Ospiti registrati** (vista con dati personali, da non mostrare): `query_curated_view` su
   `curated_guest_stays` con filtri `property_id eq <Hartmann>`, `stay_start lte G+1`, `stay_end gte G`,
   `limit 500`.
3. **Intestatari** (vista con dati personali, da non mostrare): `query_curated_view` su
   `curated_reservation_contacts` con filtri `property_id eq <Hartmann>`, `arrival lte G+1`,
   `departure gte G`, `limit 500`.

   Per 2 e 3: se il sistema salva la risposta su file perché grande, usa quel file così com'è. Se la
   risposta arriva nel messaggio, salvala tu in un file dello scratchpad
   `{"vista": "<nome vista>", "total": <page.total>, "rows": [...]}` tenendo solo i campi
   `reservation_id, property_id, guest_type, is_primary_guest, first_name, last_name` (ospiti) oppure
   `reservation_id, property_id, booker_type, first_name, last_name, organization_name` (intestatari).
   Segui `next_cursor` con gli stessi filtri: un file per ogni pagina.
4. **Costruisci**, dalla cartella del repository:
   `node tools/presenze.mjs build "<PASSWORD>" <presenze-scatola.json> <file ospiti…> <file intestatari…>`
   (percorsi separati da spazi o da virgole). Una riga `ATTENZIONE` che parla di ID «trascritto male»
   indica quasi sempre un `reservation_id` copiato male in un file scritto a mano: correggilo e rilancia.
   `PRONTO` = `presenze.json` del repository scritto e ricontrollato.
5. **Verifica**: `node tools/presenze.mjs verify presenze.json "<PASSWORD>"` deve rispondere `verifica OK`.
6. **Pubblica**: `git add presenze.json`, commit `Presenze Hartmann <AAAA-MM-GG HH:MM>`,
   `git push origin HEAD:main`. Se il push è rifiutato perché il repository è cambiato: copia
   `presenze.json` fuori dal repository, `git fetch origin main`, `git reset --hard origin/main`, rimetti
   il file, di nuovo add, commit e push. Una volta sola. Con errore 403 non insistere: scrivilo nel riepilogo.
7. **Se qualcosa non va** (La Scatola non risponde, `ERRORE`, verifica fallita): non pubblicare
   `presenze.json`; scrivi nella radice `stato-presenze.txt` con una sola riga
   `<AAAA-MM-GG HH:MM> non pubblicato · passo <n> · <motivo, senza dati personali>` e pubblica solo quel file
   (commit `Stato presenze <AAAA-MM-GG HH:MM>`).
8. **Riepilogo** breve in italiano con le righe `RIEPILOGO` e `ATTENZIONE` (non contengono nomi).

## Nome mostrato alla reception

Lo decide il programma: «Cognome N.» dell'ospite registrato principale (`is_primary_guest`, oppure
HEAD/SINGLE); senza ospite registrato vale l'intestatario (per le aziende la ragione sociale).
Autista e ospiti non vedono mai i nomi.

## Modifiche al codice

Il programma si genera da `tools/src/presenze-cli.ts` (logica in `src/feed/presenzeFeed.ts`) con
`npm install && npm run build:tools`. Test: `npm test`.
