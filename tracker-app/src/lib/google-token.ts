/**
 * Google OAuth Token Manager
 *
 * Solves the "Gmail disconnects after deploy" problem by persisting the
 * Google refresh token in the Supabase `profiles` table and using it to
 * mint fresh access tokens client-side whenever `session.provider_token`
 * is unavailable (which happens after every Vercel deploy / page reload
 * once the short-lived access token expires).
 *
 * Flow:
 * 1. On OAuth callback, Supabase gives us `provider_token` (access, 1h)
 *    and `provider_refresh_token` (refresh, long-lived). We save the
 *    refresh token to `profiles.google_refresh_token`.
 * 2. On subsequent loads, if `provider_token` is null, we read the
 *    refresh token from the DB and exchange it for a new access token
 *    via Google's token endpoint.
 * 3. The access token is cached in memory for its lifetime.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

// In-memory cache to avoid redundant refreshes within the same session
let cachedAccessToken: string | null = null
let cachedExpiresAt = 0 // ms timestamp

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>

/**
 * Persist the Google refresh token to the user's profile in Supabase.
 * Called once when we first receive the token from the OAuth callback.
 */
export async function saveGoogleRefreshToken(
  supabase: AnySupabase,
  userId: string,
  refreshToken: string,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ google_refresh_token: refreshToken })
    .eq('id', userId)

  if (error) {
    console.warn('[google-token] Failed to save refresh token:', error.message)
  } else {
    console.log('[google-token] Refresh token saved to profile')
  }
}

/**
 * Load the persisted Google refresh token from the user's profile.
 */
export async function loadGoogleRefreshToken(
  supabase: AnySupabase,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('google_refresh_token')
    .eq('id', userId)
    .single()

  if (error || !data?.google_refresh_token) {
    return null
  }
  return data.google_refresh_token
}

/**
 * Remove the persisted Google refresh token (e.g., on disconnect).
 */
export async function clearGoogleRefreshToken(
  supabase: AnySupabase,
  userId: string,
): Promise<void> {
  await supabase
    .from('profiles')
    .update({ google_refresh_token: null })
    .eq('id', userId)
  cachedAccessToken = null
  cachedExpiresAt = 0
}

/**
 * Exchange a Google refresh token for a fresh access token.
 * Uses the same Google Cloud OAuth client credentials that Supabase uses.
 *
 * Note: The client ID and secret must be exposed via VITE_ env vars.
 * These are NOT secrets in the traditional sense for a public OAuth client
 * (Google documents this for installed/SPA apps), but we still only use
 * them for the token exchange, never for anything else.
 */
async function exchangeRefreshToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresInMs: number } | null> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.warn('[google-token] Missing VITE_GOOGLE_CLIENT_ID or VITE_GOOGLE_CLIENT_SECRET')
    return null
  }

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.warn(`[google-token] Token exchange failed: ${res.status}`, errBody)
      // If the refresh token is revoked/invalid, return null so caller knows
      return null
    }

    const data = await res.json() as {
      access_token: string
      expires_in: number // seconds
    }

    return {
      accessToken: data.access_token,
      expiresInMs: data.expires_in * 1000,
    }
  } catch (err) {
    console.warn('[google-token] Token exchange error:', err)
    return null
  }
}

/**
 * Get a valid Google access token, using this priority:
 *
 * 1. If `sessionProviderToken` is available (fresh from Supabase), use it.
 * 2. If we have a cached in-memory token that hasn't expired, use it.
 * 3. Otherwise, load the refresh token from DB and exchange it.
 *
 * Returns null if no token can be obtained (user must re-auth).
 */
export async function getGoogleAccessToken(
  supabase: AnySupabase,
  userId: string,
  sessionProviderToken: string | null,
): Promise<string | null> {
  // Priority 1: fresh provider token from Supabase session
  if (sessionProviderToken) {
    return sessionProviderToken
  }

  // Priority 2: in-memory cache
  if (cachedAccessToken && Date.now() < cachedExpiresAt) {
    return cachedAccessToken
  }

  // Priority 3: refresh from DB
  const refreshToken = await loadGoogleRefreshToken(supabase, userId)
  if (!refreshToken) {
    return null
  }

  const result = await exchangeRefreshToken(refreshToken)
  if (!result) {
    return null
  }

  // Cache with 5-minute safety margin
  cachedAccessToken = result.accessToken
  cachedExpiresAt = Date.now() + result.expiresInMs - 5 * 60 * 1000

  return result.accessToken
}

/**
 * Clear the in-memory access token cache (e.g., on sign-out).
 */
export function clearTokenCache(): void {
  cachedAccessToken = null
  cachedExpiresAt = 0
}
// env: 1775345016
