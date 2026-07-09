# liftos-image-upload

Cloudflare Worker that sits between the app's "Add photo" button and GitHub.
It verifies the caller is signed in as the app owner (via the same Supabase
JWT the app already uses), then commits the photo into `public/images/` in
this repo through the GitHub Contents API. No token ever reaches the browser.

## One-time setup

1. **GitHub token** — create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - Repository access: **only** `tylin496/liftos`
   - Permissions: **Contents → Read and write**
   - Nothing else.

2. **Supabase JWT secret** — Supabase Dashboard → Project Settings → API →
   copy the **JWT Secret** (not the anon/service key). Only needed as a fallback
   for projects still on legacy HS256 signing; ES256 (asymmetric-key) projects
   are verified via the public JWKS and don't use this secret.

3. **Cloudflare** — `cd cf-worker && npm install`, then `npx wrangler login`
   (opens a browser to authorize; free account is fine).

4. **Set the two secrets** (prompts for the value, does not echo it):
   ```
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put SUPABASE_JWT_SECRET
   ```

5. **Deploy**:
   ```
   npx wrangler deploy
   ```
   This prints the Worker URL, e.g. `https://liftos-image-upload.<subdomain>.workers.dev`.

6. **Wire the URL into the app**:
   - Local dev: add `VITE_UPLOAD_WORKER_URL=<that url>` to `.env.local`.
   - Production build: add a repo secret named `VITE_UPLOAD_WORKER_URL` at
     GitHub → repo → Settings → Secrets and variables → Actions, same place
     `VITE_SUPABASE_URL` already lives. The deploy workflow already reads it.

## Token verification (ES256 vs HS256)

The worker verifies the caller's Supabase access token against whatever
algorithm the token header declares:

- **ES256** — the default for projects using asymmetric JWT signing keys. The
  worker fetches the project's public key from
  `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` and verifies with it. This is
  why `SUPABASE_URL` is set in `wrangler.toml` (public value, safe to commit).
- **HS256** — legacy shared-secret projects; verified with `SUPABASE_JWT_SECRET`.

If uploads suddenly 401 with "Invalid or expired token" for the owner, check
whether the project migrated to asymmetric keys (JWKS returns an `ES256` key) —
an HS256-only worker cannot verify those tokens.

## Changing the allowed origin

`ALLOWED_ORIGIN` in `src/index.ts` is hardcoded to
`https://tylin496.github.io`. Update it if the app ever moves domains.

## Redeploying after code changes

```
npx wrangler deploy
```
