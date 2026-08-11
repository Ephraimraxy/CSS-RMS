# CSS RMS — Requisition Management System

The internal operations portal for CSS Group: Cash/Material requisitions, Memos, an in-browser Document Studio (Word/Excel/PowerPoint-equivalent), HR Portal, and multi-department approval/vetting workflows.

**For full architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md)** — tech stack, project structure, the domain model, the database migration workflow, and a list of structural gotchas worth knowing before making changes. Read that file first if you're new to this codebase; this README only covers local setup.

## Project Structure

```
├── serve.js              # Express backend — every API route
├── rms_backend/prisma/   # Prisma schema + migrations (PostgreSQL)
└── rms_frontend/         # React + Vite + Tailwind frontend
```

## Development

### Backend
```bash
npm install
npx prisma generate --schema=rms_backend/prisma/schema.prisma
node serve.js              # needs a .env with a real DATABASE_URL (see .env.example)
```

### Frontend
```bash
cd rms_frontend
npm install
npm run dev      # local development
npm run build    # production build
```

### Tests
```bash
npm test                   # backend (root) — pure business-rule functions, no DB needed
cd rms_frontend && npm test  # frontend — shared display logic, no DB needed
```

### Database schema changes
See [ARCHITECTURE.md §5](./ARCHITECTURE.md#5-database-changes--the-migration-workflow-read-this-before-touching-schemaprisma) — schema changes need a generated migration file (`npx prisma migrate dev`) committed alongside the `schema.prisma` edit, not just a `db push`.

## Environment Variables

See `.env.example` for the full list with descriptions. Key ones: `DATABASE_URL`, `JWT_SECRET`, `SUPER_ADMIN_ACCESS_CODE`/`SUPER_ADMIN_MFA_PIN`, signing keys (`SIGNING_PRIVATE_KEY`/`SIGNING_PUBLIC_KEY` or `SIGNING_MASTER_KEY`), Cloudflare R2 storage credentials (`R2_*`), and email (`GMAIL_USER`/`GMAIL_APP_PASSWORD` or generic `SMTP_*`).

## Deployment

Two parallel production deployments:

| Deployment | URL | Platform |
|------------|-----|----------|
| Main | https://cssgrouprms.com | Railway |
| VPS | https://rms.cssgrouprms.com | InterServer KVM ($3/mo) |

**Railway:** `npm start` runs `prisma migrate deploy` then `node serve.js`. The frontend is built into `rms_frontend/dist` and served as static files by the same Express server.

**VPS (InterServer):** Ubuntu 24.04, Node.js + PM2, PostgreSQL 15, Nginx reverse proxy with Cloudflare orange-cloud SSL. See [VPS_MANAGEMENT_GUIDE.md](./VPS_MANAGEMENT_GUIDE.md) for full management instructions — connecting via SSH, managing environment variables, deploying new code, database operations, troubleshooting, and all daily management commands.
