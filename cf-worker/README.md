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

2. **Cloudflare** — `cd cf-worker && npm install`, then `npx wrangler login`
   (opens a browser to authorize; free account is fine).

3. **Set the secret** (prompts for the value, does not echo it):
   ```
   npx wrangler secret put GITHUB_TOKEN
   ```
   That is the only secret the worker needs — token verification uses the
   project's *public* JWKS, so there is no shared signing secret to store.

4. **Deploy**:
   ```
   npx wrangler deploy
   ```
   This prints the Worker URL, e.g. `https://liftos-image-upload.<subdomain>.workers.dev`.

5. **Wire the URL into the app**:
   - Local dev: add `VITE_UPLOAD_WORKER_URL=<that url>` to `.env.local`.
   - Production build: add a repo secret named `VITE_UPLOAD_WORKER_URL` at
     GitHub → repo → Settings → Secrets and variables → Actions, same place
     `VITE_SUPABASE_URL` already lives. The deploy workflow already reads it.

## Token verification (ES256 only)

The project signs access tokens with asymmetric keys, so every token it issues
declares `alg: ES256`. The worker fetches the matching public key (by `kid`)
from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` and verifies against it —
which is why `SUPABASE_URL` is set in `wrangler.toml` (public value, safe to
commit). The JWKS is cached for the life of the isolate.

**Any other `alg` is rejected outright.** An HS256 branch verifying against a
shared `SUPABASE_JWT_SECRET` used to sit here for legacy projects. Once the
project moved to asymmetric keys that branch became unreachable by any real
token, and it was removed on 2026-07-22 after the ES256 path was verified
end-to-end against production (commit `c907f88`). Don't re-add an algorithm
fallback: a branch only a foreign token can enter is an entry point, not a
safety net.

If uploads start 401ing with "Invalid or expired token" for the owner, check
that JWKS still returns an `ES256` key and that the token's `kid` is in it —
a key rotation mid-isolate is the one case the cache can get wrong.

## Changing the allowed origin

`ALLOWED_ORIGIN` in `src/index.ts` is hardcoded to
`https://tylin496.github.io`. Update it if the app ever moves domains.

## Redeploying after code changes

```
npx wrangler deploy
```
