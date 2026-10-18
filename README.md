# Shuttle Hartmann

Servizio navetta dello Chalet Hotel Hartmann verso gli impianti di risalita, su tre livelli:

Tre indirizzi distinti (ognuno con il suo titolo, comodo come icona sulla schermata Home del telefono):

| Area | Indirizzo | Chi | Accesso |
| --- | --- | --- | --- |
| Ospite | `…/ShuttleHartmann/ospite` (o QR della camera `#/ospite/105`) | ospiti in casa | numero di camera |
| Reception | `…/ShuttleHartmann/reception` | banco reception | solo PIN reception |
| Autista | `…/ShuttleHartmann/autista` | telefono sul mezzo | solo PIN autista |

Gli indirizzi brevi sono cartelle con una pagina che rimanda a `#/ospite`, `#/reception` e `#/autista`.
Su un indirizzo dello staff il PIN dell'altra area non apre nulla: la pagina indica l'indirizzo giusto.
Resta anche `#/staff`, dove il PIN decide l'area.

Pagina: `https://alpstay.github.io/ShuttleHartmann/` (GitHub Pages, file unico `index.html`).

## Come funziona

1. **Camere attive**: la reception, ogni volta che rilegge le presenze, attiva da sola le camere con ospiti
   in casa fino al giorno di partenza e le chiude a fine soggiorno o al cambio ospite. Una camera senza
   presenza si attiva a mano da «Presenze». Il cartoncino con il QR della camera apre l'area ospite già
   riconosciuta (si può lasciare in camera: vale per ogni soggiorno).
2. **Ospite** (telefono) entra con il numero di camera e vede la prossima corsa in grande, con il messaggio
   dell'autista. «Prenota una corsa» apre quattro passi a tutto schermo: dove (agli impianti / in hotel),
   quale impianto, quando e quante persone, riepilogo con le condizioni e un solo pulsante «Accetto e
   prenoto» (attesa massima 5 minuti, la corsa non utilizzata può essere addebitata). Con «Cancella corsa»
   può cancellare finché l'autista non l'ha avvisato di essere arrivato: autista e reception ricevono subito
   un avviso con suono. Dopo l'arrivo dell'autista cancella solo la reception.
   Pagina a colonna unica: a tutta larghezza sul telefono, centrata su tablet e computer; in alto pulsanti
   grandi con la loro parola (*Avvisi*, lingua, *Info*, *Esci*) e sotto il numero di camera. *Info* apre le
   informazioni generali: in cima il pulsante **Telefona in hotel**, poi orari, come funziona, posti, meeting
   point di ogni impianto con la mappa e il taxi fuori orario.
   **Il mezzo è uno solo**: se all'orario scelto la navetta è già impegnata (un altro impianto, o un altro
   orario a meno di 20 minuti) l'orario è bloccato e compaiono gli orari liberi più vicini, compreso il
   viaggio già previsto dallo stesso punto («con altri ospiti»). Il controllo si ripete sul server.
3. **Autista** (telefono, grafica ad alto contrasto: verde, schede crema, caratteri pieni, un colore per
   impianto) tocca «Inizia il turno» (suono degli avvisi e schermo sempre acceso) e vede **un elenco per
   orario**: ogni viaggio con orario, punto di ritiro colorato, camere con il **nome dell'ospite** («105 Meyer S.»)
   e persone, e a destra la **spunta**
   per segnarlo fatto (due tocchi, per non sbagliare). Le corse già chiuse restano al loro orario con la
   spunta verde (o la croce rossa se l'ospite non si è presentato). Le camere con lo stesso orario e lo stesso
   punto di ritiro sono un unico viaggio. **Toccando un viaggio** si apre la scheda grande con un solo
   pulsante alla volta: *Sto andando* (l'ospite legge «arrivo fra 7 minuti»; vale come conferma di lettura)
   → *Sono arrivato* (parte l'attesa di 5 minuti; c'è anche *C'è traffico*) → **Fatto!**; trascorsa l'attesa,
   *Non si è presentato*. Due viaggi nella stessa fascia in posti diversi sono segnalati in arancio.
   **7 minuti prima dell'orario** suona l'avviso «Parti ora» (suono e vibrazione, una volta per viaggio) e il
   luogo del pick-up lampeggia, finché l'autista non è sul posto (al massimo 30 minuti dopo l'orario).
   Una corsa cancellata dall'ospite o annullata dalla reception compare in un avviso rosso con allarme.
   **Nomi degli ospiti**: arrivano dalle presenze cifrate, come in reception. Sul telefono del mezzo si
   inserisce una volta la password presenze (nella schermata «Inizia il turno»; è facoltativa: senza, l'autista
   vede le sole camere). Il nome si abbina solo con il `reservation_id` di Slope della corsa: una corsa senza
   prenotazione collegata (camera attivata a mano) mostra la sola camera, mai il nome di un altro ospite.
4. **Reception** vede una sola lista con le camere: per ognuna nome dell'ospite, andata e ritorno del
   giorno con la spunta *fatto* / *non fatto*, orario, impianto, persone e una riga di stato (non letta,
   messaggio dell'autista, autista sul posto con il conto alla rovescia, non presentato con *Addebita* /
   *Nessun addebito*, cancellata dall'ospite con l'orario). Quando un ospite cancella compare un avviso
   con suono. Toccando una corsa si aprono lo storico (chi, cosa, a che ora) e *Annulla*;
   toccando il numero di camera si aprono QR, attivazione dello shuttle e *Corsa per la camera*.
   Le corse in viaggi sovrapposti mostrano *Mezzo già impegnato* con l'altra camera. Nella nuova corsa la
   reception vede l'avviso e gli orari liberi, ma può inserire comunque (per esempio con un taxi).
   **Corsa extra** per chi non è ospite dell'Hartmann: in *Nuova corsa* si sceglie *+ Extra (non ospite)* al posto
   della camera e si scrive nome o riferimento (obbligatorio) e telefono (facoltativo). La corsa compare in una
   riga *Extra* in fondo alla lista e all'autista come «Extra · nome», con le stesse regole del mezzo unico.
   Tecnicamente è una corsa con camera `EXTRA`, senza soggiorno né prenotazione; il nome apre la nota.

## Architettura

```
La Scatola (Slope) ──attività pianificata ogni ora──▶ presenze.json (cifrato, solo Hartmann)
                                                          │
GitHub Pages  index.html ◀── reception (password presenze, rilettura ogni 5 min)
      │
      └── Supabase: corse, PIN, storico ◀── ospite (RPC con token), autista e reception (tempo reale)
```

- **Presenze e partenze**: stesso meccanismo del counter colazioni (`Alpstay/ColazioniSAS`) e di
  `Alpstay/WelcomeHartmann`. Procedura in `tools/AGGIORNA.md`, programma `tools/presenze.mjs`.
  Il programma rifiuta qualsiasi riga che non sia del `property_id` Hartmann e non pubblica se trova
  ID incoerenti. Nomi, camere e ID sono cifrati (AES-GCM, chiave da password con PBKDF2).
- **Corse e accessi**: Supabase (PostgreSQL). Le tabelle sono in sola lettura per lo staff; ogni scrittura
  passa da funzioni che applicano le regole sul server (orario del server per i 5 minuti, stati, ruoli).
  Lo staff entra con il PIN su una sessione anonima di Supabase Auth: i PIN sono salvati solo come hash,
  blocco dopo 5 PIN errati per dispositivo (30 in tutto) in 10 minuti. L'ospite non vede le tabelle: usa
  solo le funzioni `shuttle_guest_*` con il token di sessione, legato al soggiorno della camera.
- **ID di Slope**: `reservation_id` e `room_name` si copiano invariati ovunque.

## Messa in produzione

1. **Supabase** (progetto nuovo, regione UE): SQL Editor → incolla ed esegui `supabase/schema.sql`.
   Poi, sempre nell'SQL Editor, imposta i PIN iniziali (scrivili solo lì, mai in un file del repository):
   `select public.shuttle_admin_set_pin('reception', '<PIN reception>');` e
   `select public.shuttle_admin_set_pin('autista', '<PIN autista>');`.
   In *Authentication → Sign In / Providers* attiva **Allow new users to sign up** e **Allow anonymous sign-ins**
   (l'accesso anonimo conta come iscrizione) e disattiva il provider **Email**, che lo shuttle non usa.
2. **Repository** `Alpstay/ShuttleHartmann` (pubblico, come WelcomeHartmann) con GitHub Pages su `main`, radice.
3. **Build**: copia `.env.example` in `.env`, inserisci URL e Publishable key di Supabase, poi
   `npm install && npm run build` → `index.html`. Pubblica `index.html`, le cartelle `ospite/`, `reception/`,
   `autista/` e `tools/`.
4. **Attività pianificata** delle presenze: testo pronto in `tools/ATTIVITA.md` (ogni ora alle :50, 6:50–18:50).
5. **Primo giorno**: la reception entra da `…/reception` con il suo PIN e sblocca le presenze con la password
   (una volta per dispositivo): le camere in casa si attivano da sole. L'autista entra da `…/autista` con il
   suo PIN sul telefono del mezzo, inserisce una volta la password presenze per i nomi degli ospiti e attiva
   suono e schermo acceso.

## Programma Impostazioni (reception)

- **Accessi**: cambio PIN reception e autista (devono essere diversi; cambiarne uno scollega gli altri
  dispositivi di quel ruolo), dispositivi collegati per ruolo con «Scollega», ingresso ospiti
  («solo camere con ospiti in casa» oppure «tutte le camere dell'elenco» se le presenze non arrivano).
- **Camere**: elenco delle camere (numero come in Slope), aggiungi o togli.
- **Impianti**: nome, località, attivo o no. Le modifiche arrivano agli ospiti al successivo
  aggiornamento della pagina (e comunque all'apertura di «Prenota una corsa») e all'autista entro un minuto.
- **Servizio**: posti sul mezzo, attesa massima, anticipo minimo, **tempo tra due viaggi del mezzo**
  (20 minuti; 0 = nessun controllo), prima e ultima corsa.
- **Ospiti**: telefono dell'hotel (+39 0471 774440) per il pulsante *Telefona in hotel* nelle informazioni,
  taxi fuori orario (Taxi Fleur) e anteprima delle condizioni in IT/DE/EN.

## Aggiornare il database già in uso

`supabase/schema.sql` si può rieseguire su un database in uso: impostazioni, corse e PIN restano. Dopo un
aggiornamento del codice: SQL Editor → incolla ed esegui di nuovo tutto `schema.sql`. Le modifiche ai dati
iniziali si fanno con script a parte, da eseguire una volta (es. `supabase/aggiorna-impianti-2026-10.sql`).

## Sviluppo

```
npm install
npm run dev            # app di produzione (serve .env)
npm run dev:demo       # prototipo con dati di esempio
npm test               # regole, presenze cifrate, flusso completo
npm run test:sql       # schema Supabase su PostgreSQL incorporato (permessi, RLS, regole)
npm run build:tools    # rigenera tools/presenze.mjs da tools/src/presenze-cli.ts
npm run build:demo     # prototipo a file unico per claude.ai (PIN del prototipo in .env.demo.local)
```

Codice TypeScript in `src/`: regole in `src/domain/rules.ts` (rispecchiate in `supabase/schema.sql`),
formato presenze in `src/feed/presenzeFeed.ts`, interfacce in `src/views/`. Il logo AlpStay è vettoriale
in `src/ui/Logo.tsx` (ricostruito dal file ufficiale: barre oro con il gradiente originale, scritta nel
colore del testo per la modalità scura) nelle varianti `completo`, `nome` e `simbolo`.

## Limiti da conoscere

- L'ospite si riconosce con il solo numero di camera: chi conosce un numero di camera in casa può prenotare
  a suo nome. Le camere sono attive solo con ospiti in casa e ogni corsa ha lo storico, ma prima di
  addebitare un non presentato conviene sentire l'ospite.
- L'avviso all'autista e il messaggio all'ospite arrivano con la pagina aperta (anche in secondo piano).
  Con il telefono bloccato da tempo l'ospite vede l'aggiornamento appena riapre la pagina.
  Per una notifica anche a pagina chiusa il passo successivo è l'invio via WhatsApp con il risponditore
  AlpStay (Meta Cloud API).
- L'addebito di un non presentato si registra a mano in Slope: la piattaforma segna solo la decisione.
- I nomi all'autista valgono quanto il file delle presenze: se l'attività pianificata non gira, gli ospiti
  arrivati dopo l'ultimo aggiornamento compaiono con la sola camera (il nome di chi c'era resta corretto,
  perché l'abbinamento è per prenotazione).
- L'avviso «Parti ora» scatta 7 minuti prima per tutti gli impianti (`DEPART_ALERT_MINUTES` in
  `src/domain/rules.ts`). Per Col Raiser e Monte Pana (S. Cristina) il tragitto dall'hotel è più lungo:
  se serve, il passo successivo è un anticipo per impianto nelle *Impostazioni*.
- Gli impianti iniziali (Seceda, Alpe di Siusi, Palmer (Campetti scuola), Col Raiser (Gardena Ronda/Saslong),
  Monte Pana) si modificano da
  *Impostazioni*, come posti del mezzo, attesa massima, orari e anticipo minimo.
