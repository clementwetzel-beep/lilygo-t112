# Onze — l'appli du club de foot

Application pour un club de football amateur : **parents, joueurs et dirigeants
se connectent** et retrouvent au même endroit le **planning** (entraînements et
matchs), les **sondages**, leur **situation administrative** (licence, pièces,
cotisation) et une **messagerie interne** à plusieurs fils.

> Ce dossier est un projet **autonome** (son propre `package.json`, ses
> migrations, ses tests). Il vit pour l'instant dans le dépôt `lilygo-t112`
> faute d'un dépôt dédié ; il peut être déplacé tel quel dans le sien.

Le socle d'identification est repris tel quel de **Schproutz v3** : mêmes
tables, mêmes fonctions d'accès, mêmes réflexes de sécurité. Seul le métier
change (un club remplace un établissement, un licencié remplace un salarié).

## Ce qui vient de Schproutz

| Schproutz v3 | Onze | Rôle |
|---|---|---|
| `auth.users` → `users` + `profiles` + `user_roles` | identique | compte applicatif, profil, rôle plateforme |
| `establishments` | `clubs` | le tenant, adressé par son `slug` |
| `establishment_members` | `club_members` | rôle **dans** le tenant, unique par (tenant, user) |
| `establishment_modules` | `club_modules` | modules activés |
| `admin_invitations` + métadonnées de signup | `club_invitations` + `handle_new_user()` | seul chemin d'entrée dans un club |
| `has_establishment_access()` | `has_club_access()` / `is_club_staff()` / `is_club_bureau()` | fonctions `SECURITY DEFINER` appelées par toutes les policies |
| `AdminRouteGuard` + `useAdminAccess` | `ClubRouteGuard` + `useClubAccess` | garde de route, deux requêtes **en parallèle** |
| `conversations` / `participants` / `messages` | idem + fils `equipe` et `annonce` | messagerie interne |

Les correctifs appris sur Schproutz sont intégrés dès le départ :

- **`localStorage` inaccessible** (Safari privé) → stockage mémoire de repli dans
  le client Supabase, sinon plus aucune requête ne part ;
- **`getSession()` et non `getUser()`** dans le garde de route : pas d'appel
  réseau avant le contrôle d'accès ;
- **types SQL qualifiés `public.`** dans le trigger sur `auth.users` : c'est ce
  qui provoquait les « type does not exist » ;
- **récursion RLS** : aucune policy n'interroge en direct une table dont la
  policy la référence en retour (rappel : une policy `FOR ALL` s'applique aussi
  au `SELECT`) — le passage obligé est une fonction `SECURITY DEFINER` ;
- **création de conversation par RPC** : une policy `INSERT` ne peut pas
  vérifier des participants qui n'existent pas encore.

## Rôles

| Rôle club | Peut |
|---|---|
| `owner` (président) | tout, y compris inviter et administrer le club |
| `dirigeant` | planning, convocations, **licences, pièces, cotisations**, invitations |
| `coach` | planning, convocations, sondages, fils d'équipe et annonces |
| `joueur` | consulter, répondre aux convocations et sondages, déposer ses pièces |
| `parent` | idem, **pour ses enfants** (`player_guardians`) |

`joueur` et `parent` ne voient que ce qui les concerne : leurs licenciés, leurs
convocations, leur dossier. Le cloisonnement est fait par la base, pas par
l'interface.

## Démarrer

```bash
cp .env.example .env      # renseigner l'URL et la clé anon du projet Supabase
npm install
npm run dev
```

Puis appliquer les migrations au projet Supabase, dans l'ordre :

```bash
supabase link --project-ref <ref>
supabase db push          # applique supabase/migrations/*.sql
npm run db:types          # regénère src/integrations/supabase/types.ts
```

> `src/integrations/supabase/types.ts` est écrit à la main tant que le projet
> Supabase n'existe pas. À la première génération, il sera remplacé.

## Vérifier avant de pousser

```bash
npm run validate     # typecheck + lint + tests unitaires (67 tests)
npm run build        # tsc -b, plus strict que typecheck seul
```

Et pour la partie base — **la seule qui protège vraiment les données** :

```bash
createdb onze_test
PGURL="postgres://postgres@localhost:5432/onze_test" npm run db:test-rls
```

Ce script rejoue le bouchon `auth`, toutes les migrations, puis
`supabase/dev/rls_smoke_test.sql`, qui vérifie sous le rôle `authenticated`
(comme PostgREST) qu'un parent ne voit pas le dossier de l'enfant du voisin,
qu'une famille ne valide pas sa propre licence, qu'un parent ne poste pas dans
les annonces du club, et qu'un club n'en voit jamais un autre. Chaque
vérification est un `ASSERT` : le script échoue au premier écart.

## Structure

```
supabase/migrations/   socle d'identité, équipes+planning, sondages,
                       administratif, messagerie (dans cet ordre)
supabase/dev/          bouchon auth + test de fumée RLS (local uniquement)
src/lib/               règles métier pures, testées (accès, planning,
                       sondages, administratif, messagerie)
src/hooks/             accès aux données via React Query
src/pages/club/        Accueil, Planning, Sondages, Dossier, Messages
```

## Reste à faire

- Console d'administration : créer un club, inviter des membres, saisir les
  joueurs (les RPC `create_club_invitation`, `convoquer_equipe` et
  `sync_team_conversation` existent déjà côté base).
- Dépôt de fichiers : brancher `player_documents.fichier_url` sur Supabase
  Storage (bucket privé + URL signées).
- Notifications push des convocations (Capacitor, comme Schproutz).
- Export de la feuille de match.
