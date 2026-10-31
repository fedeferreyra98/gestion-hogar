#!/usr/bin/env bash
# Crea el owner de desarrollo contra el backend corriendo. Idempotente.
# Los datos de catálogo demo los carga el backend solo con el perfil "local" (BL-111).
set -euo pipefail
[ -f .env ] && set -a && source .env && set +a
API="http://localhost:${SERVER_PORT:-8080}/api/v1"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/register-owner" \
  -H 'Content-Type: application/json' \
  -d "{\"householdName\":\"${DEV_HOUSEHOLD_NAME:-HogarDev}\",\"email\":\"${DEV_OWNER_EMAIL:-owner@hogar.local}\",\"password\":\"${DEV_OWNER_PASSWORD:-dev-owner-password-123}\",\"displayName\":\"${DEV_OWNER_NAME:-OwnerDev}\"}")

case "$code" in
  201) echo "✔ Owner creado: ${DEV_OWNER_EMAIL:-owner@hogar.local}" ;;
  409|422) echo "✔ El hogar ya existía (nada que hacer)" ;;
  404) echo "- register-owner aún no implementado (se creará el owner cuando exista auth); nada que hacer" ;;
  000) echo "✘ Backend no responde en $API. Corré 'make backend' primero." >&2; exit 1 ;;
  *) echo "✘ Respuesta inesperada: $code" >&2; exit 1 ;;
esac
