// A tag as the filter and the tag editor's suggestions see it (#13): its name
// as first typed, and how many of the owner's recipes wear it. Types only:
// the rules for a name live in shared/utils/tags.ts.
export type TagSummary = {
  name: string
  count: number
}
