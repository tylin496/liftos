# LiftOS

Training, Nutrition, and Health tracking. Vite + React + TypeScript frontend
(GitHub Pages), talking directly to Supabase (Postgres + RLS + Auth) — no custom
API server. Google sign-in via Supabase Auth; Apple Health syncs nightly through
a Supabase Edge Function.

- Tabs: Overview / Training / Nutrition / Health — [docs/LIFTOS-ARCHITECTURE.md](docs/LIFTOS-ARCHITECTURE.md)
- Health sync — [docs/HEALTH-SYNC.md](docs/HEALTH-SYNC.md)

## Local preview

```bash
cp .env.local.example .env.local   # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev                        # http://127.0.0.1:5173/ — sign in with Google
```

## Scripts

```bash
npm run dev        # local dev server
npm run build      # typecheck + production build
npm run test       # vitest
npm run lint:css   # stylelint (design token enforcement)
```

## Google OAuth

Create an OAuth 2.0 **Web application** client in [Google Cloud Console](https://console.cloud.google.com/),
with authorized origins `https://tylin496.github.io` and `http://127.0.0.1:8765`,
then add the client ID + secret to Supabase Dashboard → Authentication → Providers.
