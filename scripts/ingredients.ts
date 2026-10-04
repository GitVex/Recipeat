// The ingredient table's chores from the host (#147), against the database
// .env names:
//
//   npm run ingredients:resolve      one resolver run, as the app runs every ten minutes
//
// The app reloads its snapshot on its next run, within ten minutes.

import postgres from 'postgres'
import { COMMUNITY, lowered, type Community } from '../server/ingredients/community.ts'
import { resolve } from '../server/ingredients/resolve.ts'

const url = process.env.NUXT_DATABASE_URL
if (!url) throw new Error('NUXT_DATABASE_URL is not set')

// The same overrides the app reads, as nuxt.config.ts maps them.
const community: Community = {
  keyCooks: Number(process.env.NUXT_COMMUNITY_KEY_COOKS ?? COMMUNITY.keyCooks),
  aliasCooks: Number(process.env.NUXT_COMMUNITY_ALIAS_COOKS ?? COMMUNITY.aliasCooks),
  substitutionCooks: Number(process.env.NUXT_COMMUNITY_SUBSTITUTION_COOKS ?? COMMUNITY.substitutionCooks),
}

const sql = postgres(url, { max: 2, onnotice: () => {} })
try {
  const [command] = process.argv.slice(2)
  if (command === 'resolve') {
    const low = lowered(community)
    if (low.length) console.warn(`Below their defaults: ${low.map(name => `${name} = ${community[name]}`).join(', ')}`)
    const { learned, renormalized } = await resolve(sql, community)
    console.log(learned.length ? `Learned ${learned.join(', ')}` : 'Nothing to learn')
    console.log(`Re-normalized ${renormalized} recipes`)
  } else {
    throw new Error('Usage: scripts/ingredients.ts resolve')
  }
} finally {
  await sql.end()
}
