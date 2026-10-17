# Testo dell'attività pianificata «Shuttle Hartmann: presenze La Scatola»

Pianificazione: `CRON_TZ=Europe/Rome 50 6-18 * * *` (ogni ora alle :50, dalle 6:50 alle 18:50).
Connettore necessario: La Scatola. La password va sostituita a `<PASSWORD PRESENZE>` solo nel testo
dell'attività, mai in un file del repository.

---

Aggiorna le presenze dello Chalet Hotel Hartmann (AlpStay) con i dati di La Scatola (connettore "La Scatola", dati del gestionale Slope) e pubblicale su GitHub per la reception dello shuttle. Lavori senza nessuno che risponda: non fare domande, segui la procedura e chiudi con un riepilogo.

CONTESTO
- Pagina: repository GitHub Alpstay/ShuttleHartmann (pubblico), online su https://alpstay.github.io/ShuttleHartmann/ . La reception vede chi è in casa, chi arriva e chi parte; le camere con ospiti in casa si attivano da sole per lo shuttle.
- La pagina non può leggere La Scatola da sola: va rigenerato `presenze.json` (cifrato) per oggi e domani.
- Struttura: Alpstay – Chalet Hotel Hartmann, property_id 22222222-2222-4222-8222-222222222222. SOLO questa struttura.
- G = data di oggi nel fuso Europe/Rome.

COSA FARE
1. Collega il repository con lo strumento add_repo (owner "Alpstay", repo "ShuttleHartmann", access "push"), clonalo se non è già presente e allinealo a origin/main (git fetch origin main, poi git reset --hard origin/main).
2. Carica la skill `anthropic-skills:querying-databox` per le regole del connettore La Scatola. Se gli strumenti di La Scatola non risultano disponibili, caricali con ToolSearch.
3. Leggi `tools/AGGIORNA.md` nel repository ed esegui quella procedura passo per passo (in casa e partenze per G e G+1, ospiti registrati e intestatari, poi `node tools/presenze.mjs build`, verifica e pubblicazione).
4. Password presenze per cifrare (argomento PASSWORD di build e verify): <PASSWORD PRESENZE> . Non scriverla in nessun file del repository né nel messaggio di commit.
5. Pubblica con un commit che contiene solo presenze.json, messaggio "Presenze Hartmann <AAAA-MM-GG HH:MM>", e `git push origin HEAD:main`. Dopo il push controlla con `git log origin/main -1` che il tuo commit sia arrivato.

REGOLE CHE NON SI DEROGANO
- Solo dati dello Chalet Hotel Hartmann: ogni chiamata a La Scatola con il suo property_id.
- Non modificare mai gli ID ricevuti da Slope/La Scatola: copiali identici.
- Il repository è pubblico: nomi e dati personali degli ospiti non vanno mai in chiaro in nessun file pubblicato, non vanno stampati nei comandi e non vanno riportati nel riepilogo. I file con i dati personali restano solo nello scratchpad.
- Non modificare index.html, src/, supabase/ né tools/.
- Se La Scatola non risponde o `tools/presenze.mjs` risponde ERRORE: NON pubblicare presenze.json. Scrivi invece nella radice del repository `stato-presenze.txt` con una sola riga `<AAAA-MM-GG HH:MM> non pubblicato · passo <n> · <motivo, senza dati personali>` e pubblica solo quel file (commit "Stato presenze <AAAA-MM-GG HH:MM>"). La pagina online continua con l'ultimo file riuscito.
- Se il push viene rifiutato con errore 403, non riprovare a oltranza: scrivilo nel riepilogo, indicando che l'app Claude su GitHub deve avere accesso al repository ShuttleHartmann.

RIEPILOGO FINALE (in italiano, breve, senza nomi)
- Pubblicato sì/no (con l'identificativo del commit) e orario dei dati di La Scatola.
- Le righe RIEPILOGO stampate dal programma ed eventuali righe ATTENZIONE (solo camere e date).
- Qualsiasi anomalia incontrata, con il testo esatto del messaggio.
