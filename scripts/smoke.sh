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
check_eq() { # check_eq "descripción" actual esperado
  if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (esperado '$3', obtuve '$2')"; fi
}
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

# ---- Fase 1: flujo central y endpoints asociados ----
# Idempotente: todos los nombres llevan un sufijo único; nunca se asume base vacía.
# Ojo: no usar nombres reservados de shell (GID, UID, EUID...) como variables.
SFX="$(date +%s)$RANDOM"
CUR="${SMOKE_BASE_CURRENCY:-ARS}"   # moneda base del hogar
OTHER_CUR="USD"; [ "$CUR" = "USD" ] && OTHER_CUR="EUR"
TODAY=$(date +%F)
plus_days() { python3 -c "import sys,datetime; print(datetime.date.fromisoformat(sys.argv[1])+datetime.timedelta(days=int(sys.argv[2])))" "$1" "$2"; }
money() { echo "{\"amountMinor\":$1,\"currency\":\"${2:-$CUR}\"}"; }

MEMBER_ID=""; PID=""; EXP_PURCHASE_ID=""
if [ -n "${TOKEN:-}" ]; then
  req GET /me; MEMBER_ID=$(echo "$BODY" | jget "['member']['id']")
fi

echo "[flujo compra: lista -> compra -> gasto + stock]"
if [ -z "${TOKEN:-}" ]; then skip "sin sesión"; else
  req POST /products "{\"name\":\"Leche smoke $SFX\",\"defaultUnit\":\"L\",\"defaultShelfLifeDays\":7}"
  if [ "$STATUS" = "404" ]; then skip "catálogo no implementado"; else
    expect "crear producto" 201; PID=$(echo "$BODY" | jget "['id']")
    req POST /products "{\"name\":\"Pan smoke $SFX\",\"defaultUnit\":\"UNIT\"}"; expect "crear segundo producto (sin vencimiento)" 201
    PID2=$(echo "$BODY" | jget "['id']")
    LNAME="Smoke $SFX"
    req POST /shopping-lists "{\"name\":\"$LNAME\"}"
    if [ "$STATUS" = "404" ]; then skip "listas no implementadas"; else
      expect "crear lista" 201; LID=$(echo "$BODY" | jget "['id']")
      req POST "/shopping-lists/$LID/items" "{\"productId\":\"$PID\",\"quantity\":\"2\",\"unit\":\"L\"}"; expect "agregar ítem comprado" 201
      LITEM=$(echo "$BODY" | jget "['id']")
      req POST "/shopping-lists/$LID/items" "{\"productId\":\"$PID2\",\"quantity\":\"1\",\"unit\":\"UNIT\"}"; expect "agregar ítem pendiente" 201
      req POST "/shopping-lists/$LID/complete" "{\"purchaseDate\":\"$TODAY\",\"paidBy\":\"$MEMBER_ID\",\"store\":\"Smoke $SFX\",\"total\":$(money 300000),\"items\":[{\"listItemId\":\"$LITEM\",\"productId\":\"$PID\",\"quantity\":\"2\",\"unit\":\"L\",\"unitPrice\":$(money 150000)}],\"leftoverAction\":\"NEW_LIST\"}"
      if [ "$STATUS" = "404" ]; then skip "completar lista no implementado"; else
        expect "completar lista (leftoverAction=NEW_LIST)" 201
        EXP_PURCHASE_ID=$(echo "$BODY" | jget "['expenseId']")
        [ -n "$EXP_PURCHASE_ID" ] && ok "compra devuelve expenseId" || fail "compra sin expenseId"

        req GET "/expenses?q=Smoke%20$SFX"; expect "gasto generado visible en histórico" 200
        check_eq "gasto de la compra: un resultado" "$(echo "$BODY" | jget "['totalElements']")" "1"
        check_eq "gasto de la compra: source=PURCHASE" "$(echo "$BODY" | jget "['content'][0]['source']")" "PURCHASE"
        check_eq "gasto de la compra: monto" "$(echo "$BODY" | jget "['content'][0]['amount']['amountMinor']")" "300000"

        req GET "/shopping-lists/$LID"
        check_eq "lista original queda COMPLETED" "$(echo "$BODY" | jget "['status']")" "COMPLETED"
        req GET "/shopping-lists?status=OPEN&size=100&sort=createdAt,desc"; expect "listar listas OPEN" 200
        echo "$BODY" | grep -q "$LNAME (pendientes)" && ok "lista '<nombre> (pendientes)' creada" || fail "falta la lista '$LNAME (pendientes)'"

        req POST "/shopping-lists/$LID/complete" "{}"
        if [ "$STATUS" = "422" ] || [ "$STATUS" = "400" ]; then ok "reintento de completar rechazado"; else fail "reintento debería rechazarse ($STATUS)"; fi

        echo "[gasto PURCHASE protegido]"
        if [ -n "$EXP_PURCHASE_ID" ]; then
          req PUT "/expenses/$EXP_PURCHASE_ID" "{\"description\":\"editado\",\"amount\":$(money 1),\"expenseDate\":\"$TODAY\",\"paidBy\":\"$MEMBER_ID\"}"
          if [ "$STATUS" = "404" ]; then skip "PUT /expenses no implementado"; else expect "PUT de gasto PURCHASE => 409" 409; fi
          req DELETE "/expenses/$EXP_PURCHASE_ID"
          if [ "$STATUS" = "404" ]; then skip "DELETE /expenses no implementado"; else expect "DELETE de gasto PURCHASE => 409" 409; fi
        fi

        echo "[stock: vencimiento por defecto y FEFO]"
        req GET "/stock?productId=$PID"
        if [ "$STATUS" = "404" ]; then skip "stock no implementado"; else
          expect "stock generado" 200
          check_eq "stock: un lote del producto comprado" "$(echo "$BODY" | jget "['totalElements']")" "1"
          check_eq "stock: vencimiento = compra + defaultShelfLifeDays" "$(echo "$BODY" | jget "['content'][0]['expiryDate']")" "$(plus_days "$TODAY" 7)"
          check_eq "stock: cantidad comprada" "$(echo "$BODY" | python3 -c "import sys,json; print(float(json.load(sys.stdin)['content'][0]['quantity']))" 2>/dev/null)" "2.0"
          BUY_LOT=$(echo "$BODY" | jget "['content'][0]['id']")
          req GET "/stock?productId=$PID2"; check_eq "stock: producto pendiente no ingresó" "$(echo "$BODY" | jget "['totalElements']")" "0"

          req POST /stock "{\"productId\":\"$PID\",\"quantity\":\"1\",\"unit\":\"L\",\"expiryDate\":\"$(plus_days "$TODAY" 2)\"}"; expect "alta manual de lote que vence antes" 201
          EARLY_LOT=$(echo "$BODY" | jget "['id']")
          req POST /stock/consume "{\"productId\":\"$PID\",\"quantity\":\"1.5\",\"unit\":\"L\"}"; expect "consumo FEFO" 200
          check_eq "FEFO: primero el lote que vence antes" "$(echo "$BODY" | jget "['consumed'][0]['stockItemId']")" "$EARLY_LOT"
          check_eq "FEFO: luego el lote de la compra" "$(echo "$BODY" | jget "['consumed'][1]['stockItemId']")" "$BUY_LOT"
          req GET "/stock/summary"
          req POST /stock/consume "{\"productId\":\"$PID\",\"quantity\":\"100\",\"unit\":\"L\"}"
          expect "consumo mayor al stock => 422" 422
          check_eq "código INSUFFICIENT_STOCK" "$(echo "$BODY" | jget "['code']")" "INSUFFICIENT_STOCK"
        fi
      fi
    fi
  fi
fi

echo "[gastos manuales]"
if [ -z "${TOKEN:-}" ]; then skip "sin sesión"; else
  DESC="Gasto smoke $SFX"
  req POST /expenses "{\"description\":\"$DESC A\",\"amount\":$(money 1000),\"expenseDate\":\"2020-01-10\",\"paidBy\":\"$MEMBER_ID\"}"
  if [ "$STATUS" = "404" ]; then skip "gastos no implementados"; else
    expect "crear gasto manual A (2020-01-10)" 201; EXP_A=$(echo "$BODY" | jget "['id']")
    check_eq "gasto manual: source=MANUAL" "$(echo "$BODY" | jget "['source']")" "MANUAL"
    req POST /expenses "{\"description\":\"$DESC B\",\"amount\":$(money 2500),\"expenseDate\":\"2020-02-10\",\"paidBy\":\"$MEMBER_ID\"}"; expect "crear gasto manual B (2020-02-10)" 201

    req GET "/expenses?q=$(echo "$DESC" | sed 's/ /%20/g')"; expect "listar gastos por texto" 200
    check_eq "sin filtro de fechas: 2 gastos" "$(echo "$BODY" | jget "['totalElements']")" "2"
    check_eq "sin filtro de fechas: totalFiltered" "$(echo "$BODY" | jget "['totalFiltered'][0]['amountMinor']")" "3500"
    req GET "/expenses?q=$(echo "$DESC" | sed 's/ /%20/g')&from=2020-01-01&to=2020-01-31"; expect "filtrar gastos por fechas" 200
    check_eq "filtro de fechas: 1 gasto" "$(echo "$BODY" | jget "['totalElements']")" "1"
    check_eq "filtro de fechas: totalFiltered" "$(echo "$BODY" | jget "['totalFiltered'][0]['amountMinor']")" "1000"
    check_eq "filtro de fechas: moneda base" "$(echo "$BODY" | jget "['totalFiltered'][0]['currency']")" "$CUR"

    req GET "/expenses?from=2020-02-01&to=2020-01-01"; expect "from > to => 400" 400
    req POST /expenses "{\"description\":\"$DESC USD\",\"amount\":$(money 1000 "$OTHER_CUR"),\"expenseDate\":\"2020-01-10\",\"paidBy\":\"$MEMBER_ID\"}"
    expect "moneda distinta a la base => 422" 422
    check_eq "código UNSUPPORTED_CURRENCY" "$(echo "$BODY" | jget "['code']")" "UNSUPPORTED_CURRENCY"

    req DELETE "/expenses/$EXP_A"; expect "borrar gasto manual (soft delete)" 204
    req GET "/expenses/$EXP_A"; expect "gasto borrado => 404" 404
    req GET "/expenses?q=$(echo "$DESC" | sed 's/ /%20/g')"
    check_eq "gasto borrado no aparece en el listado" "$(echo "$BODY" | jget "['totalElements']")" "1"
  fi
fi

echo "[miembros y permisos]"
if [ -z "${TOKEN:-}" ]; then skip "sin sesión"; else
  M_EMAIL="smoke-$SFX@hogar.local"; M_PASS="smoke-member-pass-123"
  req POST /members "{\"email\":\"$M_EMAIL\",\"displayName\":\"Smoke $SFX\",\"password\":\"$M_PASS\"}"
  if [ "$STATUS" = "404" ]; then skip "miembros no implementados"; else
    expect "OWNER crea miembro" 201
    check_eq "miembro creado con rol MEMBER" "$(echo "$BODY" | jget "['role']")" "MEMBER"
    req GET /members; expect "listar miembros" 200
    echo "$BODY" | grep -q "$M_EMAIL" && ok "miembro nuevo aparece en el listado" || fail "miembro nuevo no aparece"
    OWNER_TOKEN="$TOKEN"
    req POST /auth/login "{\"email\":\"$M_EMAIL\",\"password\":\"$M_PASS\"}"; expect "login del MEMBER" 200
    TOKEN=$(echo "$BODY" | jget "['accessToken']")
    if [ -n "${TOKEN:-}" ]; then
      req POST /members "{\"email\":\"smoke2-$SFX@hogar.local\",\"displayName\":\"Smoke2 $SFX\",\"password\":\"$M_PASS\"}"
      expect "MEMBER no puede crear miembros => 403" 403
    else
      fail "MEMBER sin accessToken"
    fi
    TOKEN="$OWNER_TOKEN"
  fi
fi

echo
echo "Resultado: $PASSED ok, $FAILED fallidos, $SKIPPED salteados"
[ "$FAILED" -eq 0 ]
