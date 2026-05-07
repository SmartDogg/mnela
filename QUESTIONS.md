# Open Questions

Questions for the user that came up during implementation. Each gets answered, then archived to a "Resolved" section with the answer and the date.

---

## Open

_(none right now — all initial blockers resolved on 2026-05-07)_

---

## Resolved

### 2026-05-07 — Initial scope clarifications

| #   | Question                      | Resolution                                                                                                        |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Where does the repo live?     | `https://github.com/SmartDogg/mnela`                                                                              |
| 2   | License?                      | MIT                                                                                                               |
| 3   | Dev env?                      | Windows 11 for Phase 0; dedicated Linux VPS arrives by Phase 10                                                   |
| 4   | Test data?                    | Claude.ai export ZIP in repo dir; ChatGPT export not yet provided                                                 |
| 5   | UI design source?             | Use `frontend-design` skill / shadcn defaults; avoid generic AI aesthetic                                         |
| 6   | Library versions?             | Latest stable / current LTS, picked at install time                                                               |
| 7   | Tokenizer?                    | `gpt-tokenizer` (see ADR-0005)                                                                                    |
| 8   | Confidence scoring algorithm? | Emitted by Claude per CLAUDE.md rubric (see ADR-0004)                                                             |
| 9   | Let's Encrypt email?          | Not required — wizard will skip if user declines                                                                  |
| 10  | Upload size limits?           | Implementer's call — see ADR (TBD: documents 10MB / attachments 100MB / import ZIP 1GB are the proposed defaults) |
| 11  | i18n approach?                | next-intl with EN first + RU dictionaries (see ADR-0006)                                                          |

---

## How to use

When you hit something ambiguous in the TZ that isn't a hard blocker, write a question here, make a reasonable assumption to keep moving, and surface it to the user at the next natural checkpoint.

If it _is_ a hard blocker, stop and ask before proceeding.
