---
name: refine-issue
description: Refine a GitHub issue into Recipeat's issue shape (title prefix, template sections, labels, milestone per the Waves rules). Use when the user gives an issue number and asks to refine, flesh out or tidy it.
argument-hint: <issue number>
---

# Refine issue #$ARGUMENTS

1. **Read the rules and the issue.**
   - `docs/planning.md`, sections "Waves" and "Issue Types", plus any section
     that already covers this issue's topic (search for `#$ARGUMENTS`).
   - `.github/ISSUE_TEMPLATE/work.md` for the body shape.
   - `gh issue view $ARGUMENTS --comments --json title,body,labels,milestone,comments`
   - Parent and sub-issues:
     `gh api graphql -f query='query{repository(owner:"GitVex",name:"Recipeat"){issue(number:$ARGUMENTS){parent{number title milestone{title}} subIssues(first:50){nodes{number title}}}}}'`
   - The code it touches, enough to write real Pointers and to know what
     already exists. Don't propose what is already built.

2. **Decide the type.** `Feat:`, `Bug:`, `Chore:` or `Plan:`, per "Issue
   Types". If its shape isn't settled (open questions block any code), it is
   a `Plan:`, whatever it was filed as.

3. **Draft the refined issue.**
   - Title: `<Type>: <short name>`, sentence case, no trailing period, in the
     style of existing titles (`gh issue list --state all --limit 30`).
   - Body for Feat/Bug/Chore, following the template: Context, optionally
     Decided, Acceptance criteria (checkable statements, unhappy paths
     included), Depends on / blocks, Open questions (omit if none), Pointers.
     Start Context with `Part of #N.` if it has a parent.
   - Body for a Plan: the one-line idea, the questions that block it, and
     `Aiming for: Wave N`.
   - Keep the author's decisions and wording where they're fine. Mark
     anything you inferred rather than read, and don't invent decisions:
     an unsettled choice goes under Open questions.
   - Labels: one or more `area:*`, `ui:*` where it fits, and
     `needs:migration` if it will add a file under
     `server/database/migrations/`. `bug` for bugs.

4. **Place it** (see Waves). Plan → Plans milestone. Bug → current Wave (lowest
   open `Wave N`), or the Wave of the unshipped feature it's in. Feature or
   chore → a Wave after everything it depends on, with fewer than 4 top-level
   features and, if `needs:migration`, no other migration; else the next Wave
   with room. Sub-issues go in their parent's Wave. Never move anything into
   or out of Bug Hell. Check a Wave's load with
   `gh issue list --milestone "Wave N" --json number,title,labels`.

5. **Show the user** the new title, body, labels and milestone as a diff
   against what's there, plus anything placement forced (e.g. "Wave 7 already
   has a migration, so Wave 8"). **Wait for approval**, then apply:
   `gh issue edit $ARGUMENTS --title ... --body-file <scratch file> --add-label ... --milestone ...`.
   If a decision got settled in the process, offer to record it in
   `docs/planning.md` too; don't edit it unasked.
