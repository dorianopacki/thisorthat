# One-Time Link Voting — Plan Brief

> Full plan: `context/changes/one-time-link-voting/plan.md`

## What & Why

Roadmap S-02: a participant without an account opens `/v/<token>`, picks one variant, optionally comments under any variant, and sends — exactly one vote per link. This is where the product's guarantee „jeden link = jeden głos” meets the participant, and the step before the north star (S-03 live results).

## Starting Point

F-01 shipped `cast_vote`, which consumes a link atomically and returns `accepted | link_used | study_ended`. S-01 creates active studies and the `/v/<token>` URLs. There is no participant read path (`anon` has no table access) and no route at `/v/<token>`.

## Desired End State

On a phone, a link opens a ballot with tappable variant cards, a collapsed „Dodaj komentarz” under each, and „Wyślij głos” enabled once something is selected. Sending shows „Dziękujemy za udział w badaniu”. The same browser later sees „Twój głos został już oddany”; another device sees the ballot and gets that message after sending. A closed, deleted or unknown link shows „Badanie jest zakończone”.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Reopening a used link | Ballot read never reveals `used`; a cookie scoped to `/v/<token>` shows the message in the same browser; other devices learn it on submit | A read that reveals `used` without consuming the link would let authors check every token they hold without leaving a trace and, with S-03 live results, tie votes to people. |
| Comments on mobile | Collapsed per variant („Dodaj komentarz”), text kept when collapsed | Up to 6 variants stay short on a phone while FR-009 is fully met. |
| Variant order | Shuffled per link, deterministic from the token | Removes first-position bias in small groups; a reload shows the same order with nothing stored. |
| Submit | Select then send, no extra confirmation | Selecting and then tapping Send is already deliberate, and there's no extra tap on the phone. |
| Read path | New `security definer` `get_ballot(token)` → title + variants of an active study, else `null` | Keeps `anon` off every table; same pattern as `cast_vote`. |
| Screen precedence | thank-you → ended → already voted → ballot | S-04's auto-close on the last link must not hide the last voter's thank-you. |

## Scope

**In scope:** `get_ballot` migration + pgTAP (including identical output for used vs unused links), types, `contract-surfaces.md`; `/v/[token]` page with four screens; `BallotForm` island; `POST /api/v/[token]` mapping `cast_vote` codes; voted cookie; CRLF normalization; `no-store` / `no-referrer` / `noindex` headers; production rollout.

**Out of scope:** results/ranking/progress (S-03), closing rules (S-04), edit/delete (S-06), extra links (S-07), images (S-08), rate limiting, changes to `cast_vote` or the schema, translating the layout, app unit/e2e tests.

## Architecture / Approach

`/v/<token>` (Astro) → `get_ballot` once → picks a screen; ballot = React island → native form POST → `/api/v/<token>` → normalize/validate → `cast_vote` → set the voted cookie on `accepted`/`link_used` → redirect with `?status=` / `?error=`. One vote per link is enforced only by `cast_vote`'s conditional `UPDATE`; the cookie is just a hint shown in the UI.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database — `get_ballot` | Participant read path proven by pgTAP; contract registry updated | Accidentally exposing `used` (or position/link id) in the output |
| 2. Voting page and endpoint | Mobile ballot, four screens, vote submission, cookie | Unusable on a phone; token leaking via `Referer`/cache; cookie treated as the guard |
| 3. Production rollout | Migration pushed, app deployed, real-phone vote | Pushing the migration without approval or via MCP (version drift) |

**Prerequisites:** S-01 done (it is); Docker running for local Supabase; production project already linked.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- On a second device, a participant only learns their link is used after filling in the ballot (accepted UX cost of the anonymity decision).
- The accepted, destructive author probe (`contract-surfaces.md`) still exists; S-02 does not widen it.
- If cookies are blocked, a participant who reopens a used link sees the ballot again; sending it still shows „Twój głos został już oddany” and records nothing.

## Success Criteria (Summary)

- A participant on a phone can vote with optional comments in under a minute and sees the thank-you.
- No link ever yields two votes, and no read path tells anyone whether a specific link was used.
- Reopened, closed, deleted and unknown links show the FR-010 messages as specified above.
