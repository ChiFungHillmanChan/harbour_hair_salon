FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl3
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache openssl3
RUN npm install -g pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client for Production
# Updated path to match the new directory structure
RUN pnpm db:prod:generate

# Build Next.js (skip pages that need database during build)
ENV SKIP_BUILD_PRISMA=1
RUN pnpm build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Install OpenSSL 3 for Prisma
RUN apk add --no-cache openssl3

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma schema and generate client in final stage
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Copy pnpm and node_modules for prisma generation
COPY --from=builder /usr/local/bin/pnpm /usr/local/bin/pnpm
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Start the server bound to 0.0.0.0 to accept external connections
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 PORT=3000 node server.js"]
