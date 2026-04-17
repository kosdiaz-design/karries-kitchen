# Karrie's Kitchen 2 — Claude Code Context

## What this is

Karrie's Kitchen 2 is the ground-up rebuild of the original single-file HTML app (`kosdiaz-design/karries-kitchen`) into a proper web app per the April 2026 build plan. Goals: minimalist, search-first, AI-assisted ingestion (HelloFresh photos, PDFs, YouTube), approval queue for Eric's Instagram/Facebook imports, cooking + presentation modes, per-recipe ESV blessing, Publix Gandy aisle-ordered grocery list.

The original repo (`karries-kitchen`) continues to ship v1 until v2 reaches parity and cuts over.

---

## Tech stack

- **Client:** Vite + React 19 + TypeScript (`client/`)
- **Server:** Node + Express 4 + TypeScript, ESM (`server/`)
- **Database:** PostgreSQL via `pg` pool
- **Auth:** JWT (`jsonwebtoken`), bcrypt-hashed PINs seeded from env vars
- **AI (later sprints):** Anthropic Claude Sonnet, server-side only
- **Hosting:** Railway — single service, server builds client then serves `client/dist/` + API from `:$PORT`

---

## Directory layout

```
.
├── package.json              # npm workspaces root (client + server)
├── railway.json              # Railway build/start + /api/health check
├── .env.example              # DATABASE_URL, JWT_SECRET, PIN_KARRIE, PIN_ERIC
├── client/                   # Vite app
│   ├── index.html
│   ├── vite.config.ts        # dev proxy: /api → :3001
│   └── src/
│       ├── main.tsx, App.tsx, styles.css
│       ├── lib/api.ts        # fetch wrapper + bearer token
│       ├── lib/auth.tsx      # <AuthProvider>, useAuth()
│       └── pages/            # Login.tsx, Home.tsx
├── server/                   # Express app
│   └── src/
│       ├── index.ts          # entry; serves client/dist in prod
│       ├── env.ts            # typed env loader
│       ├── db.ts             # pg Pool + query helper
│       ├── auth.ts           # sign/verify JWT
│       ├── middleware.ts     # requireAuth, requireAdmin
│       ├── seed.ts           # upserts karrie + eric from env PINs
│       ├── migrate.ts        # applies db/migrations/*.sql in order
│       └── routes/           # auth.ts, health.ts
└── db/migrations/            # numbered SQL files, applied in order
    ├── 001_users.sql
    ├── 002_recipes.sql
    ├── 003_recipe_edit_history.sql
    ├── 004_pending_imports.sql
    ├── 005_grocery_lists.sql
    ├── 006_meal_plans.sql
    └── 007_publix_aisles.sql
```

---

## Local dev

```bash
npm install                 # installs both workspaces
cp .env.example server/.env # fill DATABASE_URL, JWT_SECRET, PIN_KARRIE, PIN_ERIC
npm run migrate             # apply migrations
npm run dev:server          # :3001
npm run dev:client          # :5173 (proxies /api → :3001)
```

Typecheck everything: `npm run typecheck`.

---

## Roles

| User | `user_id` | Role | Surface |
|------|-----------|------|---------|
| Karrie | `karrie` | `user` | Default — everything except `/admin/*` |
| Eric | `eric` | `admin` | Everything + `/admin/*` (imports, ISF pipeline, edit log, AI usage) |

Both PINs are seeded from `PIN_KARRIE` / `PIN_ERIC` env vars on every boot (`server/src/seed.ts`). Changing the env var rehashes and updates the row.

---

## Auth flow

1. `POST /api/auth/login { user_id, pin }` → `{ token, user }` (rate-limited, 10/15min/IP)
2. Client stores token in `localStorage` under `kk_v2_token`
3. Every request sends `Authorization: Bearer <token>`
4. `GET /api/auth/me` rehydrates on reload
5. `requireAuth` middleware attaches `req.user = { sub, name, role }`; `requireAdmin` gates admin routes

JWT secret: `JWT_SECRET` env var. Expiry: `JWT_EXPIRES_IN` (default 7d).

---

## Data model (see migrations for source of truth)

- `users` — `user_id`, `name`, `role ∈ {admin, user}`, `pin_hash`
- `recipes` — full fields from the build plan (title, source_type, ingredients/steps jsonb, equipment[], macros, main_protein, tags[], esv_blessing_text, rating, is_favorite, is_eric_approved, times_made, last_cooked_at, approved, approved_by…)
- `recipe_edit_history` — per-edit jsonb snapshot + note, append-only
- `pending_imports` — Eric's queue of Instagram/Facebook/etc. recipes awaiting Karrie's approval
- `grocery_lists` — array of `recipe_ids`, `items` jsonb, `publix_aisle_ordered` flag
- `meal_plans` — one row per `(user_id, week_starting)`, `days` jsonb, `ai_generated` flag
- `publix_aisles` — reference table mapping keywords → aisle order for the Gandy Commons store

---

## Migrations

- Numbered SQL files in `db/migrations/`, applied in lexicographic order by `server/src/migrate.ts`
- Applied migrations tracked in `schema_migrations` table
- Each file runs inside a transaction; failure rolls back and halts
- **Never edit a migration after it's been applied to prod.** Add a new numbered file instead.

---

## Railway deploy

- Single service wired to this repo's `main` branch
- Postgres plugin provides `DATABASE_URL` (injected as a reference variable)
- Build: `npm ci && npm run build` (builds both client and server)
- Start: `npm run migrate && npm run start` (runs migrations, then serves client/dist + API from `:$PORT`)
- Health check: `GET /api/health` returns `{ ok: true, db: true }` when the DB is reachable
- Required env vars: `DATABASE_URL`, `JWT_SECRET`, `PIN_KARRIE`, `PIN_ERIC`, `NODE_ENV=production`

`NODE_ENV=production` makes the server serve `client/dist/` and SPA-fallback to `index.html`.

---

## Sprint status

- **Sprint 0 (done):** Scaffolding — workspace, Vite client with Login/Home placeholders, Express server, JWT auth, migrations, Railway config, seed script.
- **Sprint 1 (next):** Search-first home, recipe card view, manual entry, browse by protein, font-size slider, and one-time import of Karrie's ~150 existing recipes from the v1 repo.
- **Sprints 2–5:** Ingestion engine (HelloFresh/PDF/YouTube/Instagram), cooking mode, presentation mode, faith & polish (ESV blessings, equipment, Publix aisle grocery list), then v1.5 features.

---

## Conventions

- **TypeScript strict mode everywhere.** `npm run typecheck` from the repo root checks both workspaces.
- **No `any`** unless isolated at an I/O boundary with a TODO comment explaining why.
- **AI calls are server-side only.** `ANTHROPIC_API_KEY` lives in Railway env, never ships to the client.
- **Admin routes are explicit.** Any feature Eric-only lives under `/admin/*` and is gated by `requireAdmin`.
- **Migrations are append-only.** If a schema change is needed, add `008_*.sql`, never edit an applied one.
- **Recipes carry edit history.** Every mutation writes a row to `recipe_edit_history` with the previous snapshot; the UI stays simple (no version picker), but history is preserved.
- **No feature lands without Karrie's green light.** Eric has admin power, not UX veto.
