import { useContext } from 'react'
import { AppContext } from '../context/AppContext'

export const useAppContext = () => {
  const contextValue = useContext(AppContext)

  if (!contextValue) {
    throw new Error('useAppContext must be used inside AppProvider')
  }

  return contextValue
}
