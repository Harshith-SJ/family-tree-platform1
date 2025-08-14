<!-- Removed as requested -->

No other stored relationship types.

## Derived Model (Client Transformer)
We compute a *visual graph*:
- **VisualUnit** (VU)
  - `SingleUnit { id: personId, type: 'single', personId }`
  - `CoupleUnit { id: 'couple:'+sorted(p1,p2), type: 'couple', partnerIds:[p1,p2] }`
  - A Person in a CoupleUnit is not also rendered as a SingleUnit.
- **Parent Units**: A child's *parent units set* is computed by mapping each biological parent to its containing VU (couple if coupled, else single).
- **VisualEdge**: from parent VU -> child VU (child VU may be couple or single depending on spouse pairing). Only one edge per (parentVU, childVU) pair.

Sibling relationships appear implicitly because they share the same parent VU(s).

## Generation Assignment Algorithm
1. Build raw in-degree counts (number of parent persons) per person.
2. Persons with no parents = generation 0.
3. BFS / topological layering: when all parents of a child are assigned, child generation = max(parent gens) + 1.
4. CoupleUnit generation = min(partner generations) (if generations differ, unify by lowering higher partner's generation to the lower + re-propagate dependents). To avoid oscillations, after initial person layering, unify couples by taking `min`, then adjust descendants if needed (perform one relaxation pass; with correct parent edges cycles won't form).
5. VisualUnit generation = computed above; used for vertical y.

## Layout Algorithm
Parameters:
- verticalGap = 180px
- horizontalGap = 60px
- coupleWidth = 220px, personWidth = 140px

Steps:
1. Group VUs by generation.
2. Compute subtree weight (number of descendant leaves) for each VU to allocate horizontal width proportionally (DFS memoized on VU-level graph).
3. Place units left-to-right within generation: cumulativeX += (unitWidth + horizontalGap) scaled by subtree weight.
4. Center children beneath horizontal midpoint(s) of their parent units (apply smoothing by averaging existing X vs desired X to reduce jitter across updates).
5. Apply manual deltas if drag-mode active: finalX = autoX + deltaDx, finalY = autoY + deltaDy.
6. Fit/zoom: compute bounding box, adjust initial viewport.

## Manual Drag Mode
- Default off. Toggle adds CSS class and enables React Flow node dragging.
- On drag end: store (deltaDx, deltaDy) per person (shared across its couple if any).
- "Reset layout" clears deltas.

## Relationship Addition Engine
Central function: `addRelative({ referenceId, relationType, payload })` where `payload` includes required person fields (name, email, tempPassword, etc.) and any disambiguators (e.g. which parent if two exist).

### Supported relationType & Logic
| relationType | Required context | Operations |
|--------------|------------------|------------|
| parent       | reference's existing parent count (<=2) | Create new Person P, create PARENT_OF(P -> reference), if a second parent later added & spouse pairing exists, no auto-couple; user must add spouse separately. |
| child        | reference's spouse? | Create child C, create PARENT_OF(reference -> C); if reference has exactly one spouse S, also PARENT_OF(S -> C) to auto-link. |
| spouse       | reference not already in couple | Create Person S, create SPOUSE_OF both ways, form CoupleUnit (re-layout). Optionally link existing children if they currently have only reference as a single parent. |
| sibling      | At least one parent of reference | For each known parent P of reference, create new Person S, add PARENT_OF(P -> S). If two parents known, link both. |
| uncle_aunt   | Choose which parent of reference (P) and parent of P (grandparent GP) must exist | Create new Person U, add PARENT_OF(GP -> U). If GP has other spouse forming a couple, that's automatic in layout. |
| cousin       | Need selected uncle/aunt U | Create new Person C, PARENT_OF(U -> C); if U has spouse, also link spouse -> C. |
| maternal_grandparents | Mother exists | Create grandmother & grandfather together (both optional toggles); SPOUSE_OF if both; PARENT_OF each -> mother |
| paternal_grandparents | Father exists | Same pattern applied to father side |

All additions return updated raw graph snapshot (nodes + edges) so client recomputes layout instantly.

### Edge Constraints
- Each person can have up to 2 parents; prevent adding >2.
- Single spouse policy: if a person already has a SPOUSE_OF edge, reject adding another spouse.
- No duplicate PARENT_OF edges.

## UI Flow: Add Relative Modal
1. Trigger: select node (person or couple) => actions tray (Add Relative, Add Spouse (if eligible), Add Child, etc.)
2. Modal Step 1: Choose relation category (Parent / Child / Spouse / Sibling / Uncle/Aunt / Cousin / Grandparent).
3. Step 2 (conditional): disambiguation
   - For Uncle/Aunt: pick which of your parents; ensure their parent (grandparent) exists; if not, offer quick create grandparent first.
   - For Cousin: pick parent -> pick their sibling (or create one) -> then proceed.
4. Step 3: Person details form (Name, Email, Birth date, Gender, Temp password).
5. Submit => back-end endpoint `/relations/add` (new endpoint) handles graph writes atomically and returns updated person + affected edges.

## Back-End Add Relations Endpoint (New)
`POST /relations/add` body:
```jsonc
{
  "referenceId": "person-uuid",
  "relationType": "cousin",
  "options": { /* disambiguators like parentId, uncleId */ },
  "person": { "name": "...", "email": "...", "tempPassword": "...", "gender": "MALE", "birthDate": "2000-01-01" }
}
```
Response: `{ node: Person, createdEdges: Array<{ type:'PARENT_OF'|'SPOUSE_OF', sourceId, targetId }>, snapshot?: { people:[], edges:[] } }`

Logic switch server-side ensures validations & atomicity (single Cypher transaction) with conditional MATCH/CREATE.

## Cypher Patterns (Examples)
Add child (auto dual-parent):
```
MATCH (p:Person {id:$reference})
OPTIONAL MATCH (p)-[:SPOUSE_OF]->(s:Person)
CREATE (c:Person { ...props... })
CREATE (p)-[:PARENT_OF]->(c)
FOREACH(_ IN CASE WHEN s IS NOT NULL THEN [1] ELSE [] END |
  CREATE (s)-[:PARENT_OF]->(c)
)
```
Add sibling (existing two parents P1,P2):
```
MATCH (ref:Person {id:$reference})-[:PARENT_OF]-(par:Person)
WITH collect(par) AS parents
CREATE (s:Person {...})
FOREACH(p IN parents | CREATE (p)-[:PARENT_OF]->(s))
```
Add uncle (through chosen grandparent GP):
```
MATCH (ref:Person {id:$reference})<-[:PARENT_OF]-(parent:Person {id:$parentId})<-[:PARENT_OF]-(gp:Person)
CREATE (u:Person {...})
CREATE (gp)-[:PARENT_OF]->(u)
```
Add cousin:
```
MATCH (u:Person {id:$uncleId})
OPTIONAL MATCH (u)-[:SPOUSE_OF]->(sp:Person)
CREATE (c:Person {...})
CREATE (u)-[:PARENT_OF]->(c)
FOREACH(_ IN CASE WHEN sp IS NOT NULL THEN [1] ELSE [] END |
  CREATE (sp)-[:PARENT_OF]->(c)
)
```

## Real-Time Events
- Emit granular events: `person:created`, `edge:created`, `person:updated`, `person:deleted` (existing scheme) remains valid.
- Client updates raw cache then runs transformer.

## Transformer Module Outline (TypeScript)
```
export interface RawPerson { id:string; name:string; gender?:string; birthDate?:string; posDx?:number; posDy?:number }
export interface RawEdge { type:'PARENT_OF'|'SPOUSE_OF'; sourceId:string; targetId:string }
export interface VisualUnitBase { id:string; generation:number; x:number; y:number }
export interface SingleUnit extends VisualUnitBase { kind:'single'; personId:string }
export interface CoupleUnit extends VisualUnitBase { kind:'couple'; partnerIds:[string,string] }
export type VisualUnit = SingleUnit | CoupleUnit;
export interface VisualEdge { id:string; sourceUnitId:string; targetUnitId:string }

export interface TransformResult { units:VisualUnit[]; edges:VisualEdge[]; personToUnit:Record<string,string>; warnings:string[] }

export function transform(rawPeople:RawPerson[], rawEdges:RawEdge[], options?:{ applyDeltas?:boolean }):TransformResult { /* steps */ }
```

## Error Handling & Warnings
- If attempted to add parent when already 2 parents exist -> 400.
- If attempted to add second spouse -> 400.
- Warnings array in transform for data anomalies (e.g., 3 parents) to surface in dev UI.

## Assumptions (Can Revise)
- Single spouse lifetime rule (no widow/remarry model yet).
- Children always biologically belong to both parents if spouse exists at creation time.
- Users seldom exceed 50 persons; no pagination needed.
- All emails unique when creating persons (enforced in application layer, not shown here yet).

## Implementation Phases (Coding)
1. Add plan file (this file) + transformer skeleton & tests.
2. New `/relations/add` endpoint with relationType switch (child, spouse, parent, sibling).
3. Extend to uncle_aunt, cousin, grandparent.
4. Client: integrate transformer; replace direct React Flow nodes with visual units.
5. Add Relative modal (multi-step dynamic).
6. Couple node component & styling.
7. Manual drag overlay & reset.
8. QA & polish (edge arrow styling, legends, warnings display).

## Approval Needed
Please confirm / adjust:
- Wording of relation types.
- Whether we need a separate button vs single "+ Add Relative" universal button.
- Layout spacing constants (180px vertical, 60px horizontal).
- Auto-link existing children to newly added spouse (currently YES for children with only one parent).

Once approved I will start with Phase 1 (transformer + tests) and proceed incrementally.

---

## MASTER PLAN: Core Relative Addition (Mother, Father, Their Sisters/Aunts, etc.)

This section drills deeper into the end‑user journey for building ancestry quickly with minimal friction. The goal: a user can start from themself and, within a few guided steps, build upward (parents, grandparents) and sideways (aunts/uncles) without manual graph knowledge.

### Guiding Principles
1. "From any selected person, you can add any logically adjacent relative in ≤2 clicks before data entry".
2. System auto‑infers required intermediate nodes (optionally prompting user) when a target relative logically requires missing ancestors.
3. All additions routed through a single relation engine that validates constraints and emits atomic changes.
4. Always show a live schematic preview (mini diagram) in the modal before confirming creation.

### Relation Categories & Dependency Rules
| Target Relative | Base Reference | Required Existing Context | Auto‑Inference If Missing |
|-----------------|----------------|---------------------------|---------------------------|
| Mother          | Self           | None                      | Creates mother only       |
| Father          | Self           | None                      | Creates father only       |
| Both Parents    | Self           | None                      | Creates mother+father & couples them (optional toggle) |
| Parent's Sister (Aunt) | Self    | The chosen parent must exist & have at least one parent (grandparent) | If grandparent missing, prompt to create (grandparent + optionally spouse) first then proceed |
| Parent's Brother (Uncle) | Self  | Same as above             | Same as above             |
| Maternal Grandparents | Self | Mother must exist | If mother missing, prompt to create mother first |
| Paternal Grandparents | Self | Father must exist | If father missing, prompt to create father first |
| Cousin          | Self          | Aunt/Uncle (parent's sibling) exists | If absent, branch wizard: create Aunt/Uncle (and necessary grandparent) first |
| Sibling         | Self          | At least one parent       | If no parents, offer flow to create parents first then sibling |
| Child           | Self          | None                      | If spouse exists, auto dual-parent edge |

### UX FLOW DETAILS

#### 1. Add Parents (Fast Wizard)
Entry point: Select self → Action bar → "Add Parents" (split button with dropdown options: Add Mother, Add Father, Add Both).

Flow: "Add Both"
1. Modal Step 1: Preview shows self with two empty parent slots above.
2. Step 2: Two side-by-side forms (Mother, Father) minimal required fields (Name, Email, Temp Password). Optional toggle "Create as a couple" (on by default). If toggled off, they remain single parents individually (allows future separate spouse addition).
3. Confirm → Engine creates two persons, SPOUSE_OF edges if toggle on, and PARENT_OF edges to self.
4. Layout recalculates: new couple generation 0, user generation 1.

Edge Cases:
- Only one parent known? User can add one now; later adding other parent will **not** auto-couple unless user chooses "Add as spouse of existing parent".

#### 2. Add Mother (Single)
1. Modal: Single parent form.
2. After creation, offer inline snackbar: "Add father too? [Add] [Dismiss]" to encourage completing the parental pair.

#### 3. Add Aunt (Parent's Sister)
Option only visible if at least one parent exists.
Flow variants:
1. User selects self → Add Relative → Choose "Aunt/Uncle".
2. Step 1: Pick which parent lineage (Mother side / Father side).
3. System checks if that parent has a parent (grandparent). If not:
  - Show interstitial: "We need a grandparent first." Offer quick create: Grandmother / Grandfather / Both (mirrors parent creation wizard but one generation up). After creation auto-returns to Aunt flow.
4. Step 2: Shows existing siblings of the chosen parent (list). Actions: "Add New Aunt" / (if editing future) "Convert this aunt to spouse of X" (not now; single spouse policy simplifies it).
5. Add New Aunt form (minimal fields). On submit:
  - Creates Aunt A person.
  - Adds PARENT_OF edge(s) from the known grandparent(s) to A.
  - Layout reflows: Aunt sits horizontally adjacent to the parent within same generation block.

#### 4. Add Uncle (Parent's Brother)
Identical logic to Aunt. Gender optional; semantic naming user-defined.

#### 5. Add Cousin
1. Must select lineage (which parent) → then choose an existing Aunt/Uncle from that lineage.
2. Form for Cousin; on create: PARENT_OF( Aunt/Uncle -> Cousin ) and if Aunt/Uncle has spouse, add second parent edge.

#### 6. Add Grandparents (Pair-Oriented Flow)
If user already has a mother but not maternal grandparents:
1. Select mother (or self) → Add Relative → "Add Maternal Grandparents".
2. Wizard: Two panels (Grandmother, Grandfather) with enable checkboxes (both on by default). Required minimal fields per enabled panel.
3. Submit: create enabled persons, SPOUSE_OF between them if both selected, PARENT_OF edges to mother (and her siblings if any exist and user consents in a prompt).
4. Generation above parent assigned; layout reflows.
Later adding the missing other grandparent: similar wizard with only the absent side enabled; afterwards offer to link to all children of existing grandparent(s).

#### 7. Sibling Addition
1. Requires ≥1 parent. If only one parent exists, sibling is attached only to that parent.
2. If two parents: create child linked to both, ensuring co-parent edges exist.

#### 8. Smart Suggestion Engine (Optional Enhancement)
After any addition, engine scans for contextually logical next steps and surfaces pill suggestions under the toolbar (e.g., "Add your father's parents", "Add siblings to your mother"). Generated from rules:
- Missing second parent for a known single parent.
- Missing grandparents for a parent with no ancestors.
- No siblings present but likely siblings (if large age gap pattern later considered; initial heuristic simple: zero siblings).

### ACTION BAR DESIGN
When person (or person within a couple) selected:
- Primary Button: "+ Add Relative"
- Quick Actions (icons): Add Parent, Add Child, Add Spouse (if allowed), Add Sibling.
- Hover / click opens modal pre-filtered to that relation for speed.

### MODAL STRUCTURE (Dynamic)
Component state machine steps:
1. `chooseRelation` (if not pre-filtered)
2. `lineageSelect` (if relation depends on a parent side) ➜ choose side
3. `ancestorPrereq` (auto-create required grandparents) ➜ optional wizard
4. `targetSelector` (pick existing aunt/uncle for cousin) / or `createNewTarget`
5. `personDetails` (final form) with live preview diagram
6. `summary` (optional for multi-creates like adding both parents) then submit

### PREVIEW DIAGRAM
Small horizontal mini-tree using same transformer but subset nodes. Highlights new nodes in accent color so user visualizes impact before commit.

### VALIDATION LOGIC SUMMARY
| Scenario | Validation |
|----------|------------|
| Add parent when 2 already exist | Block (error toast) |
| Add spouse when existing spouse present | Block |
| Add sibling with zero parents | Offer create parents first wizard |
| Add aunt/uncle without grandparents | Offer create grandparents first wizard (cannot skip) |
| Add cousin without aunt/uncle | Offer create aunt/uncle first |

### DIFFERENTIATORS vs Typical Family Builders
1. **Wizarded Derivation**: The platform *assists* building collateral lines (aunts/uncles/cousins) from any node, not just vertical lineage.
2. **Couple Unit Abstraction**: Minimizes visual clutter while preserving parent semantics.
3. **Atomic Multi-Create**: Creating both parents or both grandparents in one confirmation reduces friction.
4. **Contextual Suggestions**: Guides user to fill structural gaps for a more complete tree.
5. **Preview Before Commit**: Transparent graph mutation preview builds trust.

### FUTURE EXTENSIONS (Not in MVP)
- Multiple marriages / remarriage timeline.
- Adoptive vs biological toggle on edges.
- Age-based chronological positioning within a generation.
- GEDCOM import/export.

### IMPLEMENTATION ORDER REFINEMENT (Focused on Core Flows)
1. Transformer + basic layered layout (already Phase 1).
2. Couple unit rendering.
3. Action bar + simplified Add Parent/Child/Spouse flows.
4. Extended wizard for Aunt/Uncle + Cousin (lineage selection + prerequisite creation).
5. Grandparent multi-create.
6. Suggestions engine (rules module).
7. Preview diagram component.
8. Manual drag overlay.
9. Polish (toasts, icons, accessibility, tests).

### TEST MATRIX (Key Cases)
| Test | Steps | Expectation |
|------|-------|-------------|
| Add both parents | Self -> Add Both Parents | Two persons, coupled, edges appear, layout reflows |
| Add sibling (one parent) | Self with only mother -> Add Sibling | New sibling linked only to mother |
| Add sibling (two parents) | Self with both parents -> Add Sibling | New sibling linked to both parents |
| Add aunt missing grandparents | Self with only father -> Add Aunt (father side) | Prompt grandparent creation first |
| Add aunt with grandparents existing | Self with father & grandparents -> Add Aunt | Aunt added same generation as father |
| Add cousin | After aunt exists -> Add Cousin | Cousin under aunt (and her spouse if any) |
| Add maternal grandparents (both) | Self with mother only -> Add Maternal Grandparents | Couple node above mother; generation shift correct |
| Add paternal grandfather only | Self with father only -> Add Paternal Grandparents (disable grandmother) | Single grandparent above father; later adding grandmother couples them |
| Spouse addition auto-link children | Parent with existing solo children -> Add Spouse -> Accept linking | Children now have two parents |

---

End of master plan extension.
