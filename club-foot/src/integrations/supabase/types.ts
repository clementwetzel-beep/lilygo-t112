// ============================================================================
// Types de la base Onze.
// ============================================================================
// Ecrits a la main tant que le projet Supabase n'existe pas. Des qu'il est
// cree, ce fichier est regenere par :
//   supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts
// Les noms de colonnes suivent EXACTEMENT les migrations de supabase/migrations.
// ============================================================================

export type ClubRole = 'owner' | 'dirigeant' | 'coach' | 'joueur' | 'parent';
export type AppRole = 'owner' | 'admin' | 'membre';
export type UserStatus = 'invitation_envoyee' | 'actif' | 'inactif';
export type ClubStatus = 'trial' | 'active' | 'suspended' | 'archived';
export type EventType = 'entrainement' | 'match' | 'tournoi' | 'reunion' | 'autre';
export type EventStatus = 'brouillon' | 'publie' | 'annule';
export type AttendanceStatus = 'en_attente' | 'present' | 'absent' | 'incertain';
export type PlayerStatus = 'actif' | 'blesse' | 'suspendu' | 'inactif';
export type PollStatus = 'brouillon' | 'ouvert' | 'clos';
export type PollAudience = 'club' | 'equipe' | 'encadrement';
export type DocumentStatus = 'manquant' | 'en_attente' | 'valide' | 'refuse' | 'expire';
export type FeeStatus = 'due' | 'partielle' | 'payee' | 'exoneree';
export type ConversationType = 'direct' | 'groupe' | 'equipe' | 'annonce';

export type UserRow = {
  id: string;
  email: string;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export type ProfileRow = {
  id: string;
  user_id: string;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export type ClubRow = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  numero_affiliation: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  color: string | null;
  saison: string;
  status: ClubStatus;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ClubMemberRow = {
  id: string;
  club_id: string;
  user_id: string;
  role: ClubRole;
  is_owner: boolean;
  created_at: string;
}

export type ClubInvitationRow = {
  id: string;
  club_id: string;
  email: string;
  role: ClubRole;
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export type TeamRow = {
  id: string;
  club_id: string;
  name: string;
  categorie: string | null;
  saison: string;
  couleur: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export type PlayerRow = {
  id: string;
  club_id: string;
  team_id: string | null;
  user_id: string | null;
  prenom: string;
  nom: string;
  date_naissance: string | null;
  numero_licence: string | null;
  numero_maillot: number | null;
  poste: string | null;
  status: PlayerStatus;
  created_at: string;
  updated_at: string;
}

export type PlayerGuardianRow = {
  id: string;
  player_id: string;
  user_id: string;
  relation: string;
  is_primary: boolean;
  created_at: string;
}

export type EventRow = {
  id: string;
  club_id: string;
  team_id: string | null;
  type: EventType;
  titre: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  rdv_at: string | null;
  lieu: string | null;
  adresse: string | null;
  adversaire: string | null;
  domicile: boolean | null;
  competition: string | null;
  score_club: number | null;
  score_adversaire: number | null;
  status: EventStatus;
  reponse_attendue: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type EventResponseRow = {
  id: string;
  event_id: string;
  player_id: string;
  status: AttendanceStatus;
  commentaire: string | null;
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
}

export type PollRow = {
  id: string;
  club_id: string;
  team_id: string | null;
  event_id: string | null;
  question: string;
  description: string | null;
  audience: PollAudience;
  choix_multiple: boolean;
  anonyme: boolean;
  status: PollStatus;
  closes_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type PollOptionRow = {
  id: string;
  poll_id: string;
  label: string;
  ordre: number;
  created_at: string;
}

export type PollVoteRow = {
  id: string;
  poll_id: string;
  option_id: string;
  user_id: string;
  player_id: string | null;
  created_at: string;
}

export type DocumentTypeRow = {
  id: string;
  club_id: string;
  cle: string;
  label: string;
  obligatoire: boolean;
  avec_echeance: boolean;
  ordre: number;
  actif: boolean;
  created_at: string;
}

export type PlayerDocumentRow = {
  id: string;
  club_id: string;
  player_id: string;
  document_type_id: string;
  status: DocumentStatus;
  fichier_url: string | null;
  valid_until: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  motif_refus: string | null;
  created_at: string;
  updated_at: string;
}

export type PlayerFeeRow = {
  id: string;
  club_id: string;
  fee_id: string;
  player_id: string;
  montant_du_cents: number;
  montant_paye_cents: number;
  status: FeeStatus;
  paid_at: string | null;
  moyen: string | null;
  commentaire: string | null;
  created_at: string;
  updated_at: string;
}

export type FeeRow = {
  id: string;
  club_id: string;
  team_id: string | null;
  saison: string;
  label: string;
  montant_cents: number;
  echeance: string | null;
  created_at: string;
}

export type ConversationRow = {
  id: string;
  club_id: string;
  team_id: string | null;
  type: ConversationType;
  nom: string | null;
  created_by: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  is_archived: boolean;
  created_at: string;
}

export type ConversationParticipantRow = {
  id: string;
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  muted: boolean;
  created_at: string;
}

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  contenu: string;
  piece_jointe_url: string | null;
  piece_jointe_nom: string | null;
  is_system: boolean;
  created_at: string;
}

/** Ligne renvoyee par la fonction situation_administrative(). */
export type SituationAdministrativeRow = {
  player_id: string;
  prenom: string;
  nom: string;
  team_id: string | null;
  documents_requis: number;
  documents_valides: number;
  documents_bloquants: number;
  cotisation_due_cents: number;
  cotisation_payee_cents: number;
  en_regle: boolean;
}

export type PollResultRow = {
  option_id: string;
  label: string;
  ordre: number;
  votes: number;
}

export type UnreadCountRow = {
  conversation_id: string;
  unread: number;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      users: Table<UserRow>;
      profiles: Table<ProfileRow>;
      clubs: Table<ClubRow>;
      club_members: Table<ClubMemberRow>;
      club_invitations: Table<ClubInvitationRow>;
      teams: Table<TeamRow>;
      players: Table<PlayerRow>;
      player_guardians: Table<PlayerGuardianRow>;
      events: Table<EventRow>;
      event_responses: Table<EventResponseRow>;
      polls: Table<PollRow>;
      poll_options: Table<PollOptionRow>;
      poll_votes: Table<PollVoteRow>;
      document_types: Table<DocumentTypeRow>;
      player_documents: Table<PlayerDocumentRow>;
      fees: Table<FeeRow>;
      player_fees: Table<PlayerFeeRow>;
      conversations: Table<ConversationRow>;
      conversation_participants: Table<ConversationParticipantRow>;
      messages: Table<MessageRow>;
    };
    Views: Record<never, never>;
    Functions: {
      accept_club_invitation: {
        Args: { p_token: string };
        Returns: { club_id: string; slug: string; role: ClubRole }[];
      };
      create_club_invitation: {
        Args: { p_club_id: string; p_email: string; p_role: ClubRole };
        Returns: { id: string; token: string }[];
      };
      convoquer_equipe: {
        Args: { p_event_id: string };
        Returns: number;
      };
      poll_results: {
        Args: { p_poll_id: string };
        Returns: PollResultRow[];
      };
      situation_administrative: {
        Args: { p_club_id: string };
        Returns: SituationAdministrativeRow[];
      };
      create_conversation: {
        Args: {
          p_club_id: string;
          p_type: ConversationType;
          p_nom: string | null;
          p_participant_ids: string[];
          p_team_id?: string | null;
        };
        Returns: string;
      };
      sync_team_conversation: {
        Args: { p_conversation_id: string };
        Returns: number;
      };
      mark_conversation_read: {
        Args: { p_conversation_id: string };
        Returns: undefined;
      };
      unread_counts: {
        Args: { p_club_id: string };
        Returns: UnreadCountRow[];
      };
    };
    Enums: {
      app_role: AppRole;
      club_role: ClubRole;
      user_status: UserStatus;
      club_status: ClubStatus;
      event_type: EventType;
      event_status: EventStatus;
      attendance_status: AttendanceStatus;
      player_status: PlayerStatus;
      poll_status: PollStatus;
      poll_audience: PollAudience;
      document_status: DocumentStatus;
      fee_status: FeeStatus;
      conversation_type: ConversationType;
    };
    CompositeTypes: Record<never, never>;
  };
}
