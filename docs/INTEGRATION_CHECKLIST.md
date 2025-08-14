# Integration & Hardening Checklist

Status legend: [ ] pending · [~] in progress · [x] done · [>] deferred

## P0 – Consistency & Core Safeguards
- [x] Unify biological relation creation through `/relations/add` (deprecate manual parent/child edges)  
	- Manual edge route now returns 410 DEPRECATED for MOTHER/FATHER/SON/DAUGHTER/SPOUSE; clients must use /relations/add.
- [x] Enforce parent limit (<=2) on manual edge creation routes  
- [x] Enforce email uniqueness on `POST /families/:id/nodes`  
- [x] Add auditing fields (createdBy, createdAt, updatedAt) to Person & relationship edges (manual + service)  
	- Service path `/relations/add`: createdAt/createdBy applied to new nodes & edges.
	- Manual person routes: added createdBy on create, updatedBy on update, and updatedAt timestamps.
	- Manual edge routes: added createdAt/createdBy and updatedAt/updatedBy for spouse & parent edges.
- [x] Persist idempotency keys (Neo4j) instead of in‑memory  
	- Added Idem node with unique key constraint; route now checks Neo4j then memory fallback.

## P1 – Frontend Relation UX
- [x] Use Idempotency-Key header in relation additions (tree-v2)  
- [x] Add gender + birthDate inputs to relation add modal  
- [x] Allow single missing grandparent vs pair (UI toggle auto when one exists)  
- [x] Explicit side picker for aunt/uncle (not only inference)  
- [x] Error code → friendly message mapping (LIMIT, DUPLICATE, MISSING_PARENT, MISSING_GRANDPARENT, VALIDATION)  
- [x] Wire suggestions for cousin (auto selects uncleAuntId)  
	- Added cousin suggestion generation in transformer and auto-populates uncleAuntId on Add.
- [x] Socket live updates for tree-v2 (mirror legacy)  
	- /relations/add now emits node:upsert and edge:created events scoped to the family room (familyId auto-discovered by linking new nodes to reference's family during write phase).
- [x] Sibling add gating (requires reference with existing parent) in tree-v2
- [x] Animated auto-layout transition after add (tree-v2)
- [~] Edge selection + deletion (visual selection done; underlying relationship id mapping pending for actual delete)

## P2 – Observability & Resilience
- [x] Structured logs for all mutations (manual edge/node, families)  
	- mutationLog plugin logs method, route, status, userId, tookMs, relationType (if present), error codes.
- [x] Metrics counters (relation_type_total, errors_total) & latency histogram  
	- Added global http_requests_total (method, route, status) & http_request_duration_ms histogram; relation-specific metrics retained.
- [x] Rate limiting (per user & IP) on mutation endpoints  
	- In-memory token bucket (per IP + user) in place.
- [x] Automatic retry (frontend) using stable idempotency key on network errors  
	- Implemented for tree-v2 relation add (1 retry with same key on transient network errors)

## P3 – Data Hygiene / Model
- [x] Normalize relationship labels (derive SON/DAUGHTER at render time)  
	- Storage uses generic PARENT; API derives MOTHER/FATHER on fetch based on gender.
- [x] Add soft delete (deletedAt) instead of DETACH DELETE for audit  
	- Persons and edges soft-deleted (deletedAt); tree queries filter; events emitted as before.
- [x] Reinstate password policy + tests (service + manual node creation)  
	- Password validation enforced (length>=8, alphanumeric mix) for manual & relation-based creation. (Tests will be in P5.)
- [x] Role-based permissions (family admin vs member)  
	- Roles on MEMBER_OF (creator ADMIN, new members MEMBER); admin guard on destructive ops & relation add; role mutation endpoint.

## P4 – Cleanup / Refactor
- [x] Remove deprecated tree page (legacy ReactFlow implementation)  
	- Deleted `app/families/[id]/tree/page.tsx` and top-level redirect `app/family-tree/page.tsx` now that `tree-v2` is primary.
- [x] Remove empty placeholder folders / files (removed empty READMEs under `components/auth`, `components/tree`, and `lib/socket`).  
- [x] Delete unused `lib/treeLayout.ts` placeholder (logic lives in `treev2/transform.ts`).  

## P5 – Testing
- [ ] Backend tests for manual edge parent limit & email uniqueness  
- [ ] Backend tests for grandparent single vs pair addition  
- [ ] Frontend tests: relation add form validations & error mapping  
- [ ] Transformer suggestions (grandparents, missing parent, spouse)  
- [ ] Idempotency header reuse on retry (frontend unit)  

## Today’s Session Work
- [x] Add checklist tracking file
- [x] Frontend: Idempotency key usage
- [x] Frontend: gender & birthDate fields in relation form
- [x] Frontend: error code → friendly mapping
 - [x] Backend: email uniqueness in manual person creation
 - [x] Backend: parent limit enforcement on manual edge creation

## Notes
This file will be updated incrementally as tasks are completed. Small, low-risk changes will be bundled; larger refactors will be staged with tests first.
