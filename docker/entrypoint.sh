#!/bin/sh
# ---------------------------------------------------------------------------
# سكربت الإقلاع للحاوية.
# على خدمة الواجهة (RUN_MIGRATIONS != false):
#   1) يطبّق ترحيلات قاعدة البيانات (بدور المالك عبر DIRECT_DATABASE_URL).
#   2) يفعّل دخول دوري التشغيل audit_app و audit_dispatch بكلمات المرور من البيئة.
#   3) يزرع الحسابات الأولية مرّة واحدة فقط (إن كانت قاعدة البيانات فارغة).
# على خدمة المُشغّل الخلفي (RUN_MIGRATIONS=false): يتخطّى ذلك ويشغّل الأمر مباشرةً.
# ثم ينفّذ الأمر المُمرّر (CMD/command).
# ---------------------------------------------------------------------------
set -e

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  echo "[entrypoint] تطبيق ترحيلات قاعدة البيانات…"
  npx prisma migrate deploy

  if [ -n "${AUDIT_APP_PASSWORD:-}" ]; then
    echo "[entrypoint] تفعيل دخول الدور audit_app…"
    psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 \
      -c "ALTER ROLE audit_app LOGIN PASSWORD '${AUDIT_APP_PASSWORD}';"
  fi
  if [ -n "${AUDIT_DISPATCH_PASSWORD:-}" ]; then
    echo "[entrypoint] تفعيل دخول الدور audit_dispatch…"
    psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 \
      -c "ALTER ROLE audit_dispatch LOGIN PASSWORD '${AUDIT_DISPATCH_PASSWORD}';"
  fi

  # الزرع مرّة واحدة: فقط إذا لم يوجد أي مكتب بعد (يمنع التكرار عند كل إقلاع).
  if [ "${RUN_SEED:-true}" != "false" ]; then
    FIRMS="$(psql "$DIRECT_DATABASE_URL" -tAc "SELECT count(*) FROM audit_firms;" 2>/dev/null || echo "err")"
    if [ "$FIRMS" = "0" ]; then
      echo "[entrypoint] قاعدة البيانات فارغة — زرع الحسابات الأولية…"
      DATABASE_URL="$DIRECT_DATABASE_URL" npm run prisma:seed
    else
      echo "[entrypoint] تخطّي الزرع (توجد بيانات بالفعل: firms=$FIRMS)."
    fi
  fi
fi

echo "[entrypoint] بدء: $*"
exec "$@"
