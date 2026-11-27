# Code Patch STEM — Member Documentation System

A database-backed web application for the **Code Patch STEM SB Chapter**. Members keep their
**Member Documentation** and **Member — Volunteer Hours Record** (both reproduced from the chapter's official PDF) in one place;
the chapter administrator manages members, every document, an append-only edit history, and real-time notifications.

**Open the site: [sbcodepatchportal.com](https://www.sbcodepatchportal.com)** (chapter members sign in with the shared
password).

## Quick start (local)

Requirements: Node.js 22.18 or later (developed on Node 26). The database scripts load TypeScript files directly, which needs
Node's built-in type stripping (on by default since 22.18).

```bash
npm install
npm run setup      # writes .env.local with strong initial passwords (shown once in the terminal)
npm run dev        # http://localhost:3000
```

In development the first request creates the embedded database in `./.data/pglite`, applies the migrations, stores the two
initial passwords as scrypt hashes, and seeds three example departments and six positions (no members are seeded). Automatic
migration applies only to this embedded database; a PostgreSQL database is always migrated with `npm run db:migrate` (see below).

Sign-in flow:

1. **Shared website password** (`INITIAL_SITE_PASSWORD`) opens the member directory.
2. **Administrator** → **administrator password** (`INITIAL_ADMIN_PASSWORD`) opens the dashboard.
3. **+ Add Member** creates a member and shows their generated **personal password** once.
4. A member clicks their name in the directory and enters their personal password to reach only their own documentation.

Change the shared and administrator passwords afterwards in **Admin → Settings**. The `INITIAL_*` values are ignored once the
database is initialized.

## The three password systems

| System | Grants | Changed in | Effect of changing it |
| --- | --- | --- | --- |
| Shared website password | Member directory only | Settings | Signs out directory-only sessions. Member and admin passwords untouched. |
| Member password (one per member) | That member's own two documents | Member Management / Settings → Reset | Signs out that member only, clears their sign-in lock. |
| Administrator password | Everything, without member passwords | Settings (requires current password) | Signs out other admin sessions; current admin stays signed in. |

All three are verified on the server, stored only as scrypt hashes, and versioned so a change revokes existing sessions of that kind.

## Features

- **Member directory** — department columns with live member and department counts (from the database), search, and real-time updates when members are added, moved, edited, deactivated, or deleted. A member can belong to several departments: one main department plus any number of other departments, and appears in each of those columns.
- **Attendance** — Admin → Attendance: enter a meeting's name, date, and hours, tick who attended (with an optional number of hours to subtract per member), and submit. Each present member gets a row in their Volunteer Hours Record. Past meetings can be reopened to change one member's hours or deleted, which removes the hours they added; every change is in Edit History.
- **Departments and totals** — department member counts include members for whom it is an other department. Volunteer-hour totals per department, Edit History, and notifications use each member's main department, so no hour is counted twice.
- **Documentation workspace** — both PDF formats as interactive documents with autosave (debounced, per-field), explicit Save, print layouts that mirror the paper forms, multiple records per period, dated contribution entries, an expandable hours table, and an automatically calculated **Total Volunteer Hours**. Member Name, Chapter, Position/Role, and Organization fill in automatically from the member profile.
- **Download PDF and Copy to Google Docs** — next to Save and Print. Download PDF builds a US Letter PDF of the record in the browser, in the same layout as the printed form, using the bundled IBM Plex fonts in `public/fonts` (SIL Open Font License). Copy to Google Docs copies the record as formatted text and opens a new Google Doc ([docs.new](https://docs.new)) to paste into; no Google sign-in or setup is needed. Both export exactly what is on screen and nothing is sent to a server.
- **Exact PDF wording** — every label, heading, and the certification statement are kept verbatim in [`src/lib/document-text.ts`](src/lib/document-text.ts). The PDF's temporary instruction ("Please jot down how you contributed here…") appears only as on-screen guidance, never as stored or printed content.
- **Administrator dashboard** — Overview (live statistics, recent member activity, notifications, department totals), Member Management (search; department, position, and status filters; add, edit, deactivate/reactivate, delete, reset password), Documentation Management (per-member view and an all-entries feed with filters; open and edit any record without a member password; version history and restore), Edit History, Notifications, Department Management, and Settings.
- **Add Member** — validates input, creates the member with a unique ID (`CPS-1001`, …), generates a ~70-bit random password (shown once with a copy button; the dialog cannot be dismissed until the password is acknowledged), hashes it, issues both documents, and updates the directory, counts, and statistics immediately.
- **Edit History (audit log)** — every documentation, hours, account, password, department, position, and settings change, with actor, actor type, member, department, action, document, server timestamp (shown in America/New_York), and previous/new versions with a word-level diff. Filters: member search, department, action, document type, date range, actor type, sort order. Consecutive saves by the same person on the same record are grouped into one editing session so the log stays readable: a save joins the session while it comes within 10 minutes of the previous save and within 30 minutes of the session's first save; otherwise it starts a new entry.
- **Notifications** — generated in the same database transaction as member changes and account/security events (including sign-in lockouts), delivered in real time with an unread counter, dropdown, toast, full page, and mark read/unread/all.

## Architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.4 (App Router, Server Components, Server Actions), React 19.3, TypeScript |
| Styling | Tailwind CSS 4, IBM Plex Sans/Serif/Mono, Lucide icons |
| Database | PostgreSQL — embedded [PGlite](https://pglite.dev) in development, or any hosted PostgreSQL (Supabase, Neon, RDS) via `DATABASE_URL` |
| Data access | Parameterized SQL only (`$1…$n`), transactions around every write plus its audit record and notification |
| Authentication | Custom server-side sessions (random 256-bit tokens in httpOnly cookies, SHA-256 hashes in the `sessions` table) |
| Real time | Server-Sent Events (`/api/stream`) fed by a `realtime_events` table; each event is filtered by the viewer's session, and clients re-fetch through the authorized server render |

Supabase Auth was not used because the requirement is three independent password systems (one shared password, one per member,
one admin) rather than per-user email accounts. Supabase Realtime was replaced by an authorization-aware SSE stream that works on
any PostgreSQL host; with Supabase you only need its PostgreSQL connection string. No Supabase API keys are used.

### Database schema

Defined in [`src/lib/server/migrations.ts`](src/lib/server/migrations.ts) (`npm run db:print-sql` prints the complete SQL):

| Table | Purpose |
| --- | --- |
| `application_settings` | Organization info, shared/admin password hashes and versions, session preferences (single row) |
| `departments`, `positions` | Admin-managed options (unique names, display order) |
| `members` | Member records (`member_number` for the `CPS-####` ID, main department, position, email, status, start date) |
| `member_departments` | Other departments a member also belongs to (never the main one) |
| `meetings`, `meeting_attendance` | Attendance taken by the administrator: who attended, hours credited, and the volunteer-hours entry it added |
| `member_credentials` | Member password hash, version, last sign-in |
| `member_documentation` | Both document types: period, verification fields, submission dates |
| `contribution_entries` | Dated contribution entries of a Member Documentation |
| `volunteer_hours` | Date / description / hours rows (totals are always calculated with `SUM`) |
| `audit_logs` | Append-only history with name snapshots and no foreign keys, so it survives deletions |
| `notifications` | Admin notifications linked to audit records |
| `sessions`, `login_attempts` | Session store and rate-limiting ledger |
| `realtime_events` | Change feed for the event stream (pruned after a day) |
| `schema_migrations` | Applied migration versions |

Row Level Security is enabled on every table with no policies (deny by default). On Supabase, migrations 1 and 2 also revoke every
privilege that Supabase's Data API roles (`anon`, `authenticated`, `service_role`) receive automatically on new objects — limited to
this application's own tables, sequences, and trigger function, so other objects in a shared database keep their permissions. The
data is reachable only through the application server, which connects as the owner of these tables.

## How the database is configured

The logic lives in [`src/lib/server/db-config.ts`](src/lib/server/db-config.ts) and is shared by the app and the scripts.

| Situation | Database used |
| --- | --- |
| `DATABASE_URL` set | That PostgreSQL database |
| Not set, development (`npm run dev`) | Embedded PGlite in `./.data/pglite` |
| Not set, production (`npm start`, any `NODE_ENV=production`) | **Refuses to start** with a clear error, instead of silently using an empty local database |
| Not set, production with `ALLOW_EMBEDDED_DATABASE=true` | Embedded PGlite (single-server deployments only) |
| Not set, on Vercel | **Always refused** — the file system is read-only and each instance would have its own copy |

**Migrations.** Pending migrations are applied automatically **only to the embedded database in development** (`npm run dev`
without `DATABASE_URL`), when the server first opens it. A PostgreSQL database — Supabase, staging, production, or a local
PostgreSQL server — is never migrated by requests, in any environment: the app only checks that the schema is current and
otherwise refuses to serve, with a message telling you to run `npm run db:migrate`. `DATABASE_AUTO_MIGRATE=true` opts in to
automatic migration (for example for a disposable local PostgreSQL); `DATABASE_AUTO_MIGRATE=false` turns it off for the embedded
database too.

```bash
npm run db:print-sql -- --out schema.sql                                             # the complete SQL, for review (no connection)
npm run db:status  -- --env-file .env.supabase.local                                 # applied / pending migrations (read-only)
npm run db:migrate -- --env-file .env.supabase.local --confirm-target <project-ref>  # apply pending migrations in one transaction
```

`db:status` and `db:migrate` need a target: `DATABASE_URL` (from the shell or `--env-file`), or `--embedded` for the local
embedded database (stop `npm run dev` first — only one process may open it). They print the target host, port, database, TLS
mode, and for Supabase the project ref, never credentials. Each run is a single transaction: if anything fails, nothing is
changed. Use `--out` rather than shell redirection to save the SQL (npm adds banner lines to standard output, and Windows
PowerShell 5 redirects in UTF-16).

**Target safety.** These checks run before any connection is opened, and a refusal changes nothing:

- **`--env-file` is the only source of database settings.** When you pass `--env-file`, every `DATABASE_*` setting must come
  from that file. If any `DATABASE_*` variable is also set in your shell, where it would otherwise override the file and point
  the command at a different database, `db:print-sql`, `db:status`, `db:migrate`, and `credentials:reset` stop and name each
  variable and where it is set (never its value). Remove it from the shell (PowerShell: `Remove-Item Env:DATABASE_URL`; bash:
  `unset DATABASE_URL`) and run the command again. `Test-Path Env:DATABASE_URL` should print `False`.
- **The Target line names the Supabase project.** Supavisor pooler host names (`aws-0-<region>.pooler.supabase.com`) are shared
  by every project in a region, so staging and production would otherwise look the same. The project ref comes from the pooler
  user name `postgres.<project-ref>`, or from a direct host `db.<project-ref>.supabase.co`.
- **`--confirm-target` names the database you mean to change.** `db:migrate` and `credentials:reset` refuse to change a database
  that is not on this machine unless `--confirm-target` matches it: the **Supabase project ref**, or the **host name** for other
  PostgreSQL servers. A missing or different value stops the command before it connects. The embedded database and `localhost`
  need no confirmation. `db:status` is read-only and does not need the flag (if you give it, it is checked). A Supabase pooler URL
  whose user name has no project ref cannot be confirmed and is always refused.
- **Finding the project ref.** It is the project's short lowercase ID: in the dashboard address
  (`https://supabase.com/dashboard/project/<project-ref>`), under **Project Settings → General** (Project ID), in the project URL
  `https://<project-ref>.supabase.co`, and after `postgres.` in the pooler user name. Run `db:status` first and check that the
  ref on its Target line is the project you mean before you pass it to `--confirm-target`.
- **Lock timeout.** Every migration run starts with `SET LOCAL lock_timeout = '5s'`. If another migration holds the migration
  lock, or another session holds a lock on one of the tables, the run stops after 5 seconds and rolls back ("Nothing was
  changed") instead of waiting indefinitely. Run it again once the other work has finished.

**TLS.** For remote hosts the default is `verify-full`: the connection is encrypted and the server certificate and host name are
verified. Any `sslmode`/`ssl*` parameters in `DATABASE_URL` are removed before connecting, because node-postgres would otherwise
let them override certificate verification (for example, `sslmode=require` would silently discard the configured CA). An
`sslmode=require` in the URL is treated as `verify-full`; an explicit `DATABASE_SSL` always wins.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `INITIAL_SITE_PASSWORD` | First start | Initial shared website password (≥ 8 characters). Ignored after initialization. |
| `INITIAL_ADMIN_PASSWORD` | First start | Initial administrator password (≥ 10 characters, different from the shared one). Ignored after initialization. |
| `DATABASE_URL` | Production | PostgreSQL connection URL. Percent-encode special characters in the password (`#` → `%23`, `@` → `%40`). |
| `DATABASE_SSL` | No | `verify-full` (default for remote hosts), `verify-ca` (chain only; needs a CA certificate), `require` (encrypted but **not** verified), or `disable` (default for `localhost`). `verify` is accepted as `verify-full`. |
| `DATABASE_CA_CERT` | For Supabase | The server's CA certificate as PEM text (real newlines, `\n` escapes, or base64 all work). |
| `DATABASE_CA_CERT_FILE` | — | Alternative to `DATABASE_CA_CERT`: path to the `.crt` file. Handy for the command-line scripts. |
| `DATABASE_AUTO_MIGRATE` | No | Apply pending migrations automatically when the server opens the database. Default `true` only for the embedded database in development; `false` whenever `DATABASE_URL` is set and in production. `true` opts in, `false` opts out. |
| `ALLOW_EMBEDDED_DATABASE` | No | `true` lets a production server without `DATABASE_URL` use the embedded database (ignored on Vercel). |
| `DATABASE_POOL_MAX` | No | Connection pool size (default 5; 3 on Vercel). |
| `DATABASE_CONNECT_TIMEOUT_MS` | No | Time limit for opening a database connection (default 10000). |
| `PGLITE_DATA_DIR` | No | Embedded database location (default `./.data/pglite`). |
| `COOKIE_SECURE` | No | Set to `false` only when serving production over plain HTTP on a private network. |

`npm run setup` generates `.env.local`; see [`.env.example`](.env.example). All `.env*` files except the example are git-ignored.
Never commit connection strings or certificates.

Keep the production `DATABASE_URL` out of `.env.local` and `.env.development.local`: `npm run dev` loads both, so local testing
would read and write live data. Put it in a file Next.js does not load (such as `.env.supabase.local`) and pass that file to the
database scripts with `--env-file`.

## Using Supabase

A **dedicated, empty Supabase project** for this application is strongly recommended (separate credentials, backups, and
connection limits).

**Pre-flight check.** Before the first migration of any project, new or existing, run these read-only queries in the Supabase
SQL Editor of that project. They only read system catalogs and change nothing.

First, confirm where the new objects will be created:

```sql
select current_user, current_schema();
```

Expected result: `current_user` is `postgres` and `current_schema` is **`public`**. If `current_schema` is anything else, stop:
the migration's objects would be created in that schema instead.

Then run the full check. Every row should say `OK` or `INFO`; any `STOP` means do not run the migration:

```sql
-- Code Patch STEM: pre-flight check (read-only; it only reads system catalogs).
-- Every row should say OK or INFO. Any STOP means: do not run the migration.
with app_names(name) as (
  values
    ('application_settings'), ('departments'), ('positions'), ('members'), ('member_credentials'),
    ('member_documentation'), ('contribution_entries'), ('volunteer_hours'), ('audit_logs'),
    ('notifications'), ('sessions'), ('login_attempts'), ('realtime_events'), ('schema_migrations'),
    ('member_departments'), ('meetings'), ('meeting_attendance'),
    ('member_number_seq'), ('audit_logs_id_seq'), ('notifications_id_seq'), ('login_attempts_id_seq'),
    ('realtime_events_id_seq'),
    ('departments_name_unique'), ('positions_name_unique'), ('members_department_idx'), ('members_status_idx'),
    ('member_documentation_member_idx'), ('contribution_entries_document_idx'), ('contribution_entries_member_idx'),
    ('volunteer_hours_document_idx'), ('volunteer_hours_member_idx'), ('audit_logs_recent_idx'),
    ('audit_logs_member_idx'), ('audit_logs_document_idx'), ('audit_logs_record_idx'),
    ('notifications_recent_idx'), ('notifications_unread_idx'), ('notifications_audit_idx'),
    ('sessions_member_idx'), ('sessions_expires_idx'), ('login_attempts_key_idx'), ('login_attempts_ip_idx'),
    ('realtime_events_created_idx'), ('member_departments_department_idx'),
    ('meetings_date_idx'), ('meeting_attendance_member_idx'), ('meeting_attendance_entry_idx'),
    ('application_settings_pkey'), ('departments_pkey'), ('positions_pkey'), ('members_pkey'),
    ('members_member_number_key'), ('member_credentials_pkey'), ('member_documentation_pkey'),
    ('contribution_entries_pkey'), ('volunteer_hours_pkey'), ('audit_logs_pkey'), ('notifications_pkey'),
    ('sessions_pkey'), ('sessions_token_hash_key'), ('login_attempts_pkey'), ('realtime_events_pkey'),
    ('schema_migrations_pkey'), ('member_departments_pkey'), ('meetings_pkey'), ('meeting_attendance_pkey')
),
taken as (
  select c.relname::text as name,
         case c.relkind
           when 'r' then 'table' when 'p' then 'table' when 'v' then 'view' when 'm' then 'materialized view'
           when 'S' then 'sequence' when 'i' then 'index' when 'I' then 'index' when 'f' then 'foreign table'
           when 'c' then 'composite type' else c.relkind::text
         end as kind
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relname in (select name from app_names)
)
select 1 as step, 'PostgreSQL version' as item, current_setting('server_version') as finding,
       case when current_setting('server_version_num')::int >= 130000 then 'OK' else 'STOP' end as status
union all
select 2, 'Database and role running this check', current_database() || ' / ' || current_user,
       case when current_user = 'postgres' then 'OK' else 'CHECK (the migration runs as postgres)' end
union all
select 3, 'Schema that will receive the new objects',
       coalesce(current_schema(), '(none)') || '   search_path: ' || current_setting('search_path'),
       case when current_schema() = 'public' then 'OK' else 'STOP' end
union all
select 4, 'CREATE privilege on schema public', has_schema_privilege('public', 'CREATE')::text,
       case when has_schema_privilege('public', 'CREATE') then 'OK' else 'STOP' end
union all
select 5, 'PL/pgSQL and gen_random_uuid() available',
       (exists (select 1 from pg_language where lanname = 'plpgsql')
        and exists (select 1 from pg_proc where proname = 'gen_random_uuid'
                    and pronamespace = 'pg_catalog'::regnamespace))::text,
       case when exists (select 1 from pg_language where lanname = 'plpgsql')
             and exists (select 1 from pg_proc where proname = 'gen_random_uuid'
                         and pronamespace = 'pg_catalog'::regnamespace)
            then 'OK' else 'STOP' end
union all
select 6, 'Name already used in schema public: ' || name, kind, 'STOP'
from taken
union all
select 6, 'Names for 17 tables, 5 sequences, 44 indexes', 'all free', 'OK'
where not exists (select 1 from taken)
union all
select 7, 'Type name already used in schema public: ' || t.typname, 'type', 'STOP'
from pg_type t
where t.typnamespace = 'public'::regnamespace and t.typrelid = 0
  and t.typname in (select name from app_names)
union all
select 8, 'Function audit_logs_protect() already exists in public', 'function', 'STOP'
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname = 'audit_logs_protect'
union all
select 9, 'Supabase Data API roles (migration 2 removes their access to this app only)',
       coalesce((select string_agg(rolname::text, ', ' order by rolname::text) from pg_roles
                 where rolname in ('anon', 'authenticated', 'service_role')), '(none)'),
       'INFO'
union all
select 10, 'Tables already in schema public (left untouched)',
       (select count(*) from pg_class
         where relnamespace = 'public'::regnamespace and relkind in ('r', 'p'))::text,
       'INFO'
order by step, item;
```

Step 6 covers all 66 names the migrations create in `public`: 17 tables, 5 sequences, and 44 indexes, including the implicit
primary-key and unique-constraint indexes. Most clashes would only make the migration fail and roll back, but PostgreSQL silently
renames an automatically created sequence or index whose name is taken, and `CREATE TABLE IF NOT EXISTS` would silently reuse an
existing `schema_migrations` table, so every clash is a STOP. Step 7 catches a standalone type (such as an enum) with one of those
names, and step 8 the audit trigger function. Migration 3 replaces that function and creates no new names; migration 4 adds the
`member_departments` table and its two indexes, migration 5 only adds columns, and migration 6 adds the `meetings` and
`meeting_attendance` tables and their indexes (all included above).

1. **Connection strings.** In the Supabase dashboard, open **Connect** and copy two Supavisor pooler URIs: the **session pooler**
   (port `5432`, for running migrations) and the **transaction pooler** (port `6543`, for the deployed app). The user name has the
   form `postgres.<project-ref>`. Do not use the direct connection (`db.<project-ref>.supabase.co`) from Vercel: it is IPv6-only
   unless you buy Supabase's IPv4 add-on.
2. **CA certificate.** Supabase signs its server certificates with its own certificate authority. Download it from
   **Database settings → SSL Configuration** and keep it outside the repository.
3. **Local env file for the scripts** — for example `.env.supabase.local` (git-ignored; Next.js does not load this name):

   ```bash
   DATABASE_URL=postgresql://postgres.<project-ref>:<url-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   DATABASE_CA_CERT_FILE=C:/path/outside/repo/prod-ca-2021.crt
   ```

4. **Review and apply the schema** from a shell with no `DATABASE_*` variables set (`Test-Path Env:DATABASE_URL` prints `False`):

   ```bash
   npm run db:print-sql -- --out schema.sql
   npm run db:status  -- --env-file .env.supabase.local
   npm run db:migrate -- --env-file .env.supabase.local --confirm-target <project-ref>
   ```

   `db:status` prints the Target line (host, port, database, Supabase project ref, TLS mode) and `DATABASE_URL from:` (it must
   name your env file). Check both before migrating; `db:migrate` runs only when `--confirm-target` matches that project ref.

5. In **Table Editor**, confirm the 17 tables exist and are empty (`schema_migrations` has one row per migration). The first app
   start then creates the settings row from `INITIAL_*` and seeds departments and positions. No members are ever seeded.

If verification fails, the error explains the cause (missing CA certificate, host-name mismatch, IPv6-only host, wrong password,
or unknown pooler user). `DATABASE_SSL=verify-ca` verifies the certificate chain without the host-name check if your certificate
is not issued for the pooler host. `DATABASE_SSL=require` disables verification and should only be a temporary diagnostic.

## Deploying to Vercel

Set these in the Vercel project (**Settings → Environment Variables**), scoped to **Production** — give Preview deployments a
separate staging database or none at all, otherwise preview builds would write to production:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The Supabase **transaction pooler** URI (port `6543`) |
| `DATABASE_CA_CERT` | The contents of Supabase's CA certificate (paste the PEM; multi-line values are supported) |
| `INITIAL_SITE_PASSWORD`, `INITIAL_ADMIN_PASSWORD` | Fresh passwords for the first start only — never reuse development values. Remove them after the first sign-in. |

Then:

1. Run `npm run db:migrate -- --env-file .env.supabase.local --confirm-target <project-ref>` from your computer **before**
   deploying. Automatic migration is off for every PostgreSQL database, so the deployment refuses to serve until the schema is
   current.
2. Deploy. On Vercel the app uses a pool of 3 connections per instance and registers it with `attachDatabasePool`
   (`@vercel/functions`), which releases idle connections before an instance suspends.
3. Sign in as the administrator, confirm or change both passwords in Settings, and remove the `INITIAL_*` variables.

**Automatic deploys from GitHub.** Once the Vercel project is connected to the GitHub repository (Project Settings → Git), every
push to `main` deploys production, and every other branch gets a protected preview deployment (with no `DATABASE_URL`, so it
shows an error page by design). If a change adds a migration, run `npm run db:migrate` against the production database before
pushing it to `main`, as in step 1. Changes to environment variables take effect only after a redeploy.

The live-update stream reconnects every four minutes to stay within function time limits. Without `DATABASE_URL`, a Vercel
deployment fails fast with an explanatory error rather than starting against an empty temporary database.

**Single server or VM:** `npm run build && npm start` with `DATABASE_URL`, or with `ALLOW_EMBEDDED_DATABASE=true` to keep the
embedded database (back up `./.data/pglite`, and run `npm run db:migrate -- --embedded` while the server is stopped after
upgrades). Put it behind HTTPS.

## Security measures

- scrypt password hashing (N=2¹⁴, r=8, p=1, per-password salt) with constant-time comparison; plaintext passwords are never stored or logged.
- Server-side authorization on every page, server action, and the event stream. A member session can open only that member's records — document, entry, and member IDs from the client are always re-checked against the session (URL tampering and forged requests are rejected).
- Sessions: opaque 256-bit tokens in `httpOnly`, `SameSite=Lax` cookies (`Secure` in production); hashed server-side; idle timeouts (configurable) and 12-hour absolute lifetime for member/admin sessions; revoked on password change, reset, deactivation, or deletion.
- Rate limiting stored in the database: 5 failures per account per IP within 15 minutes locks that combination, with per-account and per-IP ceilings, randomized failure delay, and an admin notification on lockout.
- Append-only audit log enforced by a PostgreSQL trigger (no `DELETE`/`TRUNCATE`; recorded fields immutable; only an open editing session's latest values can be extended, only within 15 minutes of its last change, and never once 30 minutes have passed since its first save). The application applies the same 30-minute limit, so a longer editing session continues in a new entry. The trigger applies to every database role except an owner who deliberately disables it.
- Database commands refuse ambiguous targets before connecting: with `--env-file`, no `DATABASE_*` setting may also be set in the shell; changing a database that is not on this machine requires `--confirm-target`; and a migration gives up after waiting 5 seconds for a lock.
- Database connections verify the server's TLS certificate and host name by default; TLS settings cannot be weakened by parameters inside `DATABASE_URL`. Configuration and connection errors never include connection strings, passwords, or certificate contents.
- Supabase Data API roles have no access to this application's tables, sequences, or functions, and Row Level Security is enabled on every table.
- Input validation and length limits on every field; all SQL parameterized, with column names taken only from fixed allow-lists.
- Server Actions' built-in Origin check (CSRF protection), security headers (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP in production, `noindex`), no `X-Powered-By`.
- Safe error handling: internal errors are logged server-side and users see generic messages.

## Tests

```bash
npm run typecheck        # TypeScript
npm run lint             # ESLint (Next.js + React rules)
npm run build            # production build
npm run test:audit          # audit-log immutability and the 30-minute merge cap: the trigger and the app's merge logic (in-memory PostgreSQL)
npm run test:migrations     # migration runner, upgrades, lock timeout, rollback on failure, Supabase API-role permissions (simulated roles)
npm run test:db-config      # production guard, TLS settings, certificates, project refs, secret-free errors, attachDatabasePool
npm run test:target-safety  # --env-file shell check, --confirm-target, and `next dev` not migrating PostgreSQL (no real database)
npm run test:security       # unauthenticated / forged-cookie access sweep against a running server (BASE_URL, default http://localhost:3000)
```

`test:db-config` also runs real TLS handshakes with the node-postgres driver against a temporary local server, using
certificates generated with `openssl` (skipped if `openssl` is not found; set `OPENSSL_BIN`). `test:target-safety` runs the
command-line scripts with a network guard that blocks every outgoing connection (so a refusal is proven to happen before
connecting), and starts `next dev` twice against a fake PostgreSQL server that records statements and runs none (about 30
seconds; stop `npm run dev` first). No test connects to an external database.

End-to-end checks performed in a browser against the running app:

- Shared password accepted; wrong password rejected; the admin password is not accepted as the shared password.
- Member passwords work independently; another member's password is rejected; a member cannot open another member's page by URL, cannot reach any admin route, and forged Server Action requests against another member's records (including claiming the admin role) are rejected.
- The administrator opens and edits any member's documentation without the member's password, and those edits are recorded as Administrator actions.
- Add Member generates the ID, password, and both documents; the member appears in the right column and counts update live in other open tabs.
- Department change, deactivation, reactivation, and deletion update the directory and counts; history for a deleted member remains.
- Autosave persists across sign-out and sign-in; hours totals update on add, edit, and delete; deleted entries can be restored from history.
- Member actions produce notifications that appear on an open admin dashboard without a refresh; five bad passwords lock sign-in and notify the admin; a password reset issues a working new password and invalidates the old one.
- Changing the shared password does not affect admin or member sessions or passwords.

## Recovery

If the shared or administrator password is lost:

```bash
npm run credentials:reset -- site                                                                # embedded database (stop npm run dev first)
npm run credentials:reset -- admin --env-file .env.supabase.local --confirm-target <project-ref> # Supabase / PostgreSQL
```

This prints a new random password, stores only its hash, signs out sessions of that kind, and writes an audit record. It connects
with the same TLS verification as the app, and applies the same target-safety checks as `db:migrate` before connecting.

## Known limitations

- One administrator account (the role described in the requirements); there are no separate admin user accounts.
- Generated member passwords are shown to the administrator to deliver in person; email delivery is not built in.
- "Supervisor Signature" is a typed signature, not a cryptographic e-signature. Printed copies leave blank lines for wet signatures.
- The schema, permissions, and TLS behaviour are covered by local tests (PostgreSQL 19 via PGlite with simulated Supabase roles, and a local TLS server), and the migrations are applied on a live Supabase project (PostgreSQL 17) that serves the deployed app. Nothing in the schema needs a version newer than 13.
- The 5-second migration lock timeout is verified with a simulated lock wait and inside a real migration transaction, not with two
  competing PostgreSQL sessions (the embedded test database allows only one session).
- The deployed app uses Supabase's transaction pooler (port 6543). Parameterized queries, transactions, and concurrent queries were checked through it against a live project with full TLS verification; it works because the app uses no session state, LISTEN/NOTIFY, named prepared statements, or temporary tables. Migrations should still run over the session pooler (port 5432).
- Anyone with the database owner's credentials or Supabase dashboard access can bypass application rules, including disabling the audit trigger. Protect those credentials and the service-role key.
- Rate limiting relies on `X-Forwarded-For`; make sure your proxy or host sets it correctly.
