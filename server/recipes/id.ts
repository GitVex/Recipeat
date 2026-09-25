// A recipe id is a UUID the table generated. Checking the shape before the
// query keeps a typo out of Postgres, which answers a malformed uuid with a
// 22P02 error rather than an empty result — a 500 where a 400 is the truth.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isRecipeId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
