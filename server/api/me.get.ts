import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return { provider: session.provider, subject: session.claims?.sub, profile: session.userInfo }
})
