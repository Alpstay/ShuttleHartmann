import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowUpRight, Bell, BellOff, Check, Clock, Globe, Info, LogOut, MapPin, Mountain, Phone, Plus, Users, WifiOff, X } from 'lucide-react';
import { GUEST_STRINGS, LANGS, detectLang, type GuestStrings, type Lang } from '../domain/i18n';
import { canGuestCancel, compareRides, earliestSlot, isOpen, serviceHoursLabel, suggestTimes, suggestedTime, tripClashes, validateRideInput, type RideInputProblem } from '../domain/rules';
import { addDays, formatShortDate, romeDate, romeTime, romeTimeOf, toMinutes } from '../domain/time';
import type { BusySlot, Direction, GuestSession, IsoDate, Ride, RideInput, ShuttleSettings } from '../domain/types';
import { ShuttleError } from '../domain/types';
import { Button, Countdown, InlineConfirm, Pill, STATUS_TONE, Stepper, chime, cx, unlockSound, useApp, useLocalState, useNow, useOnline, useToast } from '../ui/kit';
import { hasMeetingPoint, mapHref } from '../ui/destinations';
import { AlpstayLogo } from '../ui/Logo';
import { PinPad } from '../ui/PinPad';

/**
 * Area ospite, pensata per il telefono: si entra con il numero di camera (o con il QR della camera),
 * si vede la prossima corsa in grande e si prenota in quattro passi con pulsanti grandi.
 */
export function GuestView({ autoLogin, onAutoLoginUsed, sessionKey = 'shuttle-hartmann-guest' }: { autoLogin?: { room: string } | null; onAutoLoginUsed?: () => void; sessionKey?: string }) {
  const { backend } = useApp();
  const [lang, setLang] = useLocalState<Lang>('shuttle-guest-lang', detectLang());
  const t = GUEST_STRINGS[lang];
  const [session, setSession] = useLocalState<GuestSession | null>(sessionKey, null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const tried = useRef(false);

  const login = useCallback(
    async (room: string) => {
      setLoginError(null);
      try {
        setSession(await backend.guest.login(room));
      } catch (e) {
        const code = (e as ShuttleError).code;
        setLoginError(code === 'troppi_tentativi' ? t.tooManyAttempts : code === 'camera_non_attiva' ? t.loginError : (e as Error).message);
      }
    },
    [backend, setSession, t],
  );

  useEffect(() => {
    if (autoLogin && !tried.current && !session) {
      tried.current = true;
      void login(autoLogin.room).finally(() => onAutoLoginUsed?.());
    }
  }, [autoLogin, login, onAutoLoginUsed, session]);

  const langSwitch = (
    <div className="flex rounded-lg bg-surface p-0.5" role="group" aria-label="Lingua · Sprache · Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}
          className={cx('min-h-9 min-w-9 rounded-md px-1.5 text-xs font-bold', lang === l.code ? 'bg-bg shadow-sm ring-1 ring-line' : 'text-muted')}
        >
          {l.label}
        </button>
      ))}
    </div>
  );

  if (!session) {
    return (
      <GuestShell>
        {/* Pagina compatta: logo, titolo e lingua su una riga, tastierino sotto, tutto senza scorrere. */}
        <header className="flex items-center gap-3 px-4 pt-3">
          <AlpstayLogo variant="nome" title="AlpStay" className="h-11 w-auto shrink-0 text-fg" />
          <div className="mr-auto min-w-0">
            <p className="eyebrow truncate">{t.hotel}</p>
            <h1 className="truncate text-[1.35rem] leading-tight text-gold">{t.appTitle}</h1>
          </div>
          {langSwitch}
        </header>
        <GuestLogin t={t} error={loginError} onLogin={login} />
      </GuestShell>
    );
  }

  // In alto c'è poco spazio sul telefono: un solo pulsante che passa da una lingua all'altra.
  const langCycle = (
    <HeaderButton
      label={lang.toUpperCase()}
      aria-label={`Lingua · Sprache · Language: ${lang.toUpperCase()}`}
      title={t.languageShort}
      onClick={() => setLang(LANGS[(LANGS.findIndex((l) => l.code === lang) + 1) % LANGS.length]!.code)}
    >
      <Globe size={22} aria-hidden />
    </HeaderButton>
  );

  return <GuestHome t={t} session={session} langSwitch={langCycle} onLogout={() => setSession(null)} onExpired={() => (setSession(null), setLoginError(t.loginError))} />;
}

function GuestLogin({ t, error, onLogin }: { t: GuestStrings; error: string | null; onLogin: (room: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex flex-col px-4 pb-4 pt-3">
      <PinPad
        compact
        id="guest-room"
        label={t.room}
        hint={t.loginIntro}
        maxLength={6}
        masked={false}
        submitLabel={t.login}
        busy={busy}
        error={error}
        onSubmit={async (room) => {
          setBusy(true);
          await onLogin(room);
          setBusy(false);
        }}
      />
    </main>
  );
}

/**
 * Colonna dell'area ospite: a tutta larghezza sul telefono, centrata e di larghezza comoda su tablet e computer
 * (container query: funziona anche dentro i riquadri del prototipo).
 */
function GuestShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container flex min-h-full flex-col bg-bg">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col @2xl:border-x @2xl:border-line">{children}</div>
    </div>
  );
}

/** Pulsante dell'intestazione: icona grande con la sua parola sotto, area da toccare di almeno 56 px. */
function HeaderButton({ label, active, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'flex min-h-14 min-w-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 text-[0.7rem] font-black uppercase tracking-wide transition-transform active:scale-[0.96] disabled:opacity-45',
        active ? 'bg-fg text-bg' : 'border border-line bg-surface text-fg',
      )}
    >
      {children}
      <span className="leading-none">{label}</span>
    </button>
  );
}

/** Barra in fondo allo schermo, dove arriva il pollice. */
function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 mt-auto border-t border-line bg-bg px-4 pt-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
      {children}
    </div>
  );
}

function GuestHome({ t, session, langSwitch, onLogout, onExpired }: { t: GuestStrings; session: GuestSession; langSwitch: React.ReactNode; onLogout: () => void; onExpired: () => void }) {
  const { backend } = useApp();
  const now = useNow(1000);
  const online = useOnline();
  const [settings, setSettings] = useState<ShuttleSettings | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [sound, setSound] = useLocalState('shuttle-guest-sound', false);
  const [booking, setBooking] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const last = useRef<Map<string, string> | null>(null);

  const handleError = useCallback(
    (e: unknown) => {
      if ((e as ShuttleError).code === 'sessione_scaduta') onExpired();
    },
    [onExpired],
  );

  // Impianti e regole si ricaricano a ogni aggiornamento: le modifiche della reception arrivano senza ricaricare.
  const loadSettings = useCallback(() => backend.guest.settings(session.token).then(setSettings, handleError), [backend, session.token, handleError]);
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const refresh = useCallback(async () => {
    try {
      const list = await backend.guest.rides(session.token);
      // Avviso a ogni novità portata dall'autista (messaggio o stato).
      const sig = new Map(list.map((r) => [r.id, `${r.status}|${r.lastMessage}|${r.lastMessageAt}`]));
      if (last.current) {
        const changed = list.find((r) => last.current!.get(r.id) !== undefined && last.current!.get(r.id) !== sig.get(r.id) && r.lastMessageAt);
        if (changed) {
          setFlash(changed.id);
          if (sound) chime('aggiornamento');
        }
      }
      last.current = sig;
      setRides(list);
      void loadSettings();
    } catch (e) {
      handleError(e);
    }
  }, [backend, session.token, sound, handleError, loadSettings]);


  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), backend.guestPollMs);
    const onVis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh, backend.guestPollMs]);

  const today = romeDate(now);
  const open = useMemo(() => rides.filter((r) => isOpen(r.status)).sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || compareRides(a, b)), [rides]);
  const closedToday = rides.filter((r) => !isOpen(r.status) && r.serviceDate === today);
  const hero = open[0] ?? null;

  const cancel = async (r: Ride) => {
    try {
      await backend.guest.cancelRide(session.token, r.id);
      showToast(t.cancelled);
    } catch (e) {
      handleError(e);
      showToast((e as ShuttleError).code === 'stato_non_valido' ? t.afterConfirmReception : (e as Error).message, 'bad');
    }
    void refresh();
  };

  if (showInfo && settings) return <GuestInfo t={t} settings={settings} onClose={() => setShowInfo(false)} />;

  if (booking && settings) {
    return (
      <BookingWizard
        t={t}
        settings={settings}
        now={now}
        session={session}
        onClose={() => setBooking(false)}
        onBooked={async () => {
          setBooking(false);
          showToast(t.sent);
          await refresh();
        }}
        onError={(e) => {
          handleError(e);
          showToast((e as Error).message, 'bad');
        }}
      />
    );
  }

  return (
    <GuestShell>
      {/* Due righe: in alto logo e pulsanti grandi con la loro parola, sotto il numero di camera ben visibile. */}
      <header className="flex flex-col gap-2 px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <AlpstayLogo variant="simbolo" className="mr-auto h-10 w-auto shrink-0" />
          <HeaderButton
            label={t.soundShort}
            active={sound}
            aria-pressed={sound}
            aria-label={sound ? t.soundOn : t.soundOff}
            title={sound ? t.soundOn : t.soundOff}
            onClick={() => {
              if (!sound) {
                unlockSound();
                chime('aggiornamento');
              }
              setSound(!sound);
            }}
          >
            {sound ? <Bell size={22} aria-hidden /> : <BellOff size={22} aria-hidden />}
          </HeaderButton>
          {langSwitch}
          <HeaderButton label={t.info} aria-label={t.infoTitle} title={t.infoTitle} disabled={!settings} onClick={() => void loadSettings().then(() => setShowInfo(true))}>
            <Info size={22} aria-hidden />
          </HeaderButton>
          <HeaderButton label={t.logout} aria-label={t.logout} title={t.logout} onClick={onLogout}>
            <LogOut size={22} aria-hidden />
          </HeaderButton>
        </div>
        <div>
          <p className="eyebrow">{t.hotel}</p>
          <h1 className="tnum font-title text-[2rem] leading-tight">{t.roomLabel(session.room)}</h1>
        </div>
      </header>
      {toast}
      {!online ? (
        <p className="mx-4 flex items-center gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn">
          <WifiOff size={16} /> {t.offline}
        </p>
      ) : null}

      <main className="flex flex-col gap-4 px-4 pb-4 pt-2">
        {hero && settings ? (
          <HeroRide t={t} ride={hero} settings={settings} now={now} today={today} highlight={flash === hero.id} onCancel={() => void cancel(hero)} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-10 text-center">
            <Mountain size={32} className="text-gold" aria-hidden />
            <p className="text-muted">{t.noRides}</p>
          </div>
        )}

        {open.length > 1 || closedToday.length ? (
          <section aria-labelledby="other-rides" className="flex flex-col gap-2">
            <h2 id="other-rides" className="eyebrow">
              {t.otherRides}
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
              {[...open.slice(1), ...closedToday].map((r) => (
                <CompactRide key={r.id} t={t} ride={r} today={today} onCancel={() => void cancel(r)} />
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      <BottomBar>
        <Button tone="gold" size="xl" className="w-full" disabled={!settings} onClick={() => void loadSettings().then(() => setBooking(true))}>
          <Plus size={22} /> {t.newRide}
        </Button>
      </BottomBar>
    </GuestShell>
  );
}

/** Informazioni generali per l'ospite: orari, come funziona, meeting point, posti, taxi e reception. */
function GuestInfo({ t, settings, onClose }: { t: GuestStrings; settings: ShuttleSettings; onClose: () => void }) {
  const lifts = settings.destinations.filter((d) => d.active);
  const recTel = settings.receptionPhone.replace(/[^\d+]/g, '');
  const taxiTel = settings.taxiPhone.replace(/[^\d+]/g, '');
  return (
    <GuestShell>
      <header className="flex items-center gap-2 px-2 pb-1 pt-3">
        <Button size="md" tone="ghost" aria-label={t.close} onClick={onClose}>
          <ArrowLeft size={22} />
        </Button>
        <h2 className="text-[1.5rem] leading-tight">{t.infoTitle}</h2>
      </header>
      <main className="flex flex-col gap-5 px-4 pb-8 pt-2">
        {recTel ? (
          // In cima, grande: chi apre le informazioni spesso vuole solo parlare con la reception.
          <a href={`tel:${recTel}`} className="flex min-h-16 items-center gap-3 rounded-2xl bg-gold px-4 py-2 text-on-gold shadow-sm active:scale-[0.99]">
            <Phone size={24} className="shrink-0" aria-hidden />
            <span className="flex flex-col leading-tight">
              <span className="text-lg font-bold">{t.callHotel}</span>
              <span className="tnum text-sm">{settings.receptionPhone}</span>
            </span>
          </a>
        ) : null}

        <section className="flex flex-col gap-1.5">
          <h3 className="eyebrow">{t.infoHours}</h3>
          <p className="tnum whitespace-pre-line font-title text-3xl leading-tight">{serviceHoursLabel(settings).replace(' · ', '\n')}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="eyebrow">{t.infoHow}</h3>
          <ol className="flex flex-col gap-2">
            {t.infoSteps(settings.waitMinutes).map((step, i) => (
              <li key={i} className="flex gap-3 rounded-xl bg-surface p-3 leading-snug">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gold font-bold text-on-gold">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted">{t.infoSeats(settings.seats)}</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="eyebrow">{t.infoMeeting}</h3>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
            {lifts.map((d) => (
              <li key={d.id} className="flex items-center gap-3 p-3">
                <MapPin size={20} className="shrink-0 text-gold" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="font-bold">{d.name}</span>
                  <span className="text-sm text-muted">{d.meetingPoint?.trim() || d.place}</span>
                </span>
                <a href={mapHref(d)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm font-bold text-gold underline">
                  {t.openMap}
                </a>
              </li>
            ))}
          </ul>
        </section>

        {settings.taxiPhone.trim() ? (
          <section className="flex flex-col gap-2">
            <h3 className="eyebrow">{t.infoOutside}</h3>
            <a href={`tel:${taxiTel}`} className="flex min-h-14 items-center gap-3 rounded-xl border border-line px-4 py-2">
              <Phone size={20} className="shrink-0 text-gold" aria-hidden />
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-bold">{settings.taxiName || 'Taxi'}</span>
                <span className="tnum text-lg font-bold">{settings.taxiPhone}</span>
              </span>
            </a>
          </section>
        ) : null}

      </main>
    </GuestShell>
  );
}

/** Fuori orario: orari della navetta e taxi da chiamare, con il numero che si tocca per telefonare. */
function TaxiBox({ t, settings, title }: { t: GuestStrings; settings: ShuttleSettings; title?: string }) {
  const tel = settings.taxiPhone.replace(/[^\d+]/g, '');
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-2xl border-2 border-warn bg-warn-soft p-4">
      {title ? (
        <p className="flex items-start gap-2 font-bold text-warn">
          <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden /> {title}
        </p>
      ) : null}
      <p className="tnum text-sm font-bold">{t.serviceHours(serviceHoursLabel(settings))}</p>
      {settings.taxiPhone.trim() ? (
        <>
          <p className="text-sm">{t.taxiHint(settings.taxiName || 'Taxi')}</p>
          <a href={`tel:${tel}`} className="flex min-h-14 items-center justify-center gap-3 rounded-xl bg-fg px-4 py-2 text-bg">
            <Phone size={22} className="shrink-0" aria-hidden />
            <span className="flex flex-col leading-tight">
              {settings.taxiName ? <span className="text-sm font-bold">{settings.taxiName}</span> : null}
              <span className="tnum text-lg font-bold">{settings.taxiPhone}</span>
            </span>
          </a>
        </>
      ) : null}
    </div>
  );
}

/** Meeting point all'impianto con il collegamento alla mappa (solo se la reception l'ha indicato). */
function MeetingPoint({ t, settings, destinationId }: { t: GuestStrings; settings: ShuttleSettings; destinationId: string }) {
  const d = settings.destinations.find((x) => x.id === destinationId);
  if (!d || !hasMeetingPoint(d)) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line p-3">
      <MapPin size={22} className="mt-0.5 shrink-0 text-gold" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="eyebrow">{t.meetingPoint}</p>
        {d.meetingPoint?.trim() ? <p className="font-bold leading-snug">{d.meetingPoint}</p> : null}
        <a href={mapHref(d)} target="_blank" rel="noopener noreferrer" className="self-start text-sm font-bold text-gold underline">
          {t.openMap}
        </a>
      </div>
    </div>
  );
}

function dayLabel(t: GuestStrings, date: IsoDate, today: IsoDate): string {
  return date === today ? t.today : date === addDays(today, 1) ? t.tomorrow : formatShortDate(date);
}

function route(t: GuestStrings, r: Pick<Ride, 'direction' | 'destinationName'>, short = false): string {
  const hotel = short ? 'Hotel' : t.hotelName;
  return r.direction === 'andata' ? `${hotel} → ${r.destinationName}` : `${r.destinationName} → ${hotel}`;
}

function HeroRide({ t, ride: r, settings, now, today, highlight, onCancel }: { t: GuestStrings; ride: Ride; settings: ShuttleSettings; now: number; today: IsoDate; highlight: boolean; onCancel: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const wait = r.status === 'sul_posto' ? (() => {
    const deadline = Date.parse(r.arrivedAt ?? '') + settings.waitMinutes * 60000;
    return { deadline, remaining: Math.max(0, deadline - now) };
  })() : null;
  return (
    <article className={cx('flex flex-col gap-4 rounded-2xl border p-4', highlight ? 'slide-in border-gold shadow-md' : 'border-line')} aria-label={t.nextRide}>
      <p className="eyebrow">{t.nextRide}</p>
      <div className="flex items-end gap-3">
        <div>
          <p className="text-sm font-bold capitalize text-muted">{dayLabel(t, r.serviceDate, today)}</p>
          <p className="tnum font-title text-5xl leading-none">{r.time}</p>
        </div>
        <span className="mb-1 ml-auto inline-flex items-center gap-1 text-muted">
          <Users size={16} aria-hidden /> <span className="tnum font-bold">{r.persons}</span>
        </span>
      </div>
      <p className="flex items-center gap-2 text-lg font-bold">
        {r.direction === 'andata' ? <ArrowUpRight size={20} className="text-gold" aria-hidden /> : <ArrowDownLeft size={20} className="text-gold" aria-hidden />}
        {route(t, r)}
      </p>
      {/* Al ritorno l'ospite deve sapere dove aspettare la navetta all'impianto. */}
      {r.direction === 'ritorno' ? <MeetingPoint t={t} settings={settings} destinationId={r.destinationId} /> : null}

      {r.lastMessage ? (
        <div className="flex items-start gap-3 rounded-xl bg-gold-soft p-4" role="status">
          {r.lastMessage === 'arrivato' ? <Check size={24} className="mt-0.5 shrink-0 text-gold" aria-hidden /> : <Clock size={24} className="mt-0.5 shrink-0 text-gold" aria-hidden />}
          <div className="flex flex-col gap-1">
            <p className="text-lg font-bold leading-snug">{t.driverMessage[r.lastMessage]}</p>
            <p className="tnum text-xs text-muted">{romeTimeOf(r.lastMessageAt)}</p>
          </div>
        </div>
      ) : (
        <p className={cx('self-start rounded-full px-3 py-1 text-sm font-bold', STATUS_TONE[r.status])}>{t.status[r.status]}</p>
      )}

      {wait && wait.remaining > 0 ? (
        <p className="flex items-center gap-2 font-bold">
          {t.waitUntil(romeTime(wait.deadline))}
          <span className="tnum ml-auto rounded-lg bg-surface px-2.5 py-1 text-lg">
            <Countdown ms={wait.remaining} />
          </span>
        </p>
      ) : null}

      {canGuestCancel(r) ? (
        confirm ? (
          <InlineConfirm question={t.cancelConfirm} confirmLabel={t.cancel} cancelLabel={t.keep} onCancel={() => setConfirm(false)} onConfirm={() => (setConfirm(false), onCancel())} />
        ) : (
          <Button size="lg" tone="soft" className="w-full text-bad" onClick={() => setConfirm(true)}>
            <X size={18} /> {t.cancel}
          </Button>
        )
      ) : (
        <p className="text-xs text-muted">{settings.receptionPhone ? t.afterConfirmCall(settings.receptionPhone) : t.afterConfirmReception}</p>
      )}
    </article>
  );
}

function CompactRide({ t, ride: r, today, onCancel }: { t: GuestStrings; ride: Ride; today: IsoDate; onCancel: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className={cx('flex flex-col gap-2 p-3', !isOpen(r.status) && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-bold capitalize text-muted">{dayLabel(t, r.serviceDate, today)}</span>
          <span className="tnum font-title text-xl">{r.time}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{route(t, r, true)}</span>
        <Pill className={STATUS_TONE[r.status]}>{t.status[r.status].split(',')[0]}</Pill>
      </div>
      {canGuestCancel(r) ? (
        confirm ? (
          <InlineConfirm question={t.cancelConfirm} confirmLabel={t.cancel} cancelLabel={t.keep} onCancel={() => setConfirm(false)} onConfirm={() => (setConfirm(false), onCancel())} />
        ) : (
          <Button size="sm" tone="soft" className="self-start text-bad" onClick={() => setConfirm(true)}>
            <X size={14} /> {t.cancel}
          </Button>
        )
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Prenotazione in quattro passi
// ---------------------------------------------------------------------------

function BookingWizard({
  t,
  settings,
  now,
  session,
  onClose,
  onBooked,
  onError,
}: {
  t: GuestStrings;
  settings: ShuttleSettings;
  now: number;
  session: GuestSession;
  onClose: () => void;
  onBooked: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const { backend } = useApp();
  const today = romeDate(now);
  const tomorrow = addDays(today, 1);
  const todayOpen = earliestSlot(settings, now, today, 'ospite') !== null;
  const tomorrowOpen = tomorrow <= session.validUntil;

  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<Direction>('andata');
  const [destinationId, setDestinationId] = useState('');
  const [date, setDate] = useState<IsoDate>(todayOpen ? today : tomorrow);
  const [time, setTime] = useState('');
  const [persons, setPersons] = useState(Math.min(settings.seats, Math.max(1, session.persons ?? 2)));
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<RideInputProblem[]>([]);
  // Viaggi già prenotati quel giorno (solo orario, punto di ritiro e persone): il mezzo è uno solo.
  const [taken, setTaken] = useState<BusySlot[]>([]);
  // Vero finché l'orario è quello proposto dall'app: se è occupato, si sposta da solo al più vicino libero.
  const [timeAuto, setTimeAuto] = useState(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const earliest = earliestSlot(settings, now, date, 'ospite');
  const pickDate = (d: IsoDate) => {
    setDate(d);
    setTime(suggestedTime(settings, now, d, direction, 'ospite') ?? '');
    setTimeAuto(true);
  };
  const pickTime = (v: string) => {
    setTime(v);
    setTimeAuto(false);
  };

  const loadTaken = useCallback(() => backend.guest.busy(session.token, date).then(setTaken, (e: unknown) => onErrorRef.current(e)), [backend, session.token, date]);
  useEffect(() => {
    if (step >= 3) void loadTaken();
  }, [step, loadTaken]);
  useEffect(() => {
    if (!time) setTime(suggestedTime(settings, now, date, direction, 'ospite') ?? '');
  }, [time, settings, now, date, direction]);

  const input: RideInput = { serviceDate: date, time, direction, destinationId, persons, note: note.trim() || null, conditionsAccepted: true };
  const problems = validateRideInput(input, { settings, nowMs: now, actor: 'ospite', stay: { validFrom: today, validUntil: session.validUntil } });
  const trip = time ? tripClashes(input, taken, settings) : { problem: null, clashes: [] };
  const suggestions = trip.problem ? suggestTimes(input, taken, settings, now, 'ospite') : [];

  // Orario proposto dall'app ma già occupato: passa al più vicino disponibile (preferendo un viaggio da condividere).
  useEffect(() => {
    if (!timeAuto || !time) return;
    const best = suggestions
      .map((s) => ({ s, d: Math.abs(toMinutes(s.time) - toMinutes(time)) - (s.join ? 1 : 0) }))
      .sort((a, b) => a.d - b.d)[0];
    if (best) setTime(best.s.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo quando arrivano i viaggi del giorno
  }, [taken]);
  useEffect(() => setServerProblems([]), [time, date, persons, destinationId, direction]);
  const allProblems = [...new Set<RideInputProblem>([...problems, ...(trip.problem ? [trip.problem] : []), ...serverProblems])];
  const timeProblems = problems.filter((p) => p === 'troppo_presto' || p === 'fuori_orario_servizio' || p === 'orario_non_valido' || p === 'data_non_valida' || p === 'data_fuori_soggiorno' || p === 'data_troppo_lontana');
  const dest = settings.destinations.find((d) => d.id === destinationId);
  const total = 4;

  const book = async () => {
    setBusy(true);
    setServerProblems([]);
    try {
      await backend.guest.createRide(session.token, input);
      await onBooked();
    } catch (e) {
      const codes = ((e as Error).message ?? '').split(',').filter((c): c is RideInputProblem => c in t.problems);
      if ((e as ShuttleError).code === 'non_valida' && codes.length) {
        // Un altro ospite ha appena preso quell'orario: si torna alla scelta con gli orari aggiornati.
        if (codes.some((c) => c === 'orario_occupato' || c === 'posti_esauriti')) {
          setStep(3);
          await loadTaken();
        }
        setServerProblems(codes);
      } else onError(e);
    } finally {
      setBusy(false);
    }
  };

  const titles = [t.whereTo, direction === 'andata' ? t.whichLift : t.fromWhichLift, t.whenWho, t.summary];

  return (
    <GuestShell>
      <header className="flex items-center gap-2 px-2 pb-1 pt-3">
        {step > 1 ? (
          <Button size="md" tone="ghost" aria-label={t.back} onClick={() => setStep(step - 1)}>
            <ArrowLeft size={22} />
          </Button>
        ) : (
          <Button size="md" tone="ghost" aria-label={t.close} onClick={onClose}>
            <X size={22} />
          </Button>
        )}
        <div className="flex flex-1 justify-center gap-1.5" aria-label={t.stepOf(step, total)}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={cx('h-1.5 w-8 rounded-full', i < step ? 'bg-gold' : 'bg-line')} />
          ))}
        </div>
        <span className="w-11" aria-hidden />
      </header>

      <main className="flex flex-col gap-4 px-4 pb-4 pt-3">
        <h2 className="text-[1.6rem] leading-tight">{titles[step - 1]}</h2>

        {step === 1 ? (
          <div className="flex flex-col gap-3">
            {(
              [
                ['andata', t.goLift, t.goLiftHint, <ArrowUpRight key="a" size={28} />],
                ['ritorno', t.goHotel, t.goHotelHint, <ArrowDownLeft key="r" size={28} />],
              ] as [Direction, string, string, React.ReactNode][]
            ).map(([d, title, hint, icon]) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDirection(d);
                  setTime(suggestedTime(settings, now, date, d, 'ospite') ?? '');
                  setTimeAuto(true);
                  setStep(2);
                }}
                className={cx('flex min-h-24 items-center gap-4 rounded-2xl border p-4 text-left active:scale-[0.99]', direction === d && destinationId ? 'border-gold bg-gold-soft' : 'border-line')}
              >
                <span className="text-gold">{icon}</span>
                <span className="flex flex-col">
                  <span className="text-xl font-bold">{title}</span>
                  <span className="text-sm text-muted">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-2">
            {settings.destinations
              .filter((d) => d.active)
              .map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setDestinationId(d.id);
                    setStep(3);
                  }}
                  className={cx('flex min-h-16 items-center gap-3 rounded-2xl border px-4 text-left active:scale-[0.99]', destinationId === d.id ? 'border-gold bg-gold-soft' : 'border-line')}
                >
                  <Mountain size={22} className="text-gold" aria-hidden />
                  <span className="flex flex-col leading-tight">
                    <span className="text-lg font-bold">{d.name}</span>
                    <span className="text-sm text-muted">{d.meetingPoint?.trim() ? `${d.place} · ${d.meetingPoint}` : d.place}</span>
                  </span>
                </button>
              ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.day}>
              {[
                { d: today, label: t.today, ok: todayOpen },
                { d: tomorrow, label: t.tomorrow, ok: tomorrowOpen },
              ].map((o) => (
                <button
                  key={o.d}
                  type="button"
                  role="radio"
                  aria-checked={date === o.d}
                  disabled={!o.ok}
                  onClick={() => pickDate(o.d)}
                  className={cx('min-h-14 rounded-2xl border text-lg font-bold disabled:opacity-40', date === o.d ? 'border-gold bg-gold-soft' : 'border-line')}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {!todayOpen ? (
              <div className="-mt-2 flex flex-col gap-2">
                <p className="text-sm text-muted">{t.noSlots}</p>
                <TaxiBox t={t} settings={settings} />
              </div>
            ) : null}
            <div>
              <label htmlFor="guest-time" className="eyebrow mb-1.5 block">
                {t.time}
              </label>
              <input
                id="guest-time"
                type="time"
                step={300}
                min={earliest ?? settings.serviceStart}
                max={settings.serviceEnd}
                value={time}
                onChange={(e) => pickTime(e.target.value)}
                className="tnum h-16 w-full rounded-2xl border border-line bg-bg px-4 text-center font-title text-4xl"
              />
              <p className="tnum mt-1.5 text-sm text-muted">{serviceHoursLabel(settings)}</p>
            </div>
            {time && timeProblems.includes('fuori_orario_servizio') ? <TaxiBox t={t} settings={settings} title={t.outOfServiceTitle} /> : null}
            {time && trip.problem && !timeProblems.length ? (
              <div role="alert" className="-mt-2 flex flex-col gap-3 rounded-2xl border-2 border-warn bg-warn-soft p-4">
                <p className="flex items-start gap-2 font-bold text-warn">
                  <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden />
                  {trip.problem === 'posti_esauriti' ? t.fullTitle : t.busyTitle}
                </p>
                {suggestions.length ? (
                  <>
                    <p className="text-sm">{t.busyHint}</p>
                    <div className="flex flex-wrap gap-2" aria-label={t.freeTimes}>
                      {suggestions.map((s) => (
                        <button
                          key={s.time}
                          type="button"
                          onClick={() => pickTime(s.time)}
                          className="flex min-h-12 min-w-20 flex-col items-center justify-center rounded-xl border border-line bg-bg px-3 py-1 font-bold active:scale-[0.97]"
                        >
                          <span className="tnum text-lg leading-tight">{s.time}</span>
                          {s.join ? <span className="text-[0.7rem] leading-tight text-muted">{t.joinTrip}</span> : null}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm">{t.noFreeTimes}</p>
                )}
              </div>
            ) : null}
            <div>
              <p className="eyebrow mb-1.5">{t.persons}</p>
              <Stepper label={t.persons} value={persons} min={1} max={settings.seats} onChange={setPersons} />
            </div>
            {time && timeProblems.length && !timeProblems.includes('fuori_orario_servizio') ? (
              <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-bold text-bad">
                {t.problems[timeProblems[0] as RideInputProblem]}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
              <p className="flex items-center gap-2 text-lg font-bold">
                {direction === 'andata' ? <ArrowUpRight size={20} className="text-gold" aria-hidden /> : <ArrowDownLeft size={20} className="text-gold" aria-hidden />}
                {route(t, { direction, destinationName: dest?.name ?? '' })}
              </p>
              <div className="flex items-end gap-4">
                <div>
                  <p className="text-sm font-bold capitalize text-muted">{dayLabel(t, date, today)}</p>
                  <p className="tnum font-title text-4xl leading-none">{time}</p>
                </div>
                <span className="mb-1 inline-flex items-center gap-1">
                  <Users size={16} aria-hidden /> <span className="tnum font-bold">{persons}</span>
                </span>
                <button type="button" onClick={() => setStep(3)} className="mb-1 ml-auto text-sm font-bold text-gold underline">
                  {t.changeTime}
                </button>
              </div>
            </div>

            {direction === 'ritorno' ? <MeetingPoint t={t} settings={settings} destinationId={destinationId} /> : null}

            {noteOpen ? (
              <div>
                <label htmlFor="guest-note" className="eyebrow mb-1.5 block">
                  {t.note}
                </label>
                <input id="guest-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} className="min-h-12 w-full rounded-xl border border-line bg-bg px-3.5 text-base" />
              </div>
            ) : (
              <button type="button" onClick={() => setNoteOpen(true)} className="self-start text-sm font-bold text-muted underline">
                + {t.addNote}
              </button>
            )}

            <p className="rounded-2xl bg-surface p-4 text-sm leading-relaxed">{t.conditions(settings.waitMinutes)}</p>

            {allProblems.length ? (
              <ul role="alert" className="flex flex-col gap-1 rounded-xl bg-bad-soft p-3 text-sm font-bold text-bad">
                {allProblems.map((p) => (
                  <li key={p}>{t.problems[p]}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </main>

      {step >= 3 ? (
        <BottomBar>
          {step === 3 ? (
            <Button tone="dark" size="xl" className="w-full" disabled={!time || timeProblems.length > 0 || !!trip.problem} onClick={() => setStep(4)}>
              {t.next}
            </Button>
          ) : (
            <Button tone="gold" size="xl" className="w-full" disabled={busy || allProblems.length > 0} onClick={() => void book()}>
              <Check size={22} /> {busy ? t.sending : t.acceptAndBook}
            </Button>
          )}
        </BottomBar>
      ) : null}
    </GuestShell>
  );
}
