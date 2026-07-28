# meta-crm / Lead Doctor – Agent Guide

## Commands

| Action | Command | Notes |
|--------|---------|-------|
| Dev server | `npm run dev` | Port **3003** (not default) |
| Build | `npm run build` | ⚠️ Do NOT run unless explicitly permitted (can time out) |
| Lint | `npm run lint` | `biome lint` (NOT ESLint) |
| Format | `npm run format` | `biome format --write` |
| Full check | `npm run check` | `biome check` — lint + format |
| Auto-fix | `npm run check:fix` | `biome check --write` |
| Theme presets | `npm run generate:presets` | Scans `src/styles/presets/` → rewrites `src/lib/preferences/theme.ts` |

No test framework exists. No test files.

## Project Structure

- **`src/app/`** — Next.js App Router pages and layouts
- **`src/server/`** — Server-only modules (Instagram scraping, server actions, proxy)
- **`src/lib/`** — Shared utilities: auth, DB (MongoDB native + Mongoose), preferences, theme
- **`src/components/`** — shadcn/ui + custom components
- **`src/proxy.ts`** — Dev proxy (port-based rate limiting removed; for local use only)

Path alias `@/*` → `src/*`.

## Instagram Cookie-Based Extraction (`src/server/instagram/`)

### Architecture
- **No Selenium** — extraction uses direct GraphQL API calls over HTTP via a configurable proxy
- **Cookie-based**: Paste cookies JSON → `parseCookies()` extracts session data → `buildInstagramHeaders()` constructs browser-like headers → `proxyFetch()` sends proxied GraphQL queries
- **Single session**: one cookies JSON, sequential 1s-delay requests
- **Fault tolerant**: 429 triggers exponential backoff (up to 5min), 302/303 to login = SESSION_EXPIRED
- **Progress store** (`progress-store.ts`): in-memory run state for polling UI

### Key Files
| File | Purpose |
|------|---------|
| `cookie-session.ts` | Cookie parsing + Instagram header construction |
| `graphql-extractor.ts` | Profile info resolution, GraphQL pagination, follower extraction (all cookie-based) |
| `proxy-helper.ts` | ProxyAgent via undici, IP verification (`api.ip.cc`), `proxyFetch()` wrapper |
| `streaming-extractor.ts` | Multi-profile streaming extraction with progress callbacks, DB upsert |
| `actions.ts` | Server actions: start/poll/stop extraction, CSV export, scraped sources list |
| `progress-store.ts` | In-memory run state (create, poll, stop) |

### Extraction Flow
1. User pastes cookies JSON → `startCookieExtractionAction` parses and creates a run
2. `extractFollowersStreamFromCookies` verifies proxy, builds headers
3. For each target profile: call `extractFollowersFromCookies` → resolve profile info → paginate via GraphQL → upsert followers to DB
4. Stop signal is checked mid-pagination; stop is destructive (cannot resume in this session)

### DB Collections Used
- `instagramTargetProfiles` — tracks scraped/private/invalid status per profile
- `instagramFollowers` — stores follower records with appearance tracking

## Auth & RBAC
- **Better Auth** with email/password, MongoDB adapter
- **Roles**: admin = `role: 0`, user = `role: 1`
- First registered user becomes admin
- Admin-only Instagram actions enforced via `hasAccess` array and server-side checks in `actions.ts`

## Environment Variables
Required (from `.env.example`):
- `MongoDB_URI`, `MONGO_DB_NAME`
- `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `PROXY_URL` (optional, for Instagram cookie-based extraction)

## Docker
- Dev: `docker compose up` — `compose.yml` spins up the Next.js dev server (port 3003, hot-reload via volume mount)
- Prod: `compose.prod.yml` (port 3004)
- Requires external network: `mongodb-network`

## Style
- **Biome** (not ESLint/Prettier). Config at `biome.json` — includes import sorting groups, `useSortedClasses` for Tailwind, strict naming convention (`useFilenamingConvention: error`)
- Tailwind CSS v4 via `@tailwindcss/postcss`
- React 19 with compiler enabled (`reactCompiler: true` in `next.config.mjs`)
- No semicolons config in Biome (semicolons: always)

## Miscellaneous
- **No tests**: no test framework, no test files
- **Husky** listed as devDep but **not initialized** (no `.husky/` directory)
- **Theme system**: 4 presets (default, brutalist, soft-pop, tangerine), stored in cookies + localStorage, applied before hydration via `theme-boot.tsx`
- Theme presets are generated from CSS files — run `npm run generate:presets` after editing presets
- The project also contains a lead qualification AI pipeline (Groq SDK) — not typically impacted by Instagram work

## Work State
### Completed
- **Branch flow**: `fix/build-time-issues` → `c-r-2` (fast-forward merged) → `fix/serialize-mongodb-objectid-for-client` (current)
- `fix/build-time-issues`:
  - `mongodb.ts`: removed top-level `await client.connect()`, lazy `connectDb()` + `dbPromise`
  - `auth.ts`: `getAuth()` returns `any` (avoids incompatible Better Auth generic types)
  - `instagram.ts`: lazy collection getters, types extracted to `types.ts`, `connect.ts` deleted
  - `lib/db/utils/auth.ts` deleted (dead code), `user.ts`: lazy `getUsersCollection()`
  - `compose.yml` / `compose.prod.yml`: selenium-network removed
  - TypeScript: 0 errors was 19
- `fix/serialize-mongodb-objectid-for-client` (current):
  - `getAllFollowersAction`: maps MongoDB docs → plain objects (strips ObjectId `_id`, converts Date → ISO string)
  - `followers/page.tsx`: `.map()` simplified since action pre-serializes

### Active
### Blocked
