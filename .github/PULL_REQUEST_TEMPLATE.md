## What

<!-- One paragraph. What does this PR change and why? Link an issue / ADR. -->

## How

<!-- Notable design choices, alternatives considered, anything a reviewer
     should notice in the diff. Keep it brief — the code is the source of truth. -->

## Test plan

- [ ] `pnpm lint && pnpm typecheck && pnpm format:check` green
- [ ] `pnpm test` green (or scope: `pnpm --filter @mnela/<pkg> test`)
- [ ] Manual smoke for the user-facing path (UI / API / CLI)
- [ ] If touching SystemConfig keys: tested `Restart Services` applies them
- [ ] If touching Dockerfiles / compose: `docker compose --profile prod up -d --build` boots clean

## Notes

<!-- Anything follow-up: known gaps, deferred work, expected next PR. -->

---

By submitting this PR you agree to license your contribution under the
[MIT License](../LICENSE). Don't add `Co-Authored-By: Claude` to commits
(per `CLAUDE.md` / TZ §19).
