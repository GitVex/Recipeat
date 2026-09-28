// Storage limits, shared so the editor stops at the same place the server
// would refuse. totalTime is in minutes, capped at a month: a cured ham is
// days, nothing is longer, and a site that says otherwise is reporting
// something else.
export const LIMITS = { title: 300, ingredient: 2000, quantity: 100, extra: 500, ingredients: 200, step: 5000, steps: 100, totalTime: 60 * 24 * 30 }
