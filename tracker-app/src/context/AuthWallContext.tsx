import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

export type AuthWallTrigger =
  | 'sync_gmail'
  | 'start_bot'
  | 'save_cloud'
  | 'export_data'
  | null

interface AuthWallState {
  trigger: AuthWallTrigger
  onSuccess: (() => void) | null
}

interface AuthWallContextValue {
  /** Currently active auth wall trigger (null = closed) */
  authWall: AuthWallState
  /** Show the auth wall for a given trigger. Returns false (caller should abort). */
  showAuthWall: (trigger: NonNullable<AuthWallTrigger>, onSuccess: () => void) => void
  /** Close the auth wall */
  closeAuthWall: () => void
  /** Called when auth succeeds inside the wall */
  completeAuthWall: () => void
}

const AuthWallContext = createContext<AuthWallContextValue | null>(null)

export function AuthWallProvider({ children }: { children: ReactNode }) {
  const [authWall, setAuthWall] = useState<AuthWallState>({
    trigger: null,
    onSuccess: null,
  })

  const showAuthWall = useCallback(
    (trigger: NonNullable<AuthWallTrigger>, onSuccess: () => void) => {
      setAuthWall({ trigger, onSuccess })
    },
    []
  )

  const closeAuthWall = useCallback(() => {
    setAuthWall({ trigger: null, onSuccess: null })
  }, [])

  const completeAuthWall = useCallback(() => {
    const cb = authWall.onSuccess
    setAuthWall({ trigger: null, onSuccess: null })
    // Fire callback after state clears
    if (cb) setTimeout(cb, 100)
  }, [authWall.onSuccess])

  return (
    <AuthWallContext.Provider
      value={{ authWall, showAuthWall, closeAuthWall, completeAuthWall }}
    >
      {children}
    </AuthWallContext.Provider>
  )
}

export function useAuthWallContext() {
  const ctx = useContext(AuthWallContext)
  if (!ctx) throw new Error('useAuthWallContext must be used within AuthWallProvider')
  return ctx
}
