---
name: start-work
description: Start implementing a refined Recipeat GitHub issue - branch, plan against its acceptance criteria, build, check in the container. Use when the user says to start or pick up work on an issue number.
argument-hint: <issue number>
disable-model-invocation: true
---

# Start work on #$ARGUMENTS

1. **Read it, fresh, even if it was read earlier in the session.**
   `gh issue view $ARGUMENTS --json title,body,labels,milestone,comments`
   (not `--comments`, which without a terminal prints the comments and
   drops the body). Comments can change the scope: treat a later comment
   from the maintainer as overriding the body. Then its parent and
   sub-issues (`gh api graphql -f query='query{repository(owner:"GitVex",name:"Recipeat"){issue(number:$ARGUMENTS){parent{number title} subIssues(first:50){nodes{number title state}}}}}'`),
   everything it links, and the `docs/planning.md` sections it touches.

2. **Gate.** Stop and tell the user, rather than start, if:
   - it's a `Plan:`, or has no Acceptance criteria → suggest `/refine-issue $ARGUMENTS`;
   - it has open questions that block code;
   - something under "Depends on" is still open;
   - it isn't in the current Wave (lowest open `Wave N`): ask before going ahead.

3. **Branch.** From an up-to-date `master` (ask first if the working tree is
   dirty): `feat/<slug>`, `fix/<slug>` or `chore/<slug>` by title prefix,
   slug from the title.

4. **Plan briefly.** Map each acceptance criterion to the files it touches
   and say how each will be checked. Note if the work needs a migration and
   the issue isn't labelled `needs:migration` — that breaks Wave placement,
   so raise it. Then build.

5. **Check it.** Every criterion, not just the happy path. Run the tests
   in `CLAUDE.md` that cover the change, redeploy the `recipeat-app`
   container as `CLAUDE.md` describes, and test against
   `http://127.0.0.1:8100`. Tick off criteria as they're verified; say
   plainly which ones weren't.

6. **Finish.** Summarise what was done against the criteria. Commit only when
   asked, in the repo's style: `feat(area): what changed (#$ARGUMENTS)`. If a
   decision was made along the way, offer to record it in `docs/planning.md`.
