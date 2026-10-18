/**
 * Applies `supabase/schema.sql` to your Supabase project from the command line,
 * so you never have to copy-paste it into the SQL Editor.
 *
 *   npm run db:push
 *
 * It needs ONE of these in `.env` (see the file for details):
 *
 *   SUPABASE_ACCESS_TOKEN  — a Personal Access Token (recommended, no password needed)
 *                            https://supabase.com/dashboard/account/tokens
 *
 *   SUPABASE_DB_PASSWORD   — the database password chosen when the project was created
 *
 * After applying, it re-checks the REST API to confirm the tables are live.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------ .env loader ------------------------------ */
function loadEnvFile(path) {
  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    const key = match[1]
    let value = match[2]
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(join(root, '.env'))
loadEnvFile(join(root, '.env.local'))

/* ------------------------------- config ---------------------------------- */
const sql = readFileSync(join(root, 'supabase', 'schema.sql'), 'utf8')

const rawUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
let projectRef = process.env.SUPABASE_PROJECT_REF || ''
if (!projectRef && rawUrl) {
  try {
    projectRef = new URL(rawUrl).hostname.split('.')[0]
  } catch {
    /* ignore */
  }
}
if (!projectRef) projectRef = 'zhfrferzepxshdryuazq'

const anonKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''

const accessToken = process.env.SUPABASE_ACCESS_TOKEN
const secretKey = process.env.SUPABASE_SECRET_KEY
const dbPassword = process.env.SUPABASE_DB_PASSWORD

/* --------------------------- admin auth user ----------------------------- */
async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD

  if (!email) {
    console.log('ℹ️  No ADMIN_EMAIL in .env — skipping auth user creation.')
    return
  }
  // The GoTrue admin API (secret key) is the reliable path — the Management
  // API's auth-users endpoint is not available on every project.
  const useSecretKey = Boolean(secretKey)
  const useManagementApi = !useSecretKey && Boolean(accessToken)

  if (!useManagementApi && !useSecretKey) {
    console.log('ℹ️  Needs SUPABASE_ACCESS_TOKEN or SUPABASE_SECRET_KEY — skipping auth user creation.')
    return
  }

  const endpoint = useManagementApi
    ? `https://api.supabase.com/v1/projects/${projectRef}/auth/users`
    : `${rawUrl || `https://${projectRef}.supabase.co`}/auth/v1/admin/users`

  const headers = useManagementApi
    ? { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    : { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' }

  console.log(`→ Ensuring the auth user "${email}" exists…`)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })

  const text = await response.text()

  if (response.ok) {
    console.log('✅ Auth user created with the email pre-confirmed.')
    return
  }
  if (response.status === 409 || response.status === 422 || /already|exists/i.test(text)) {
    console.log('ℹ️  Auth user already exists — left untouched.')
    return
  }

  console.warn(`⚠️  Could not create the auth user automatically (HTTP ${response.status}).`)
  console.warn(`   ${text.slice(0, 300)}`)
  console.warn('   Create it manually: Dashboard → Authentication → Users → Add user')
  console.warn('   (tick "Auto Confirm User" so no confirmation email is needed).')
}

/* ------------------------------- helpers --------------------------------- */
function fail(message, hint) {
  console.error(`\n❌ ${message}\n`)
  if (hint) console.error(`${hint}\n`)
  process.exit(1)
}

/** Confirm the tables exist by hitting the REST API with the publishable key. */
async function verify() {
  if (!anonKey) return skipVerification('no publishable key in .env to verify with')
  const base = rawUrl || `https://${projectRef}.supabase.co`
  try {
    const response = await fetch(`${base}/rest/v1/candidates?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    })
    if (response.status === 200) {
      console.log('✅ Verified: the "candidates" table is reachable through the REST API.')
      return
    }
    const body = await response.text()
    console.warn(`⚠️  Verification returned HTTP ${response.status}: ${body.slice(0, 200)}`)
  } catch (error) {
    console.warn(`⚠️  Could not verify: ${error.message}`)
  }
}

function skipVerification(reason) {
  console.warn(`⚠️  Skipping verification (${reason}).`)
}

/* --------------------------- strategy: token ----------------------------- */
async function applyViaManagementApi() {
  console.log(`→ Applying schema via the Supabase Management API (project ${projectRef})…`)
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })

  const text = await response.text()
  if (!response.ok) {
    fail(`Schema failed (HTTP ${response.status}):\n${text.slice(0, 800)}`)
  }
  console.log('✅ Schema applied successfully.')
}

/* -------------------------- strategy: password --------------------------- */
async function applyViaPostgres() {
  console.log(`→ Applying schema via a direct Postgres connection (project ${projectRef})…`)
  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    fail(
      'The "pg" package is missing.',
      'Install it with:  npm install --save-dev pg',
    )
  }

  const client = new pg.Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
    password: dbPassword,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
  } catch (error) {
    fail(`Could not connect to the database: ${error.message}`)
  }

  try {
    await client.query(sql)
    console.log('✅ Schema applied successfully.')
  } finally {
    await client.end()
  }
}

/* --------------------------------- main ---------------------------------- */
if (accessToken) {
  await applyViaManagementApi()
  await ensureAdminUser()
} else if (dbPassword) {
  await applyViaPostgres()
  await ensureAdminUser()
} else {
  fail(
    'No credentials found to apply the schema.',
    [
      'Add ONE of these to your .env file, then run `npm run db:push` again:',
      '',
      '  SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxx   (create at https://supabase.com/dashboard/account/tokens)',
      '  SUPABASE_DB_PASSWORD=your-db-password    (the password set at project creation)',
    ].join('\n'),
  )
}

await verify()
