/** Thrown by Phase 2 handler stubs, so an unimplemented path fails loudly instead of silently. */
export class NotImplementedError extends Error {
  constructor(owner: string, what: string) {
    super(`Not implemented yet (${owner}): ${what}`);
    this.name = 'NotImplementedError';
  }
}
