#!/usr/bin/env bash
# ============================================================================
# Rejoue TOUTES les migrations sur un Postgres local, puis le test de fumee RLS.
# ============================================================================
# Aucune connexion a Supabase : on part d'une base vide + le bouchon du schema
# auth (supabase/dev/auth_stub.sql). C'est le seul moyen de verifier policies,
# triggers et fonctions SECURITY DEFINER avant de les pousser en production.
#
# Prerequis : un serveur Postgres accessible et une base vierge.
#   PGURL="postgres://postgres@localhost:5432/onze_test" ./scripts/test-rls.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PGURL="${PGURL:-postgres://postgres@localhost:5432/onze_test}"

echo "Base cible : $PGURL"

FICHIERS=(supabase/dev/auth_stub.sql)
for migration in supabase/migrations/*.sql; do
  FICHIERS+=("$migration")
done
FICHIERS+=(supabase/dev/rls_smoke_test.sql)

ARGS=()
for fichier in "${FICHIERS[@]}"; do
  ARGS+=(-f "$fichier")
done

psql "$PGURL" -v ON_ERROR_STOP=1 -q "${ARGS[@]}"
