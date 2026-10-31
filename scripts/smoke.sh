#!/usr/bin/env bash
# Smoke test end-to-end contra el backend corriendo (make backend en otra terminal).
# Cada fase se agrega junto con su tarea del backlog; las secciones se activan solas
# si el endpoint existe (404 => SKIP), así el script sirve desde el primer día.
set -uo pipefail

[ -f .env ] && set -a && source .env && set +a
BASE="${API_BASE:-http://localhost:${SERVER_PORT:-8080}}"
API="$BASE/api/v1"
EMAIL="${DEV_OWNER_EMAIL:-owner@hogar.local}"
PASS="${DEV_OWNER_PASSWORD:-dev-owner-password-123}"

PASSED=0; FAILED=0; SKIPPED=0
ok()   { echo "  ✔ $1"; PASSED=$((PASSED+1)); }
fail() { echo "  ✘ $1"; FAILED=$((FAILED+1)); }
skip() { echo "  - $1 (SKIP)"; SKIPPED=$((SKIPPED+1)); }

# req METHOD PATH [JSON] -> imprime body; deja el status en $STATUS
req() {
  local method="$1" path="$2" data="${3:-}" auth=()
  [ -n "${TOKEN:-}" ] && auth=(-H "Authorization: Bearer $TOKEN")
  local out
  if [ -n "$data" ]; then
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$API$path" -H 'Content-Type: application/json' ${auth[@]+"${auth[@]}"} -d "$data")
  else
    out=$(curl -s -w '\n%{http_code}' -X "$method" "$API$path" ${auth[@]+"${auth[@]}"})
  fi
  STATUS="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }
expect() { # expect "descripción" código_esperado
  if [ "$STATUS" = "$2" ]; then ok "$1"; else fail "$1 (esperado $2, obtuve $STATUS: ${BODY:0:200})"; fi
}

echo "Smoke contra $BASE"

echo "[health]"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/actuator/health" || true)
if [ "$code" = "200" ]; then ok "actuator/health"; else fail "actuator/health ($code) — ¿está corriendo 'make backend'?"; echo "Resultado: abortado"; exit 1; fi

echo "[auth]"
req POST /auth/register-owner "{\"householdName\":\"${DEV_HOUSEHOLD_NAME:-HogarDev}\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"displayName\":\"${DEV_OWNER_NAME:-OwnerDev}\"}"
if [ "$STATUS" = "404" ]; then skip "register-owner no implementado"; elif [ "$STATUS" = "201" ] || [ "$STATUS" = "409" ] || [ "$STATUS" = "422" ]; then ok "register-owner (201 nuevo, o ya existía)"; else fail "register-owner ($STATUS)"; fi

req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"
if [ "$STATUS" = "404" ]; then skip "login no implementado"; else
  expect "login" 200
  TOKEN=$(echo "$BODY" | jget "['accessToken']")
  [ -n "${TOKEN:-}" ] && ok "access token recibido" || fail "sin accessToken"
fi

req GET /me
if [ "$STATUS" = "404" ] || [ -z "${TOKEN:-}" ]; then skip "/me"; else expect "GET /me autenticado" 200; fi

TOKEN_BAK="${TOKEN:-}"; TOKEN=""
req GET /me
if [ "$STATUS" = "404" ]; then skip "/me sin token"; else expect "GET /me sin token => 401" 401; fi
TOKEN="$TOKEN_BAK"

# ---- Fase 1: flujo central (se activa cuando existan los endpoints) ----
echo "[flujo compra: lista -> compra -> gasto + stock]"
if [ -z "${TOKEN:-}" ]; then skip "sin sesión"; else
  req POST /products "{\"name\":\"Leche smoke $(date +%s)\",\"defaultUnit\":\"L\",\"defaultShelfLifeDays\":7}"
  if [ "$STATUS" = "404" ]; then skip "catálogo no implementado"; else
    expect "crear producto" 201; PID=$(echo "$BODY" | jget "['id']")
    req POST /shopping-lists "{\"name\":\"Smoke $(date +%s)\"}"
    if [ "$STATUS" = "404" ]; then skip "listas no implementadas"; else
      expect "crear lista" 201; LID=$(echo "$BODY" | jget "['id']")
      req POST "/shopping-lists/$LID/items" "{\"productId\":\"$PID\",\"quantity\":\"2\",\"unit\":\"L\"}"; expect "agregar ítem" 201
      MEMBER=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/me" | jget "['member']['id']")
      TODAY=$(date +%F)
      req POST "/shopping-lists/$LID/complete" "{\"purchaseDate\":\"$TODAY\",\"paidBy\":\"$MEMBER\",\"store\":\"Smoke\",\"total\":{\"amountMinor\":300000,\"currency\":\"ARS\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":\"2\",\"unit\":\"L\",\"unitPrice\":{\"amountMinor\":150000,\"currency\":\"ARS\"}}],\"leftoverAction\":\"DISCARD\"}"
      if [ "$STATUS" = "404" ]; then skip "completar lista no implementado"; else
        expect "completar lista" 201
        req GET "/expenses?q=Smoke"; expect "gasto generado visible en histórico" 200
        req GET "/stock?productId=$PID"; expect "stock generado" 200
        echo "$BODY" | grep -q "$PID" && ok "stock contiene el producto comprado" || fail "stock no contiene el producto"
        req POST "/shopping-lists/$LID/complete" "{}"; [ "$STATUS" = "422" ] || [ "$STATUS" = "400" ] && ok "reintento rechazado" || fail "reintento debería rechazarse ($STATUS)"
      fi
    fi
  fi
fi

echo
echo "Resultado: $PASSED ok, $FAILED fallidos, $SKIPPED salteados"
[ "$FAILED" -eq 0 ]
