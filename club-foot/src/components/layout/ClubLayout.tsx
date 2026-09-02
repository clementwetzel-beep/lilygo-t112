import { NavLink, Outlet, useParams } from 'react-router-dom';
import { CalendarDays, ClipboardCheck, FileText, Home, LogOut, MessagesSquare } from 'lucide-react';
import { useAuth, useSignOut } from '@/hooks/useAuth';
import { useClub } from '@/hooks/useClub';
import { useClubAccess } from '@/hooks/useClubAccess';
import { useNonLus, useMessagesRealtime } from '@/hooks/useMessagerie';
import { totalNonLus } from '@/lib/messaging';
import { roleLabel } from '@/lib/access';
import { cn } from '@/lib/cn';

interface Onglet {
  to: string;
  label: string;
  icone: typeof Home;
  /** L'accueil ne doit pas rester actif sur les sous-routes. */
  exact?: boolean;
}

const ONGLETS: Onglet[] = [
  { to: '', label: 'Accueil', icone: Home, exact: true },
  { to: 'planning', label: 'Planning', icone: CalendarDays },
  { to: 'sondages', label: 'Sondages', icone: ClipboardCheck },
  { to: 'administratif', label: 'Dossier', icone: FileText },
  { to: 'messages', label: 'Messages', icone: MessagesSquare },
];

export function ClubLayout() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { data: club } = useClub(slug);
  const { role } = useClubAccess(slug, user?.id);
  const { data: compteurs } = useNonLus(club?.id);
  const signOut = useSignOut();

  useMessagesRealtime(club?.id);

  const nonLus = totalNonLus(compteurs ?? []);

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{club?.name ?? 'Mon club'}</p>
            <p className="text-xs text-slate-500">
              {club?.saison} · {roleLabel(role)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Se deconnecter"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-24">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl">
          {ONGLETS.map(({ to, label, icone: Icone, exact }) => (
            <NavLink
              key={label}
              to={to ? `/club/${slug}/${to}` : `/club/${slug}`}
              end={exact ?? false}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium',
                  isActive ? 'text-club-700' : 'text-slate-500',
                )
              }
            >
              <Icone className="h-5 w-5" />
              {label}
              {label === 'Messages' && nonLus > 0 && (
                <span className="absolute top-1 right-[28%] rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                  {nonLus > 99 ? '99+' : nonLus}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
