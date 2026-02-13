import type { AppUser } from '../../types/domain'

export const authenticateUser = (username: string, password: string, users: AppUser[]): AppUser | null => {
  const normalizedUsername = username.trim().toLowerCase()
  const normalizedPassword = password.trim()

  const match = users.find(
    (user) => user.username.trim().toLowerCase() === normalizedUsername && user.password === normalizedPassword,
  )

  return match ?? null
}
