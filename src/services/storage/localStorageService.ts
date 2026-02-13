export const readLocalStorage = <TValue>(storageKey: string, fallbackValue: TValue): TValue => {
  if (typeof window === 'undefined') {
    return fallbackValue
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey)

    if (!rawValue) {
      return fallbackValue
    }

    return JSON.parse(rawValue) as TValue
  } catch {
    return fallbackValue
  }
}

export const writeLocalStorage = <TValue>(storageKey: string, value: TValue): void => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const serializedValue = JSON.stringify(value)
    window.localStorage.setItem(storageKey, serializedValue)
  } catch {
    // Ignore write failures in the initial local-only phase.
  }
}
