import { HOTEL_PICKUP } from '../domain/rules';
import type { ShuttleSettings } from '../domain/types';

/**
 * Colore fisso per ogni punto di ritiro, come le etichette colorate del riferimento grafico: l'autista
 * riconosce l'impianto a colpo d'occhio. Tutti scuri abbastanza per il testo bianco in grassetto.
 */
const KNOWN: Record<string, string> = {
  [HOTEL_PICKUP]: '#8A682C',
  seceda: '#3D6DB5',
  'alpe-di-siusi': '#A63F2B',
  palmer: '#B3570C',
  'col-raiser': '#5F5E0E',
  'monte-pana': '#AE3576',
};

/** Impianti aggiunti dalla reception: colori di riserva, assegnati in base alla posizione nell'elenco. */
const EXTRA = ['#5F52A6', '#2F7A75', '#8A6400', '#B4473F', '#3F6F3A'];

export function destinationColor(id: string, settings?: Pick<ShuttleSettings, 'destinations'> | null): string {
  const known = KNOWN[id];
  if (known) return known;
  const index = settings?.destinations.findIndex((d) => d.id === id) ?? -1;
  const n = index >= 0 ? index : [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return EXTRA[n % EXTRA.length]!;
}
