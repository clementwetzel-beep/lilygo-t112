import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useClub } from '@/hooks/useClub';
import { useClubAccess } from '@/hooks/useClubAccess';
import {
  useDocumentsJoueurs,
  useSituationAdministrative,
  useTypesDocuments,
} from '@/hooks/useAdministratif';
import { canManageAdministratif } from '@/lib/access';
import {
  estBloquant,
  formatEuros,
  messageSituation,
  resumeSituation,
  soldeCotisation,
  statutEffectif,
  statutLabel,
} from '@/lib/administratif';
import type { DocumentStatus, PlayerDocumentRow } from '@/integrations/supabase/types';
import { Badge, Card, EmptyState, PageTitre, Spinner } from '@/components/ui/primitives';

const TONS: Record<DocumentStatus, 'vert' | 'ambre' | 'rouge' | 'neutre'> = {
  valide: 'vert',
  en_attente: 'ambre',
  manquant: 'rouge',
  refuse: 'rouge',
  expire: 'rouge',
};

export default function AdministratifPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { data: club } = useClub(slug);
  const { role } = useClubAccess(slug, user?.id);
  const { data: situation, isLoading } = useSituationAdministrative(club?.id);
  const { data: typesDocuments } = useTypesDocuments(club?.id);
  const { data: documents } = useDocumentsJoueurs(club?.id);

  const documentsParJoueur = useMemo(() => {
    const index = new Map<string, PlayerDocumentRow[]>();
    for (const document of documents ?? []) {
      const liste = index.get(document.player_id);
      if (liste) liste.push(document);
      else index.set(document.player_id, [document]);
    }
    return index;
  }, [documents]);

  if (isLoading) return <Spinner />;

  const lignes = situation ?? [];
  const vueBureau = canManageAdministratif(role);
  const resume = resumeSituation(lignes);

  if (lignes.length === 0) {
    return (
      <>
        <PageTitre titre="Situation administrative" />
        <EmptyState
          titre="Aucun licencie rattache a votre compte"
          description="Le club rattache les joueurs a leurs parents depuis sa console. Signalez-le si c'est un oubli."
        />
      </>
    );
  }

  return (
    <>
      <PageTitre
        titre="Situation administrative"
        sousTitre={vueBureau ? 'Licences, pieces et cotisations du club' : 'Le dossier de vos licencies'}
      />

      {vueBureau && (
        <Card className="mb-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {resume.enRegle}/{resume.joueurs}
            </p>
            <p className="text-xs text-slate-500">en regle ({resume.tauxConformite} %)</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">{resume.documentsBloquants}</p>
            <p className="text-xs text-slate-500">pieces manquantes</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">
              {formatEuros(resume.resteAPayerCents)}
            </p>
            <p className="text-xs text-slate-500">reste a encaisser</p>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {lignes.map((ligne) => {
          const deposes = documentsParJoueur.get(ligne.player_id) ?? [];
          const solde = soldeCotisation(ligne);

          return (
            <Card key={ligne.player_id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">
                    {ligne.prenom} {ligne.nom}
                  </p>
                  <p className="text-xs text-slate-500">{messageSituation(ligne)}</p>
                </div>
                <Badge ton={ligne.en_regle ? 'vert' : 'ambre'}>
                  {ligne.en_regle ? 'En regle' : 'Incomplet'}
                </Badge>
              </div>

              <ul className="flex flex-col gap-1">
                {(typesDocuments ?? []).map((type) => {
                  const depose = deposes.find((d) => d.document_type_id === type.id);
                  const statut = statutEffectif(depose);
                  return (
                    <li
                      key={type.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className={estBloquant(statut) ? 'text-slate-900' : 'text-slate-500'}>
                        {type.label}
                        {type.obligatoire && <span className="text-red-500"> *</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        {depose?.valid_until && (
                          <span className="text-xs text-slate-400">
                            jusqu'au {depose.valid_until}
                          </span>
                        )}
                        <Badge ton={TONS[statut]}>{statutLabel(statut)}</Badge>
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
                <span className="text-slate-500">Cotisation</span>
                <span className="font-medium text-slate-900">
                  {formatEuros(ligne.cotisation_payee_cents)} / {formatEuros(ligne.cotisation_due_cents)}
                  {solde > 0 && (
                    <span className="ml-2 text-red-600">reste {formatEuros(solde)}</span>
                  )}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
