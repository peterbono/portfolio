# Supabase Migrations

## Overview

This directory contains SQL migrations for the JobTracker SaaS Supabase project.

| Migration | Purpose |
|-----------|---------|
| `001_rls_policies.sql` | Enables Row Level Security on all tables and the `documents` storage bucket |

## How to Apply

### Option A: Supabase Dashboard (recommended for first run)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) and select the project (`vcevscplobshspnficnk`).
2. Navigate to **SQL Editor**.
3. Paste the contents of `migrations/001_rls_policies.sql`.
4. Click **Run**.
5. Verify in **Authentication > Policies** that all tables show policies.

### Option B: Supabase CLI

```bash
# Install the CLI if you haven't already
npm install -g supabase

# Link to the remote project (you'll need the project ref and DB password)
supabase link --project-ref vcevscplobshspnficnk

# Push the migration
supabase db push
```

### Option C: Direct psql connection

```bash
# Get the connection string from Supabase Dashboard > Settings > Database
psql "postgresql://postgres:[PASSWORD]@db.vcevscplobshspnficnk.supabase.co:5432/postgres" \
  -f migrations/001_rls_policies.sql
```

## RLS Architecture

### Identity Model

- `profiles.id` = `auth.uid()` (the profile PK is the auth user ID)
- All other tables use a `user_id` column that must match `auth.uid()`

### Per-Table Policies

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
|-------|--------|--------|--------|--------|-------|
| `profiles` | own | own | own | -- | No client-side delete; use server function |
| `job_listings` | own | own | own | own | Full CRUD |
| `applications` | own | own | own | own | Full CRUD |
| `application_events` | own | own | own | own | Full CRUD |
| `bot_runs` | own | own | own | -- | No delete; audit trail |
| `bot_activity_log` | own | own | -- | -- | Append-only; no update/delete |
| `search_profiles` | own | own | own | own | Full CRUD |
| `platform_stats` | all auth | -- | -- | -- | Read-only for clients; service_role writes |

### Storage Bucket: `documents`

The `documents` storage bucket uses path-based isolation. Each user's files live under `{userId}/...`. The migration creates `storage.objects` policies that enforce this prefix, so users can only read/write files in their own folder.

### Service Role (Trigger.dev)

Server-side tasks (Trigger.dev workers) use the `SUPABASE_SERVICE_ROLE_KEY`, which **bypasses RLS entirely**. No special policies are needed for the bot pipeline -- it already has full access.

## Verifying RLS is Active

After applying the migration, verify in the Supabase Dashboard:

1. **Table Editor** > select any table > the "RLS" badge should show as **enabled**.
2. **Authentication > Policies** > each table should list its policies.
3. Test with the anon key: a query without a valid JWT should return zero rows.

## Rollback

To remove all policies and disable RLS (emergency only):

```sql
-- WARNING: This removes all security. Only use in development.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename, schemaname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_listings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_activity_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_stats DISABLE ROW LEVEL SECURITY;
```
