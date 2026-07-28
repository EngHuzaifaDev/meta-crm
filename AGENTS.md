# meta-crm / Lead Doctor – Agent Guide

## Commands

| Action | Command | Notes |
|--------|---------|-------|
| Dev server | `npm run dev` | Port **3003** (not default) |
| Build | `npm run build` | Next.js standalone output |
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

## Instagram Scraping Module (`src/server/instagram/`)

### Architecture
- **YAML-driven**: Navigation, login, and follower extraction are defined as YAML action sequences in `src/server/instagram/actions/`
- **ScrapingEngine** (`scraping-engine.ts`) executes YAML action definitions. Supported actions: `navigate`, `wait`, `waitFor`, `type`, `click`, `clickIfExists`, `extract`, `extractList`, `scrollToBottom`, `javascript`, `ifExists`, `repeat`
- **Template interpolation**: `{profile.username}`, `{credentials.username}` in selectors/URLs
- **Selenium WebDriver** connects to a **remote grid** at `SELENIUM_GRID_URL` (default `http://selenium-hub:4444`)
- **Human-like delays** (`humanDelay()`) are built into the engine and YAML `waitAfter` fields

### Key Files
| File | Purpose |
|------|---------|
| `driver.ts` | Chrome driver creation (1920x1080, anti-detection flags) |
| `login.ts` | Instagram login with cookie reuse and 2FA |
| `scraping-engine.ts` | YAML action executor (223 lines, single class) |
| `streaming-extractor.ts` | Multi-profile streaming extraction with progress callbacks |
| `actions.ts` | Server actions for credential/extraction management (admin-only RBAC) |
| `challenges.ts` | In-memory 2FA challenge store (5-min timeout) |
| `progress-store.ts` | In-memory run state for polling |

### Action YAML Files
| File | What it does |
|------|------|
| `login.yaml` | Full login flow: navigate → fill credentials → handle 2FA → dismiss dialogs |
| `navigate-profile.yaml` | Navigate to `{profile.username}` with error handling |
| `followers.yaml` | Click followers link → open dialog → scroll → extract usernames via JS |
| `reels.yaml` | Scroll reels (anti-detection break every 5 profiles) |

### Critical: Instagram Selectors Must Be Class-Agnostic
Instagram's CSS class names (like `_ap3a`, `x1i10hfl`) change between deployments/A-B tests. **Never use class-based selectors for element targeting.** Use:
- **XPath by text content**: `//a[.//span[contains(translate(text(), 'FOLLOWERS', 'followers'), 'followers')]]`
- **Structural attributes**: `span[dir='auto']`, `button` text matching
- **JavaScript DOM heuristics**: Walk from known elements (buttons) to find related elements

The `followers.yaml` `finalExtract` action uses JavaScript that:
1. Finds all buttons with text "follow"/"following"/"requested"/"remove"
2. Walks up 5 parent levels looking for `span[dir='auto']`
3. Filters spans with no spaces, ≤30 chars, matching `[\w.]` (username pattern)

### Extraction Flow
1. Login with cookies or 2FA
2. For each target profile: navigate → open followers dialog → scroll 20x → extract via JS
3. Every 5 profiles: scroll reels (anti-detection)
4. Uses in-memory 2FA challenge store (`challenges.ts`) — when extracting multiple profiles, 2FA is submitted inline without re-navigating to login page

### Session Management
- Cookies saved per credential after successful login (DB: `instagramCredentials` collection)
- Sessions expire after 7 days
- Session data: `{ cookies, userAgent, savedAt, expiresAt }`

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
- `GROQ_API_KEY`
- `SELENIUM_GRID_URL` (default: `http://selenium-hub:4444`)

## Docker
- Dev: `docker compose up` — `compose.yml` spins up the Next.js dev server (port 3003, hot-reload via volume mount)
- Prod: `compose.prod.yml` (port 3004)
- Requires external networks: `mongodb-network` and `autolog_selenium_public` (Selenium)

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
