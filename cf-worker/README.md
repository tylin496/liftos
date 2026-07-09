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
   copy the **JWT Secret** (not the anon/service key).

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

## Changing the allowed origin

`ALLOWED_ORIGIN` in `src/index.ts` is hardcoded to
`https://tylin496.github.io`. Update it if the app ever moves domains.

## Redeploying after code changes

```
npx wrangler deploy
```
