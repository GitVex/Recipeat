Claude should not edit this!

# Issue Types

- Feat: A complete feature description, which must have a description and Acceptance Criteria. Optional fields in the feat issue are:
  - Context
  - Depends on
  - Blocks
  - Open Questions
  - Pointer (points to related files)
- Chore: A chore issue is a task that pertains to reworking or extending already implemented features, can optionally be linked by mention to the issue it relates to.
- Bug: A bug issue is a task that pertains to fixing a bug in the codebase.
- Plan: A placeholder issue for a feature to be implemented, likely only holding a title and a short description.

# Waves
A wave is a work package. It contains at most 5 Feature issues, At most 1 of these feature issues may be labeled with needs:migration.
Chore issues and Bug issues are not counted towards the wave limit. Sub-issues, of any kind, are not counted towards the wave limit.

# Branching
Branches should always be created from `master` and should be related to an issue. The branch name should then be `feat/<slug>`, `fix/<slug>` or `chore/<slug>` by title prefix. The `<slug>` should lead with the issue number and the issue title.
