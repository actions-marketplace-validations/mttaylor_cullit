# Cullit Deployment Guide

This guide covers deploying the Cullit API server. For CLI-only usage, no deployment is needed — just `npx cullit generate`.

## Prerequisites

- Node.js 22+
- pnpm 10+
- PostgreSQL 14+ (recommended for production; optional for local dev)
- A Stripe account (for billing features)
- A WorkOS account (for GitHub OAuth login)

## Deployment Modes

### 1. Local Development

```bash
# Clone and install
git clone https://github.com/mttaylor/cullit.git
cd cullit
pnpm install

# Copy environment config
cp .env.example .env
# Edit .env — at minimum set an AI provider key

# Build and start
pnpm build
pnpm dev
# API server starts at http://localhost:3000
```

### 2. Docker (Self-Hosted)

```bash
# Build the image
docker build -t cullit-api .

# Run with environment variables
docker run -d \
  --name cullit-api \
  -p 3000:3000 \
  --env-file .env \
  cullit-api
```

The Dockerfile uses multi-stage builds with `node:22-alpine` and runs as a non-root user.

### 3. Railway (Recommended for Production)

Cullit is pre-configured for Railway deployment via `railway.toml`.

1. **Create a Railway project** at [railway.app](https://railway.app)
2. **Add a PostgreSQL service** — copy the `DATABASE_URL` connection string
3. **Connect your GitHub repo** or use `railway link`
4. **Set environment variables** in the Railway dashboard (see Required Variables below)
5. **Deploy**: Railway auto-deploys on push to `main`

```bash
# Or deploy manually
railway up
```

Railway provides automatic HTTPS, health checks, and zero-downtime deploys.

## Required Environment Variables

### Minimum (API server)

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `3000`) |
| `CULLIT_JWT_SECRET` | JWT signing key — **must be 32+ chars**. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CULLIT_BASE_URL` | Public API URL (e.g., `https://api.cullit.io`) |
| `CULLIT_DASHBOARD_URL` | Dashboard URL (e.g., `https://cullit.io/dashboard.html`) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |

### Database (strongly recommended)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |

Without `DATABASE_URL`, data is stored in-memory and lost on restart.

### Authentication

| Variable | Description |
|----------|-------------|
| `WORKOS_CLIENT_ID` | WorkOS AuthKit client ID |
| `WORKOS_API_KEY` | WorkOS AuthKit API key |

Configure the redirect URI in WorkOS as: `{CULLIT_BASE_URL}/auth/callback`

### Billing

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_BASIC_PRICE_ID` | Stripe price ID for Basic plan |
| `STRIPE_PRO_PRICE_ID` | Stripe price ID for Pro plan |
| `STRIPE_TEAM_PRICE_ID` | Stripe price ID for Team plan (legacy fallback) |
| `STRIPE_TEAM_5_PRICE_ID` | Stripe price ID for Team 5 plan ($44.99/mo, 5 seats) |
| `STRIPE_TEAM_10_PRICE_ID` | Stripe price ID for Team 10 plan ($89/mo, 10 seats) |
| `STRIPE_TEAM_25_PRICE_ID` | Stripe price ID for Team 25 plan ($209/mo, 25 seats) |

### Optional

See [.env.example](.env.example) for the full list with descriptions.

## Database Setup

### Initial Setup

The API server auto-creates tables on first start when `DATABASE_URL` is set. No separate migration step is required.

### Backups

**Railway (Pro plan):** Automatic daily snapshots.

```bash
# Manual backup
railway connect postgres
pg_dump $DATABASE_URL > backup.sql
```

**Self-hosted:**

```bash
# Cron job for daily backups
0 2 * * * pg_dump $DATABASE_URL | gzip > /backups/cullit-$(date +\%F).sql.gz
```

## Stripe Webhook Setup

1. Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `{CULLIT_BASE_URL}/v1/billing/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

## Health Checks

The API exposes health check endpoints:

- `GET /health` — returns `{ status: "ok", version, uptime }`
- `GET /healthz` — alias for `/health`

Configure your load balancer or container orchestrator to use these.

## Monitoring

- `GET /metrics` — Prometheus-format metrics (gated by `METRICS_TOKEN` if set)
- Set `LOG_LEVEL` to control verbosity (`trace | debug | info | warn | error | fatal`)

## Security Checklist

- [ ] `CULLIT_JWT_SECRET` is at least 32 characters and unique per environment
- [ ] `ALLOWED_ORIGINS` does not contain `*` in production
- [ ] `NODE_ENV=production` is set
- [ ] `METRICS_TOKEN` is set (required in production)
- [ ] Database connections use SSL in production
- [ ] Stripe webhook secret is set
- [ ] All secrets are stored in environment variables, not in code
- [ ] Docker container runs as non-root user (default in provided Dockerfile)
- [ ] HTTPS is terminated at the load balancer / reverse proxy

## Rate Limiting

Rate limiting is **in-memory, per-process**. In a single-instance deployment (e.g., Railway) this works correctly. In multi-instance deployments (e.g., Kubernetes with multiple replicas), each process tracks limits independently — the effective limit is multiplied by the number of instances. For strict enforcement across instances, swap `createRateLimiter()` with a Redis-backed implementation.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Sessions don't persist across restarts | `CULLIT_JWT_SECRET` not set | Set a stable secret |
| 401 on all auth endpoints | WorkOS not configured | Set `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` |
| Data lost on restart | No database | Set `DATABASE_URL` |
| Billing not working | Stripe not configured | Set all `STRIPE_*` variables |
| CORS errors on dashboard | Wrong `ALLOWED_ORIGINS` | Add your dashboard domain |
