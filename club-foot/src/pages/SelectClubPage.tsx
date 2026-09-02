import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useMyClubs } from '@/hooks/useClub';
import { roleLabel } from '@/lib/access';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/primitives';

/**
 * Un parent peut avoir des enfants dans deux clubs, un dirigeant peut en gerer
 * plusieurs : on demande lequel ouvrir. Avec un seul club, on y va directement.
 */
export default function SelectClubPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { data: clubs, isLoading } = useMyClubs(user?.id);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (isLoading) return <Spinner />;

  if (!clubs || clubs.length === 0) {
    return (
      <div className="mx-auto max-w-lg p-4">
        <EmptyState
          titre="Aucun club pour l'instant"
          description="Votre club doit vous inviter par email. Le lien recu vous rattachera automatiquement."
        />
      </div>
    );
  }

  if (clubs.length === 1) {
    return <Navigate to={`/club/${clubs[0].club.slug}`} replace />;
  }

  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Mes clubs</h1>
      <div className="flex flex-col gap-2">
        {clubs.map(({ club, role }) => (
          <Card
            key={club.id}
            className="flex cursor-pointer items-center justify-between hover:border-club-500"
            onClick={() => navigate(`/club/${club.slug}`)}
          >
            <div>
              <p className="font-medium text-slate-900">{club.name}</p>
              <p className="text-xs text-slate-500">{club.saison}</p>
            </div>
            <Badge ton="vert">{roleLabel(role)}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
