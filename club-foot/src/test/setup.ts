import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// Les tests ne parlent jamais a un vrai projet Supabase : le client est mocke
// dans chaque fichier qui en a besoin, ces variables evitent juste que
// l'import du module leve au chargement.
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'cle-de-test');
