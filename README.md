# LiftOS

A personal training-and-body dashboard. It keeps training, nutrition, and body
metrics in one place and turns them into a single call on what to change next —
add weight, eat more, or back off and recover.

Vite + React + TypeScript frontend (deployed to GitHub Pages), talking directly
to Supabase (Postgres + RLS + Auth) — no custom API server. Google sign-in via
Supabase Auth; Apple Health syncs nightly through an iOS Shortcut.

## The four tabs

| Tab | What it answers |
|-----|-----------------|
| **Overview** | Where am I, and what should I change? Phase progress (cut / maintenance / bulk), trend cards, and the decision engine's single recommendation |
| **Training** | Per-split exercise logging, PR detection, stall/deload flags, strength standards, weekly volume, muscle-group balance |
| **Nutrition** | Daily intake against a calorie budget and protein floor, plus an evaluation → recommendation pipeline |
| **Health** | Weight and body-fat trends, TDEE calibration, daily active-calorie target |

Each tab is a self-contained feature under `src/features/`: Supabase queries live
in its `api.ts`, pure logic in `logic.ts` and friends, each covered by `.test.ts`.

## Local preview

```bash
cp .env.local.example .env.local   # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install
npm run dev                        # http://127.0.0.1:5173/ — sign in with Google
```

## Scripts

```bash
npm run dev        # local dev server
npm run typecheck  # tsc -b --noEmit
npm run build      # typecheck + production build
npm run test       # vitest
npm run lint:css   # stylelint (design-token enforcement) + grey-surface rules
```

## Deploy

Every push to `main` runs tests, CSS lint, and build, then publishes `dist/` to
GitHub Pages — see [.github/workflows/deploy.yml](.github/workflows/deploy.yml).
Live at <https://tylin496.github.io/liftos/>.

## Docs

- [Architecture](docs/LIFTOS-ARCHITECTURE.md) — app shell, tabs, data flow
- [Decision Engine](docs/DECISION-ENGINE.md) — how the Overview recommendation is picked
- [Health sync](docs/HEALTH-SYNC.md) — the iOS Shortcut → Supabase pipeline
- [Color system](docs/COLOR-SYSTEM.md) and [Layout stability](docs/LAYOUT-STABILITY.md) — design rules the linters enforce

## Google OAuth

Create an OAuth 2.0 **Web application** client in [Google Cloud Console](https://console.cloud.google.com/),
with authorized origins `https://tylin496.github.io` and `http://127.0.0.1:8765`,
then add the client ID + secret to Supabase Dashboard → Authentication → Providers.
