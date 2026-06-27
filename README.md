```markdown
# Lead Doctor

**AI‑Powered Lead Qualification & CRM Platform**

Lead Doctor is a modern, production‑grade SaaS application that helps you capture, qualify, and convert leads using artificial intelligence. It scrapes company websites, enriches lead data, and uses a Groq LLM to generate lead scores, business summaries, personalised outreach messages, and next‑step recommendations – all inside a beautiful, real‑time dashboard.

> _“Stop guessing which leads to pursue. Lead Doctor tells you – with data, scores, and ready‑to‑send emails.”_

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure & Module Overview](#project-structure--module-overview)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Run with Docker Compose](#run-with-docker-compose)
  - [Manual Development Setup](#manual-development-setup)
- [Usage](#usage)
  - [Authentication](#authentication)
  - [Services Selection](#services-selection)
  - [Lead Creation & AI Pipeline](#lead-creation--ai-pipeline)
  - [CRM Dashboard](#crm-dashboard)
- [API & Server Actions](#api--server-actions)
- [RBAC](#rbac)
- [Deployment](#deployment)
- [License](#license)

---

## Features

- **Authentication** – Email/password sign‑up & login (Better Auth) with role‑based access (admin / user).
- **Services Setup** – Choose the services your business offers from a configurable catalogue; stored per user.
- **Lead Capture** – Responsive form with validation (React Hook Form + Zod). Fields: company name, website, industry, employee range, description.
- **AI Qualification Pipeline** – Automatically scrapes the lead’s website, compresses the content, and queries Groq’s Llama 3.1‑8B to produce:
  - Lead quality score (0‑10)
  - Business summary
  - Personalised cold outreach message
  - Next step recommendation
- **Real‑time Progress** – Live progress bar and status messages (scraping → qualifying → done/failed).
- **Lead Management** – View all leads in a searchable, filterable table; change pipeline stage with a dropdown.
- **CRM Dashboard** – KPI cards (Total Leads, Qualified Leads, Average Score, Conversion Rate) with month‑over‑month trends.
- **Role‑Based Access Control** – Admins see all leads; users see only their own.
- **Security** – Rate limiting, Content Security Policy headers, CORS, form input limits.
- **Dark / Light Mode** – Multiple theme presets included.
- **Mobile Responsive** – Works on any device.
- **Production Docker Setup** – Multi‑stage Dockerfile with Chromium for scraping.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| UI Library | shadcn/ui |
| Forms | React Hook Form + Zod |
| State | Zustand (preferences) |
| Tables | TanStack Table |
| Auth | Better Auth (email/password) |
| AI | Groq SDK (Llama 3.1‑8B‑Instant) |
| Database | MongoDB (native driver) |
| Scraping | Playwright (Chromium) |
| Rate Limiting | In‑memory (extensible to Redis) |
| Linting | Biome, Husky |
| Deployment | Docker, Vercel (optional) |

---

## Architecture

Lead Doctor follows a **colocation‑first architecture**: each feature keeps its pages, components, and logic inside its route folder. Shared UI, hooks, and configuration live at the top level.

- **Server Actions** handle all data mutations and AI interactions – no separate API routes needed.
- **Optimistic UI** provides instant feedback while server actions complete.
- **RBAC** is enforced server‑side using `hasAccess` array on leads and user roles.
- The AI pipeline runs asynchronously via a background queue (in‑memory for MVP) and updates a pipeline status document that the client polls.

---

## Project Structure & Module Overview Looks like this

```
app/
├── (auth)/                 # Authentication pages (sign‑in, sign‑up)
│   └── auth/...
├── dashboard/
│   ├── layout.tsx          # Dashboard shell (sidebar, theme, etc.)
│   ├── crm/                # CRM Dashboard
│   │   ├── page.tsx        # Main dashboard (KPI cards + leads table)
│   │   ├── _components/
│   │   │   ├── kpi-cards.tsx
│   │   │   └── leads-table.tsx
│   │   └── actions.ts      # getLeadStatsAction, fetchLeadsForDashboard
│   ├── services/           # Services selection
│   │   ├── page.tsx
│   │   ├── _components/
│   │   │   └── ServiceSelector.tsx
│   │   └── actions.ts      # add/remove/get user services
│   ├── leads/              # Lead management
│   │   ├── new/page.tsx    # Lead creation form
│   │   ├── [leadId]/page.tsx # Lead detail + AI results + stage dropdown
│   │   ├── _components/
│   │   │   ├── NewLeadForm.tsx
│   │   │   ├── IndustryCombobox.tsx
│   │   │   ├── LeadAnalysis.tsx
│   │   │   └── StageDropdown.tsx
│   │   └── actions.ts      # createLead, getLead, startPipeline, updateStage, etc.
├── api/                    # (optional API routes – currently unused)
├── shared/                 # Shared UI components, hooks, utilities
├── middleware.ts           # Rate limiter, CSP, CORS
├── layout.tsx              # Root layout (metadata, robots: noindex,nofollow)
└── ...
```

### Core Modules Explained

| Module | What it does | Why it exists |
|--------|--------------|---------------|
| **Authentication** (`(auth)`) | Sign‑up, login, logout using Better Auth. | Secure access; first user becomes admin (role 0). |
| **Services** (`services/`) | User selects services they offer from a predefined catalogue. | AI uses selected services to tailor its recommendations. |
| **Leads** (`leads/`) | Full CRUD for leads, plus AI pipeline triggering. | Central object of the CRM; all qualification revolves around a lead. |
| **Pipeline** (`server/ai-integration/aiService.ts`) | Scrapes website, calls Groq, saves results. | Automates the heavy lifting of lead research. |
| **Dashboard** (`crm/`) | KPI metrics and leads table. | Gives a bird’s‑eye view of pipeline health. |
| **Middleware** (`middleware.ts`) | Rate limiting, security headers, CORS. | Protects the app from abuse and common web vulnerabilities. |
| **Config** (`lib/config/`) | Industries, services, employee ranges, etc. | Single source of truth for static options. |
| **DB Utils** (`lib/db/utils/`) | MongoDB helpers for users, leads, pipeline status. | Data access layer – keeps server actions clean. |

---

## Getting Started

### Prerequisites

- **Docker** and **Docker Compose** (for the easiest setup)
- A running **MongoDB instance** (local or MongoDB Atlas URI)
- **Node.js 22** (if running manually)
- A **Groq API key** (free tier available at [groq.com](https://groq.com))

### Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Required variables (also listed in `.env.example`):

```env
# MongoDB connection string
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/leaddoctor?retryWrites=true&w=majority"

# Better Auth secret (generate with `openssl rand -base64 32`)
BETTER_AUTH_SECRET="your-secret-here"

# Groq API Key
GROQ_API_KEY="gsk_..."

# Application URL (used for auth redirects)
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### Run with Docker Compose

The easiest way to spin up everything is with the provided `docker-compose.yml`. It starts the Next.js app and connects to your **external MongoDB** (passed via environment).

```bash
# Build and start in detached mode
docker compose up -d
```

The app will be available at [http://localhost:3000](http://localhost:3000).

**What’s in the compose file?**

- A single `app` service built from the production Dockerfile.
- Port `3000` exposed.
- Environment variables loaded from `.env.local` (or you can define them directly).
- No local MongoDB container – you must provide a `MONGODB_URI` pointing to your own instance.

### Manual Development Setup

If you prefer to run without Docker:

1. **Install Node.js 22+**.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables (see above).
4. Run the development server:
   ```bash
   npm run dev
   ```

The app will be available at [http://localhost:3000](http://localhost:3000).

**Note for local scraping:** Playwright’s Chromium is not automatically installed in dev mode. The app expects a system‑installed Chromium. If you’re on macOS/Windows, you may need to install Playwright browsers separately or set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and provide a path.

---

## Usage

### Authentication

1. Visit the app and you’ll be redirected to the **sign‑in** page.
2. Create an account – the first user automatically becomes **admin (role 0)**. Subsequent users are **standard (role 1)**.
3. After login, you’re taken to the CRM dashboard.

### Services Selection

- Navigate to **Manage Services** in the sidebar.
- Search and click on the services your business provides.
- Selected services appear at the top; the AI will later use them to recommend relevant offerings.

### Lead Creation & AI Pipeline

1. Click **New Lead** in the sidebar or go to `/dashboard/leads/new`.
2. Fill in the company name, website, industry, employee range, and description.
3. Submit – you’ll be redirected to the lead detail page.
4. The pipeline starts automatically (or click “Start Analysis”). A progress bar shows the scraping and qualification steps.
5. When complete, a results card displays the **score**, **summary**, **cold outreach message**, and **next step**.

### CRM Dashboard

- **KPI Cards** – Shows total leads, qualified leads, average score, and conversion rate this month, with trends.
- **Leads Table** – Search leads by any field, filter by stage, and click a lead to view details.
- **Stage Dropdown** – On each lead detail page, you can manually change the stage (New → Contacted → Qualified → …).

---

## RBAC

Leads have an `hasAccess` array. All new leads contain `[0,1]`, so both admins and users can access them. However:

- **Admins (role 0)** – See all leads where `hasAccess` contains `0`.
- **Users (role 1)** – See only leads where `hasAccess` contains `1` **and** `userId` matches their own.

This is enforced in all server actions that fetch leads.

---

## Deployment

The project includes a production‑ready **Dockerfile** that builds a standalone Next.js output and packages it with Chromium for scraping.

1. Run it:
   ```bash
   docker compose up 
   ```

You can also deploy to any platform that supports Docker (Fly.io, Railway, AWS ECS, etc.) or directly to Vercel (without Chromium – scraping will fail unless you use an external service).

---

## License

MIT © 2025 Lead Doctor. Built with passion and a lot of AI.

---

**Now go qualify some leads! 🚀**
```