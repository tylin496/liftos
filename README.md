# LiftOS

A small calorie and protein tracker backed by a Notion database through Vercel API routes.

## Required Vercel environment variables

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `GOOGLE_CLIENT_ID` — OAuth 2.0 Web client ID (Google Cloud Console)
- `ALLOWED_GOOGLE_EMAILS` — comma-separated allowlist, e.g. `you@gmail.com,partner@gmail.com`
- `SESSION_SECRET` — long random string for signing session cookies (`openssl rand -hex 32`)

Remove legacy `APP_ACCESS_KEY` after deploying Google auth.

## Google Cloud setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the OAuth consent screen (External or Internal).
3. Create **OAuth 2.0 Client ID** → Application type: **Web application**.
4. Authorized JavaScript origins:
   - `https://tylin496.github.io`
   - `http://127.0.0.1:8765` (local dev)
5. Copy the client ID into `GOOGLE_CLIENT_ID` on Vercel.

Only emails listed in `ALLOWED_GOOGLE_EMAILS` can sign in. Data stays in your single Notion database; Google auth gates who may read or write it.

## Local preview

```bash
cp .env.local.example .env.local
# fill in NOTION_*, GOOGLE_CLIENT_ID, ALLOWED_GOOGLE_EMAILS, SESSION_SECRET
npm run dev
```

Open `http://127.0.0.1:5173/` and sign in with an allowed Google account.
# liftos
