# LiftOS

Training, Nutrition, and Health tracking backed by Supabase (Postgres + RLS +
Auth). Google sign-in is handled entirely by Supabase Auth. A Supabase Edge
Function bridges Apple Health data via the nightly Shortcut — see
[docs/HEALTH-SYNC.md](docs/HEALTH-SYNC.md).

## Google Cloud setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the OAuth consent screen (External or Internal).
3. Create **OAuth 2.0 Client ID** → Application type: **Web application**.
4. Authorized JavaScript origins:
   - `https://tylin496.github.io`
   - `http://127.0.0.1:8765` (local dev)
5. Add the client ID + secret to the Google provider in Supabase Dashboard →
   Authentication → Providers.

## Local preview

```bash
cp .env.local.example .env.local
# fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev
```

Open `http://127.0.0.1:5173/` and sign in with Google.
