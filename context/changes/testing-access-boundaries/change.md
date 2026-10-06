---
change_id: testing-access-boundaries
title: Test rollout Phase 1 — access boundaries (route protection and author isolation)
status: preparing
created: 2026-10-06
updated: 2026-10-06
archived_at: null
---

## Notes

Rollout Phase 1 of context/foundation/test-plan.md: "Access boundaries".
Risks covered: #1 (author page or endpoint reachable without sign-in, participant link no longer public, Workers session/cookie drift), #2 (an author reads or changes another author's study, results or links via a foreign id — IDOR). Test types planned: Vitest + HTTP integration against the built preview, pgTAP for gaps.
Risk response intent:
- #1: prove every author page and endpoint redirects to sign-in without a session and every participant route works without one, and that a newly added, unclassified route makes a test fail.
- #2: prove author B gets not-found / nothing for every A-owned id on each page, endpoint and RPC, and can change nothing.
