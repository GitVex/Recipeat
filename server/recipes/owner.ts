import { createError, type H3Event } from 'h3'
import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'

/**
 * Who owns the rows this request may touch. Read from the session and nowhere
 * else — a body naming an owner is naming someone else's recipes.
 *
 * `requireUserSession` already answers 401 for no session at all; this adds
 * the case of a session whose token carries no subject, which nothing can be
 * attributed to. `sub` is in `optionalClaims`, so it is present because
 * nuxt.config asks for it rather than because it must be.
 */
export async function requireOwnerSub(event: H3Event): Promise<string> {
  const session = await requireUserSession(event)
  const sub = session.claims?.sub
  if (typeof sub !== 'string' || !sub) throw createError({ statusCode: 401, message: 'This session has no subject.' })
  return sub
}
