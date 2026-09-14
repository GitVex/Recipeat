import { createError } from 'h3'

// `cause` reaches the server log through Nitro; it is never serialized to the
// client, so upstream detail can be attached without leaking it.
export const fail = (statusCode: number, message: string, cause?: unknown) =>
  createError({ statusCode, message, cause })
