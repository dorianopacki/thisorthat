<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: One-Time Link Voting

- **Plan**: context/changes/one-time-link-voting/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated checks run on 2026-10-06:
- `npm run lint`: 0 errors. The 2 warnings are in the generated `worker-configuration.d.ts`.
- `npx astro check`: 0 errors.
- `npm run build`: OK.
- PR #18 CI: the `verify`, `smoke` and `preview-upload` jobs pass.
- `npx supabase test db` and `npx supabase db lint` were not run locally because Docker was not running. CI `verify` covers `supabase test db`.

## Findings

### F1 — Referrer-Policy is `same-origin` but the plan says `no-referrer`, and check 2.8 is ticked

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Success Criteria
- **Location**: src/pages/v/[token].astro:31-33, src/pages/api/v/[token].ts:18
- **Detail**:
  - The page and the endpoint send `Referrer-Policy: same-origin`.
  - The deviation is correct: with `no-referrer`, the browser sends `Origin: null` on the vote POST, and Astro's `checkOrigin` rejects it.
  - The deviation is recorded only in a code comment. plan.md (Critical Implementation Details, Phase 2 §3 and §5, manual check 2.8, Manual Testing step 8) still says `no-referrer`.
  - Manual check 2.8 is ticked even though that header cannot be present.
  - `contract-surfaces.md` does not mention the response headers at all. A future reader could "restore" `no-referrer` from the plan, and every vote would then fail with a 403.
- **Fix**: Add a deviation note to plan.md (and amend 2.8). Document the header policy and its reason in the Vote URL section of `contract-surfaces.md`.
- **Decision**: FIXED — deviation note in plan.md (Critical Implementation Details, step 8); header policy bullet in contract-surfaces.md → Vote URL

### F2 — An unguarded `formData()` in the public vote endpoint returns a 500 for a malformed body

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/v/[token].ts:35
- **Detail**:
  - `await context.request.formData()` is not inside a try/catch. A POST with a non-form content type (for example `application/json`, which `checkOrigin` does not block) or a truncated body throws, and the endpoint returns an unhandled 500 instead of the generic error redirect.
  - There is no data or security impact, because `cast_vote` is never reached.
  - The sibling endpoints share this weakness, but this one is the only endpoint unauthenticated clients can reach.
- **Fix**: Wrap the call so a failure returns the generic error: `let form; try { form = await context.request.formData(); } catch { return fail(GENERIC_MESSAGE); }`.
- **Decision**: FIXED — try/catch around formData() returns the generic error redirect

### F3 — „Wyślij głos” is disabled until hydration, so voting needs JavaScript

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/voting/BallotForm.tsx:154
- **Detail**:
  - The server renders `disabled={!selected}` with `selected = null`. Until the island hydrates, or if its JavaScript fails on a weak phone connection, the native form cannot be submitted at all.
  - A radio picked before hydration does not enable the button.
  - The server already rejects a missing choice with „Wybierz wariant.”. The sibling forms (StudyWizard, StartStudyButton) render enabled before hydration.
- **Fix**: Apply `disabled` only after mount, using a `hydrated` state set in `useEffect`. Keep the `!selected` guard in `handleSubmit` and the server check.
- **Decision**: FIXED — `disabled={hydrated && !selected}`, `hydrated` via `useSyncExternalStore` (setState-in-effect is lint-banned)

### F4 — When there is no Supabase client, the page says „Badanie jest zakończone” (planned flaw); error screens return HTTP 200

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/v/[token].astro:51-56
- **Detail**:
  - The plan asked for "the ended-style card plus a generic error" when the client is null. Because of that, a participant with a valid link sees "study ended" next to "try again later". These contradict each other, and the participant may not come back.
  - Neither the RPC-error screen nor the malformed-payload screen sets an error status code, so monitoring cannot see these failures.
- **Fix**: Use `screen = "error"` for the null client and drop `loadError`. Set `Astro.response.status = 500` on `screen === "error"`. Keep „ended” at 200, so an unknown token and a closed study stay indistinguishable.
- **Decision**: FIXED — null client → error screen; error screen responds 500; deviation note in plan.md Phase 2 §3

### F5 — `?status=used` and `?error=` can be crafted without a server check

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/v/[token].astro:37,63
- **Detail**:
  - `/v/<token>?status=used` shows „Twój głos został już oddany”, and `?error=<any text>` shows arbitrary escaped text on the ballot.
  - Neither one is XSS or an oracle, and both need a real token, so the only realistic attacker is the person who distributes the links.
  - The `?error=` pattern already exists in the author pages.
- **Fix**: Accept and record the risk, or drop the `status === "used"` branch and rely on the cookie that is set alongside it.
- **Decision**: ACCEPTED — requires a real token; the link distributor could simply withhold the link

### F6 — Workers observability logs record token URLs with timestamps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: wrangler.jsonc (`observability.enabled: true`)
- **Detail**:
  - Every `GET /v/<token>`, `POST /api/v/<token>` and `?status=accepted|used` redirect is logged with a timestamp.
  - For the Cloudflare account holder, this is a second store of per-link used-state and vote timing, kept under its own retention.
  - It is outside the "authors" threat model in `contract-surfaces.md`, because the operator can already read the database. However, it is not recorded anywhere.
- **Fix**: Record it in `contract-surfaces.md` (Anonymity) as an accepted exposure at operator level.
  - Strength: no code or config change, and the threat model stays explicit.
  - Tradeoff: the logs keep the data.
  - Confidence: MED. Operator access to the database already makes this data available.
  - Blind spot: Workers Logs retention and who can access the account have not been checked.
- **Decision**: FIXED — documented as accepted operator-level exposure in contract-surfaces.md → Anonymity rule

### F7 — Unplanned `disabled` prop on the shared SubmitButton, and small pgTAP gaps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/auth/SubmitButton.tsx, supabase/tests/get_ballot.test.sql
- **Detail**:
  - SubmitButton gained an optional `disabled` prop that defaults to `false`. It is benign: the four existing callers are unchanged, and only BallotForm uses it. It is not listed in the plan.
  - The pgTAP suite covers every planned case. It does not assert the function's definer, `search_path` and grant configuration (a guard against a future `create or replace` that drops `set search_path`). It also has no case for an active study with zero variants.
- **Fix**: Add a one-line addendum to plan.md for SubmitButton. Optionally, add `has_function_privilege` and `proconfig` assertions in the next DB change.
- **Decision**: FIXED — SubmitButton addendum in plan.md Phase 2 §4; pgTAP config/zero-variant assertions deferred to the next DB change
