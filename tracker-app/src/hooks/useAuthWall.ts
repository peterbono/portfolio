import { useCallback } from 'react'
import { useSupabase } from '../context/SupabaseContext'
import { useAuthWallContext, type AuthWallTrigger } from '../context/AuthWallContext'

/**
 * Hook that gates features behind authentication.
 *
 * Usage:
 *   const { requireAuth } = useAuthWall()
 *   const handleClick = () => {
 *     if (!requireAuth('start_bot', () => doTheThing())) return
 *     doTheThing()
 *   }
 *
 * - If authenticated: returns true immediately (caller proceeds)
 * - If not authenticated: opens auth wall modal, returns false (caller aborts)
 * - After successful auth in the modal: onSuccess callback fires
 */
export function useAuthWall() {
  const { session } = useSupabase()
  const { showAuthWall } = useAuthWallContext()

  const requireAuth = useCallback(
    (trigger: NonNullable<AuthWallTrigger>, onSuccess: () => void): boolean => {
      if (session) return true
      showAuthWall(trigger, onSuccess)
      return false
    },
    [session, showAuthWall]
  )

  return { requireAuth }
}
