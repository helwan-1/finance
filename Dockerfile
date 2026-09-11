# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# مدقّق مالي — صورة تشغيل التطبيق (Next.js 14 + Prisma)
# صورة واحدة تخدم غرضين عبر أمر التشغيل:
#   - الواجهة:        npm run start   (next start)
#   - المُشغّل الخلفي: npm run dispatch (tsx scripts/dispatch-runtime.ts)
# تحتوي على prisma CLI و tsx و psql (لترحيل قاعدة البيانات وتفعيل الأدوار في الإقلاع).
# ---------------------------------------------------------------------------
FROM node:22-slim AS base
WORKDIR /app
# openssl لازم لـ Prisma، postgresql-client لأوامر psql في الإقلاع، curl لفحص الصحة.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl postgresql-client curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---- الاعتماديات (طبقة مخزّنة) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- البناء ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# قيم بيئة مؤقّتة أثناء البناء فقط (لا تُستخدم وقت التشغيل — التشغيل يقرأ من env_file).
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV DIRECT_DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV AUTH_SECRET="build_time_placeholder_secret_only_0123456789abcdef"
RUN npx prisma generate && npm run build

# ---- التشغيل ----
FROM base AS runner
ENV NODE_ENV=production
# ننسخ المشروع كاملاً (يتضمّن node_modules مع prisma/tsx، ومخرجات .next، والمصدر).
COPY --from=build /app ./
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# Strip any CRLF (Windows git checkouts) so the shebang stays "#!/bin/sh", then
# make it executable — otherwise exec fails with "no such file or directory".
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# الأمر الافتراضي: تشغيل الواجهة متاحةً على كل الواجهات.
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
