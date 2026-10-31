# Deployment

Static SPA on Netlify, data/auth/realtime on Supabase. There is no server of our
own, so the whole deployment is two things: a build that receives the right
public configuration, and a database whose access rules do the real security
work.

---

## 1. Required configuration

Vite inlines `VITE_*` variables into the JavaScript bundle **at build time**.
They are therefore configuration, not secrets — but they still never belong in
source control.

| Variable | Scope | Secret? | Where it comes from |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Builds | No | Supabase → Project Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Builds | No | Supabase → Project Settings → API |
| `VITE_APP_ENV` | Builds | No | Optional; `production` |
| `VITE_LOG_LEVEL` | Builds | No | Optional; `info` or `warn` |
| `SUPABASE_ACCESS_TOKEN` | *nowhere on Netlify* | **Yes** | Local `.env` / CI secret for `bun run db:push` |
| `SUPABASE_SECRET_KEY` | *nowhere in the frontend* | **Yes** | Only a Netlify Function, Functions scope |

The publishable key is designed to be public; row-level security is the
boundary. The secret/service key bypasses RLS and must never reach a `VITE_`
variable, the build environment, or a browser.

`src/core/env.ts` validates both required values with zod at startup. If either
is missing the app renders `ConfigBanner` with the exact problem instead of
booting a broken client.

---

## 2. Netlify setup

### Environment variables

**Site configuration → Environment variables → Add a variable**

1. `VITE_SUPABASE_URL` — value from Supabase, scope **Builds**, context
   **Production**.
2. `VITE_SUPABASE_PUBLISHABLE_KEY` — value from Supabase, scope **Builds**,
   context **Production**.
3. Optional: `VITE_APP_ENV=production`, same scope/context.

Use **Production** only. Deploy previews then show the configuration screen and
cannot read or write live candidate data. If previews are needed with real data,
create a second Supabase project first and add those values under the **Deploy
previews** context — never point a preview at production.

### CLI alternative

```bash
netlify env:set VITE_SUPABASE_URL "https://<ref>.supabase.co" --scope builds --context production
netlify env:set VITE_SUPABASE_PUBLISHABLE_KEY "sb_publishable_..." --scope builds --context production
```

Then push a commit, or use **Deploys → Trigger deploy** in the UI. There is no
separate “deploy” command for a Git-connected site.

> **Free plan:** Netlify rejects explicit `scopes` over the API with
> `403 Upgrade your Netlify account to set specific scopes`. Variables created
> without a scope use the default scopes. That is acceptable here because both
> values are public and Vite reads them at build time; scope them to **Builds**
> when the plan allows it.

Environment variables are applied to **new builds only**. Editing a variable
does not change an existing deploy.

### Build settings

Committed in [`netlify.toml`](../netlify.toml):

```toml
[build]
  command = "bun run build"
  publish = "dist"

[build.environment]
  BUN_VERSION = "1.2.19"
```

Netlify detects `bun.lock` and installs with Bun. `bun run build` runs
`tsc --noEmit` first, so a type error fails the deploy rather than shipping.

The `[[redirects]]` catch-all serves `index.html` for `/admin`,
`/room/:id`, `/candidate/:id`, `/analytics` and `/login`, which is what makes a
refresh on those routes work.

---

## 3. Supabase setup

### Auth URLs

**Authentication → URL Configuration**:

- **Site URL:** `https://debate-queuing-system.netlify.app`
- **Redirect URLs:**
  - `https://debate-queuing-system.netlify.app/**`
  - `http://localhost:5173/**`
  - `http://127.0.0.1:5173/**`

Magic links sent from production must return to the production origin. If the
Site URL is left at `localhost`, every email link breaks in the deployed app.
Add deploy-preview or custom-domain URLs explicitly; do not allow
`https://*.netlify.app/**` for the whole platform.

### Access control

- RLS is enabled on every table. `anon` can read only the public board columns.
- `evaluations` grants `anon` nothing; it is never public.
- A candidate's serial number and phone number are not part of the public page
  projection.
- Realtime publication must include the tables the board subscribes to
  (`candidates`, `rooms`; add `evaluations` if the rubric screen should live-update).

### Schema and migrations

```bash
bun run db:push
```

This uses the Management API and a personal access token from the local `.env`
(or `SUPABASE_DB_PASSWORD` as a fallback). Run it locally or in CI with a
repository secret. **Do not** add the access token to Netlify and do not run
schema changes from the frontend build.

---

## 4. Verify a deploy

1. Open the production URL in a private window.
2. No “Configuration problem” screen.
3. `/login` renders email/password and magic-link tabs.
4. Sign in with an email listed in `allowed_admins`.
5. `/admin` shows rooms, the three columns and a working `Call next`.
6. Hard-refresh `/admin` — the SPA redirect must keep the route.
7. Open DevTools → Console: no uncaught errors.
8. Send one magic link if that login path is used in production.

If step 2 fails, the build did not see both `VITE_*` variables. Check the build
log for the variable names, confirm they are in the **Builds** scope for the
**Production** context, then trigger a new deploy.

---

## 5. Operational rules

- **Rotate the publishable key** in Supabase and update the Netlify variable;
  redeploy. Rotation is cheap because the key is public and RLS is unchanged.
- **Never rotate by pasting a secret key** into Netlify. The frontend does not
  need it.
- **Do not commit `.env`.** `.env.example` documents the shape with placeholders.
- **Keep `bun.lock` committed** so Netlify and local installs resolve the same
  dependency graph.
- **No hardcoded fallback credentials.** If a deploy is missing config, fix the
  environment; do not restore a fallback in source.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| “Configuration problem” on the live site | `VITE_*` missing from the build | Add both in the Production context, redeploy |
| Magic link goes to `localhost:3000` | Auth Site URL still points at dev | Set the production Site URL in Supabase |
| Login succeeds but `/admin` is empty | Email not in `allowed_admins`, or RLS denial | Add the email; check the debug panel/logs |
| Board never updates live | Realtime publication or RLS on the subscribed tables | Add the table to the publication; re-check policies |
| `bun run build` says `command not found: tsc` on Windows | Non-ASCII checkout path breaks Bun’s bin resolution | Move to an ASCII path or invoke `node node_modules/typescript/bin/tsc --noEmit` |
