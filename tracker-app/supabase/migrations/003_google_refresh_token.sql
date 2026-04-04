-- Add google_refresh_token column to profiles table.
-- Stores the long-lived Google OAuth refresh token so Gmail access
-- survives Vercel deploys and access token expiration (1h).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;

-- Only the user can read/update their own refresh token (already covered
-- by existing RLS policies on profiles: "Users can view own profile" and
-- "Users can update own profile").
COMMENT ON COLUMN public.profiles.google_refresh_token IS
  'Google OAuth refresh token for persistent Gmail access across deploys';
