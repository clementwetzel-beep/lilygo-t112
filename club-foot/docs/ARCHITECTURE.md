# Architecture

## Principe

Une seule règle gouverne le projet : **la donnée est protégée par la base, pas
par l'interface**. Le front choisit ce qu'il affiche ; les policies RLS
décident ce qui sort de Postgres. Chaque règle d'accès existe donc en double,
volontairement :

| Côté base (fait foi) | Côté front (confort) |
|---|---|
| `is_club_staff()` | `isStaff()` / `canManagePlanning()` |
| `is_club_bureau()` | `isBureau()` / `canManageAdministratif()` |
| `can_post_in_conversation()` | `peutEcrire()` |
| `document_effective_status()` | `statutEffectif()` |

Toute règle ajoutée d'un côté doit l'être de l'autre. Les fonctions du front
sont testées unitairement, celles de la base par `supabase/dev/rls_smoke_test.sql`.

## Identification

```
auth.users                     (Supabase Auth : email + mot de passe)
   │  trigger handle_new_user()
   ├─> public.users            (miroir applicatif + statut)
   ├─> public.profiles         (prénom, nom, téléphone, photo)
   ├─> public.user_roles       (rôle plateforme : owner | admin | membre)
   └─> public.club_members     (si les métadonnées portent une invitation)
```

Le signup transporte l'invitation dans `raw_user_meta_data`
(`invitation_id`, `club_id`, `role`) : c'est le trigger qui crée l'adhésion, le
front n'a aucun droit d'écriture sur `club_members`. Quand le compte existait
**avant** l'invitation, le front rattrape via la RPC `accept_club_invitation()`,
qui vérifie que l'email de l'invitation est bien celui du compte connecté.

Le trigger qualifie tous ses types en `public.` et fige `search_path` : sans
cela, exécuté dans le contexte du schéma `auth`, il échoue en « type does not
exist » (panne rencontrée sur Schproutz).

## Multi-tenant

Le club est le tenant. Tout objet métier porte un `club_id`, et toutes les
policies passent par trois fonctions `SECURITY DEFINER` :

- `has_club_access(user, club)` — membre ou propriétaire ;
- `is_club_staff(user, club)` — owner, dirigeant ou coach (écriture métier) ;
- `is_club_bureau(user, club)` — owner ou dirigeant (administratif, invitations).

`SECURITY DEFINER` n'est pas un confort : ces fonctions s'exécutent sous le
propriétaire des tables, ce qui **coupe les cycles de policies**. Une policy sur
`players` qui lirait `player_guardians` alors qu'une policy de
`player_guardians` lit `players` provoque `infinite recursion detected in
policy` — et une policy `FOR ALL` compte aussi pour le `SELECT`. Toutes les
références croisées passent donc par une fonction : `my_player_ids()`,
`my_team_ids()`, `is_bureau_of_player()`, `is_conversation_participant()`.

## Le lien parent → licencié

`player_guardians (player_id, user_id)` est la pièce qui rend l'application
utilisable par des familles. Il donne à un parent — et à lui seul — le droit de :

- voir les convocations de son enfant et **y répondre** (`event_responses`) ;
- voter à un sondage **par enfant** (`poll_votes.player_id`) ;
- consulter et compléter le dossier administratif de son enfant ;
- voir les coéquipiers de son enfant, et personne d'autre.

Un enfant n'a pas besoin de compte : `players.user_id` est nullable.

## Contrôle d'accès à une route

`ClubRouteGuard` lit la session **en mémoire** (`getSession()`), puis
`useClubAccess` interroge **en parallèle** le club (par son slug) et les
adhésions de l'utilisateur, et rapproche les deux en mémoire
(`resolveClubAccess`). Enchaîner la seconde requête sur l'identifiant renvoyé
par la première ajouterait un aller-retour réseau complet avant même que la
page protégée commence à charger. C'est légitime parce que la policy
`club_members_select_self` autorise `user_id = auth.uid()` et que
`(club_id, user_id)` est unique.

Le garde choisit l'écran. Il ne protège pas la donnée : chaque requête de la
page reste soumise aux policies.

## Situation administrative

Le calcul est fait par `situation_administrative(club_id)` côté Postgres, et
non par le front, pour deux raisons : le bureau a besoin d'un agrégat sur tout
le club sans rapatrier chaque pièce, et un certificat médical périmé doit
basculer en `expire` **à la lecture**, sans cron. La même fonction sert aux
familles et au bureau — la RLS décide de la portée.

## Messagerie

Quatre natures de fils, toutes scopées au club :

| Type | Qui lit | Qui écrit |
|---|---|---|
| `direct` | les deux participants | les deux |
| `groupe` | les participants | les participants |
| `equipe` | joueurs, parents et encadrants de l'équipe | tous les participants |
| `annonce` | tout le club | l'encadrement seulement |

La création passe par la RPC `create_conversation()` : le fil et ses
participants sont insérés dans la même transaction, et la fonction refuse
d'ajouter quelqu'un qui n'est pas membre du club. Les compteurs de non-lus sont
calculés par `unread_counts()` — une pastille ne doit pas coûter le
téléchargement de tous les messages.

## Ce qui n'est pas repris de Schproutz

Ni caisse, ni recrutement, ni comptabilité, ni Capacitor pour l'instant : le
projet démarre sur le socle d'identité et quatre modules. `club_modules` est là
pour activer la suite club par club, comme `establishment_modules`.
