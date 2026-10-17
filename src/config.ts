/**
 * Configurazione della struttura e dell'ambiente.
 * I valori di ambiente arrivano da `.env` (vedi `.env.example`) e vengono incorporati al build.
 */

/** property_id di Chalet Hotel Hartmann in La Scatola: copiato dalla fonte, da non modificare. */
export const HARTMANN_PROPERTY_ID = '22222222-2222-4222-8222-222222222222';

/** Camere dello Chalet Hotel Hartmann (room_name come in Slope): valore iniziale, poi si gestiscono dalle Impostazioni. */
export const HARTMANN_ROOMS: readonly string[] = ['101', '102', '103', '105', '107', '108', '119', '121', '122'];

export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Indirizzo pubblico dell'app, usato nel QR del cartoncino ospite. */
  publicUrl: string;
}

export function readEnv(): AppEnv {
  const env = import.meta.env;
  return {
    supabaseUrl: String(env.VITE_SUPABASE_URL ?? ''),
    supabaseAnonKey: String(env.VITE_SUPABASE_ANON_KEY ?? ''),
    publicUrl: String(env.VITE_PUBLIC_URL ?? 'https://alpstay.github.io/ShuttleHartmann/'),
  };
}

/** Link diretto per l'ospite: il QR della camera apre l'app già riconosciuta con il numero di camera. */
export function guestLink(publicUrl: string, room: string): string {
  const base = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`;
  return `${base}#/ospite/${encodeURIComponent(room)}`;
}
