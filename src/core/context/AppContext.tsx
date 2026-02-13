import { createContext, useMemo, useState, type ReactNode } from 'react'
import {
  getInitialAppState,
  persistAppState,
  type AppActions,
  type AppContextValue,
  type AppState,
} from './appState'

export const AppContext = createContext<AppContextValue | undefined>(undefined)

interface AppProviderProps {
  children: ReactNode
}

export const AppProvider = ({ children }: AppProviderProps) => {
  const [state, setState] = useState<AppState>(getInitialAppState)

  const actions = useMemo<AppActions>(
    () => ({
      setCurrentUser: (user) => {
        setState((previousState) => {
          const nextState = {
            ...previousState,
            currentUser: user,
            currentUserId: user?.id ?? null,
          }
          persistAppState(nextState)
          return nextState
        })
      },
      setUsers: (users) => {
        setState((previousState) => {
          const nextState = {
            ...previousState,
            users,
            currentUser: previousState.currentUser
              ? users.find((user) => user.id === previousState.currentUser?.id) ?? null
              : null,
          }
          persistAppState(nextState)
          return nextState
        })
      },
      setFleetUnits: (units) => {
        setState((previousState) => {
          const nextState = { ...previousState, fleetUnits: units }
          persistAppState(nextState)
          return nextState
        })
      },
      setMaintenancePlans: (plans) => {
        setState((previousState) => {
          const nextState = { ...previousState, maintenancePlans: plans }
          persistAppState(nextState)
          return nextState
        })
      },
      setAudits: (audits) => {
        setState((previousState) => {
          const nextState = { ...previousState, audits }
          persistAppState(nextState)
          return nextState
        })
      },
      setWorkOrders: (orders) => {
        setState((previousState) => {
          const nextState = { ...previousState, workOrders: orders }
          persistAppState(nextState)
          return nextState
        })
      },
      setRepairs: (repairs) => {
        setState((previousState) => {
          const nextState = { ...previousState, repairs }
          persistAppState(nextState)
          return nextState
        })
      },
      setExternalRequests: (requests) => {
        setState((previousState) => {
          const nextState = { ...previousState, externalRequests: requests }
          persistAppState(nextState)
          return nextState
        })
      },
      setInventoryItems: (items) => {
        setState((previousState) => {
          const nextState = { ...previousState, inventoryItems: items }
          persistAppState(nextState)
          return nextState
        })
      },
      setGlobalLoading: (value) => {
        setState((previousState) => ({
          ...previousState,
          isGlobalLoading: value,
        }))
      },
      setAppError: (errorMessage) => {
        setState((previousState) => ({
          ...previousState,
          appError: errorMessage,
        }))
      },
    }),
    [],
  )

  const contextValue = useMemo<AppContextValue>(
    () => ({
      state,
      actions,
    }),
    [actions, state],
  )

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
}
