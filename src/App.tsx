import { AppProvider } from './core/context/AppContext'
import { AppRouter } from './core/routing/AppRouter'

function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  )
}

export default App
