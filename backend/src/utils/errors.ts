/**
 * Extracts the `code` property from an unknown error safely.
 * Use instead of `(error: any)?.code` in catch blocks.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code: unknown }
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}
