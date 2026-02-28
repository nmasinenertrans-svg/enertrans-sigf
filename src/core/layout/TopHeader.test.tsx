/* @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TopHeader } from './TopHeader'

vi.mock('../hooks/useAppContext', () => ({
  useAppContext: () => ({
    state: {
      currentUser: {
        id: 'u-1',
        fullName: 'Dev User',
        username: 'dev',
        role: 'DEV',
      },
    },
    actions: {
      setCurrentUser: vi.fn(),
      setAppError: vi.fn(),
    },
  }),
}))

describe('TopHeader', () => {
  it('shows blocked items count in sync status badge', () => {
    render(
      <MemoryRouter>
        <TopHeader
          onToggleSidebar={() => null}
          syncStatus={{
            isOnline: true,
            pendingCount: 7,
            blockedCount: 3,
            isSyncing: false,
          }}
          notifications={[]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Bloqueados: 3/)).toBeTruthy()
  })
})
