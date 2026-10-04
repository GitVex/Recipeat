// How many distinct cooks it takes before shared ingredient data changes for
// everyone (#147). nuxt.config.ts reads these as runtimeConfig.community, so
// NUXT_COMMUNITY_KEY_COOKS and the others override them; a development .env
// sets them to 1, so one person can click through the whole flow.
export const COMMUNITY = {
  // Sightings that make an unmatched name a key of its own.
  keyCooks: 3,
  // Votes that make a name an alias of a key (#133). Higher, because a wrong
  // alias is silent: it gives the name another food's density.
  aliasCooks: 5,
  // Read by substitutions (#43).
  substitutionCooks: 3,
}

export type Community = typeof COMMUNITY

/** The thresholds set below their defaults, which the app warns about at startup. */
export const lowered = (community: Community) =>
  (Object.keys(COMMUNITY) as (keyof Community)[]).filter(name => Number(community[name]) < COMMUNITY[name])
