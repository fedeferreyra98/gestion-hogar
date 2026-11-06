import { useSyncExternalStore } from 'react'
import { getSessionState, subscribeSession, type SessionState } from './session'

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSessionState)
}
