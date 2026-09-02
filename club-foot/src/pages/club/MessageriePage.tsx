import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Megaphone, Send, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useClub } from '@/hooks/useClub';
import { useClubAccess } from '@/hooks/useClubAccess';
import {
  useConversations,
  useEnvoyerMessage,
  useMarquerCommeLu,
  useMessages,
  useNonLus,
  useParticipants,
} from '@/hooks/useMessagerie';
import {
  grouperMessagesParJour,
  nomParticipant,
  nonLusParFil,
  peutEcrire,
  titreConversation,
  trierConversations,
} from '@/lib/messaging';
import { formatHeure, formatJourLong, formatRelatif } from '@/lib/dates';
import { Badge, Button, Card, EmptyState, PageTitre, Spinner } from '@/components/ui/primitives';

export default function MessageriePage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { data: club } = useClub(slug);
  const { role } = useClubAccess(slug, user?.id);
  const { data: conversations, isLoading } = useConversations(club?.id);
  const { data: compteurs } = useNonLus(club?.id);
  const [ouverte, setOuverte] = useState<string | null>(null);

  const fils = useMemo(() => trierConversations(conversations ?? []), [conversations]);
  const nonLus = useMemo(() => nonLusParFil(compteurs ?? []), [compteurs]);
  const conversationOuverte = fils.find((fil) => fil.id === ouverte) ?? null;

  if (isLoading) return <Spinner />;

  if (conversationOuverte && club && user) {
    return (
      <Fil
        conversation={conversationOuverte}
        clubId={club.id}
        userId={user.id}
        peutRepondre={peutEcrire(conversationOuverte, role)}
        onRetour={() => setOuverte(null)}
      />
    );
  }

  return (
    <>
      <PageTitre titre="Messages" sousTitre="Annonces du club, fils d'equipe et messages directs" />

      {fils.length === 0 ? (
        <EmptyState
          titre="Aucune conversation"
          description="Les annonces du club et les fils de votre equipe apparaitront ici."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {fils.map((fil) => {
            const compteur = nonLus.get(fil.id) ?? 0;
            return (
              <Card
                key={fil.id}
                className="flex cursor-pointer items-start justify-between gap-3 hover:border-club-500"
                onClick={() => setOuverte(fil.id)}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-slate-900">
                    {fil.type === 'annonce' && <Megaphone className="h-4 w-4 text-club-600" />}
                    {fil.type === 'equipe' && <Users className="h-4 w-4 text-club-600" />}
                    <TitreFil conversationId={fil.id} fil={fil} userId={user?.id ?? ''} />
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {fil.last_message_preview ?? 'Pas encore de message'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {fil.last_message_at && (
                    <span className="text-[11px] text-slate-400">
                      {formatRelatif(fil.last_message_at)}
                    </span>
                  )}
                  {compteur > 0 && <Badge ton="rouge">{compteur}</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Le titre d'un fil direct depend de ses participants : on les charge a la demande. */
function TitreFil({
  conversationId,
  fil,
  userId,
}: {
  conversationId: string;
  fil: Parameters<typeof titreConversation>[0];
  userId: string;
}) {
  const { data: participants } = useParticipants(fil.type === 'direct' ? conversationId : null);
  return <>{titreConversation(fil, participants ?? [], userId)}</>;
}

function Fil({
  conversation,
  clubId,
  userId,
  peutRepondre,
  onRetour,
}: {
  conversation: Parameters<typeof titreConversation>[0];
  clubId: string;
  userId: string;
  peutRepondre: boolean;
  onRetour: () => void;
}) {
  const { data: messages, isLoading } = useMessages(conversation.id);
  const { data: participants } = useParticipants(conversation.id);
  const envoyer = useEnvoyerMessage(clubId, userId);
  const marquerLu = useMarquerCommeLu(clubId);
  const [texte, setTexte] = useState('');

  // Ouvrir le fil, c'est l'avoir lu : la pastille tombe des l'affichage.
  const { mutate: marquer } = marquerLu;
  useEffect(() => {
    marquer(conversation.id);
  }, [conversation.id, marquer]);

  const groupes = useMemo(() => grouperMessagesParJour(messages ?? []), [messages]);

  const soumettre = (event: FormEvent) => {
    event.preventDefault();
    const contenu = texte.trim();
    if (!contenu) return;

    envoyer.mutate(
      { conversationId: conversation.id, contenu },
      {
        onSuccess: () => setTexte(''),
        onError: (erreur) => toast.error(erreur.message),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variante="fantome" onClick={onRetour}>
          ← Retour
        </Button>
        <p className="font-medium text-slate-900">
          {titreConversation(conversation, participants ?? [], userId)}
        </p>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          {groupes.map(({ jour, messages: duJour }) => (
            <section key={jour}>
              <p className="mb-2 text-center text-xs text-slate-400 first-letter:uppercase">
                {formatJourLong(duJour[0].created_at)}
              </p>
              <div className="flex flex-col gap-2">
                {duJour.map((message) => {
                  const deMoi = message.sender_id === userId;
                  const auteur = participants?.find((p) => p.user_id === message.sender_id);
                  return (
                    <div
                      key={message.id}
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        deMoi
                          ? 'self-end bg-club-600 text-white'
                          : 'self-start border border-slate-200 bg-white text-slate-800'
                      }`}
                    >
                      {!deMoi && auteur && (
                        <p className="mb-0.5 text-[11px] font-medium text-slate-500">
                          {nomParticipant(auteur)}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">{message.contenu}</p>
                      <p
                        className={`mt-1 text-[10px] ${deMoi ? 'text-club-100' : 'text-slate-400'}`}
                      >
                        {formatHeure(message.created_at)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {peutRepondre ? (
        <form onSubmit={soumettre} className="sticky bottom-20 flex gap-2 bg-slate-50 py-2">
          <input
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Votre message"
            value={texte}
            onChange={(event) => setTexte(event.target.value)}
          />
          <Button type="submit" disabled={envoyer.isPending || !texte.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-center text-xs text-slate-500">
          Fil d'annonces : seul l'encadrement peut y publier.
        </p>
      )}
    </div>
  );
}
