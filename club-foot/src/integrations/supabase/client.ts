import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variables Supabase manquantes : copier .env.example vers .env et renseigner VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY',
  );
}

// Safari en navigation privee (et les modes "blocage cookies") font lever une
// exception a l'acces a localStorage : sans ce garde-fou, l'init du client
// Supabase casse et plus AUCUNE requete ne part. Repris tel quel de Schproutz,
// ou le bug avait fait tomber les reservations publiques.
function createSafeStorage(): Storage {
  try {
    const testKey = '__sb_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      get length() {
        return memory.size;
      },
      clear: () => memory.clear(),
      getItem: (key) => memory.get(key) ?? null,
      key: (index) => Array.from(memory.keys())[index] ?? null,
      removeItem: (key) => {
        memory.delete(key);
      },
      setItem: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: createSafeStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});
