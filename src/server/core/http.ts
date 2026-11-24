// HTTP error replies — always `{error: <ErrorCode>}` (HttpErrorResponseSchema).
import type { ErrorCode, HttpErrorResponse } from '../../shared/protocol';

export function httpError(status: number, error: ErrorCode): Response {
  const body: HttpErrorResponse = { error };
  return Response.json(body, { status });
}
