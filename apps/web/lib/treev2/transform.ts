// Generation-based transformer (Phase 1)
// Converts raw persons + raw edges (PARENT_OF, SPOUSE_OF) into visual units (single or couple) and parent->child unit edges.

export type RawPerson = {
  id: string;
  name: string;
  email?: string | null;
  gender?: string | null;
  birthDate?: string | null;
};

export type RawEdge = { id?: string; type: 'PARENT_OF' | 'SPOUSE_OF'; sourceId: string; targetId: string };

export interface SingleUnit { kind: 'single'; personId: string; id: string; generation: number; x: number; y: number; }
export interface CoupleUnit { kind: 'couple'; partnerIds: [string, string]; id: string; generation: number; x: number; y: number; }
export interface VerticalPairUnit { kind: 'verticalPair'; partnerIds: [string,string]; id: string; generation: number; x:number; y:number; }
export type VisualUnit = SingleUnit | CoupleUnit | VerticalPairUnit;
export interface VisualEdge { id: string; sourceUnitId: string; targetUnitId: string; }
export interface Suggestion { kind: 'add_parent' | 'add_spouse' | 'add_grandparents' | 'add_cousin'; referencePersonId: string; reason: string; recommendedRelationType: string; createPair?: boolean; side?: 'maternal' | 'paternal'; uncleAuntId?: string; }
export interface TransformResult { units: VisualUnit[]; edges: VisualEdge[]; personToUnit: Record<string,string>; warnings: string[]; suggestions: Suggestion[]; }

interface BuildOptions { verticalGap?: number; horizontalGap?: number; }

export function transform(rawPeople: RawPerson[], rawEdges: RawEdge[], opts: BuildOptions = {}): TransformResult {
  const verticalGap = opts.verticalGap ?? 180;
  const horizontalGap = opts.horizontalGap ?? 60;
  const parentEdges = rawEdges.filter(e => e.type === 'PARENT_OF');
  const spouseEdges = rawEdges.filter(e => e.type === 'SPOUSE_OF');

  // Build spouse pairs (single spouse policy assumed). We'll treat pairs as undirected.
  const paired: Record<string,string> = {};
  spouseEdges.forEach(e => {
    if (!paired[e.sourceId] && !paired[e.targetId]) {
      paired[e.sourceId] = e.targetId;
      paired[e.targetId] = e.sourceId;
    }
  });

  // Initial generation assignment via BFS topological layering.
  const parentsOf: Record<string,string[]> = {};
  const childrenOf: Record<string,string[]> = {};
  parentEdges.forEach(e => {
    (childrenOf[e.sourceId] ||= []).push(e.targetId);
    (parentsOf[e.targetId] ||= []).push(e.sourceId);
  });
  rawPeople.forEach(p => { parentsOf[p.id] ||= []; childrenOf[p.id] ||= []; });

  const inDeg: Record<string,number> = {};
  Object.keys(parentsOf).forEach(cid => { inDeg[cid] = parentsOf[cid].length; });
  const gen: Record<string,number> = {};
  const q: string[] = [];
  Object.keys(inDeg).forEach(id => { if (inDeg[id] === 0) { gen[id] = 0; q.push(id); } });
  while (q.length) {
    const cur = q.shift()!;
    const g = gen[cur];
    for (const ch of childrenOf[cur]) {
      inDeg[ch]!--;
      if (inDeg[ch] === 0) {
        // compute generation = max(parents)+1
        const gPar = (parentsOf[ch] || []).reduce((m,p) => Math.max(m, gen[p] ?? 0), 0);
        gen[ch] = gPar + 1;
        q.push(ch);
      }
    }
  }

  // Couple consolidation: build units (spouse-based)
  const personToUnit: Record<string,string> = {};
  const units: VisualUnit[] = [];
  const seenCouple: Set<string> = new Set();
  for (const p of rawPeople) {
    if (paired[p.id]) {
      const a = p.id;
      const b = paired[p.id];
      if (!b) continue;
      const cId = a < b ? `couple:${a}:${b}` : `couple:${b}:${a}`;
      if (seenCouple.has(cId)) continue;
      seenCouple.add(cId);
      const gMin = Math.min(gen[a] ?? 0, gen[b] ?? 0);
      const unit: CoupleUnit = { kind:'couple', partnerIds: a < b ? [a,b] : [b,a], id: cId, generation: gMin, x:0, y:0 };
      units.push(unit);
      personToUnit[a] = cId; personToUnit[b] = cId;
    } else if (!personToUnit[p.id]) {
      const unit: SingleUnit = { kind:'single', personId: p.id, id: p.id, generation: gen[p.id] ?? 0, x:0, y:0 };
      units.push(unit);
      personToUnit[p.id] = p.id;
    }
  }

  // Vertical parent pair (mother+father of a child) if NOT already a spouse couple
  Object.entries(parentsOf).forEach(([childId, parentIds])=>{
    if(parentIds.length!==2) return;
    const [p1,p2] = parentIds;
    // Skip if either already mapped to a spouse couple (kind==='couple')
    const u1 = personToUnit[p1];
    const u2 = personToUnit[p2];
    const unit1 = units.find(u=>u.id===u1);
    const unit2 = units.find(u=>u.id===u2);
    if(unit1?.kind==='couple' || unit2?.kind==='couple') return; // already consolidated horizontally
    // genders
    const rp1 = rawPeople.find(r=>r.id===p1);
    const rp2 = rawPeople.find(r=>r.id===p2);
    const isMale1 = rp1?.gender==='MALE';
    const isMale2 = rp2?.gender==='MALE';
    // Determine ordering: primary (top) preference existing earlier in units order else male on top
    let top = p1; let bottom = p2;
    if(isMale2 && !isMale1) { top = p2; bottom = p1; }
    else if(isMale1===isMale2){
      // same gender or unknown: keep existing ordering;
    }
    // Create vertical pair id stable
    const vid = `vpair:${[top,bottom].sort().join(':')}:${childId}`; // include child to avoid merging unrelated parent pairs of different families
    // If both already share the same vertical pair skip (avoid duplicates across siblings)
    if(personToUnit[top] && personToUnit[top]===personToUnit[bottom] && units.find(u=>u.id===personToUnit[top])?.kind==='verticalPair') return;
    // If they already have a vertical pair via another child we want to re-use: search existing vertical pair containing both
    const existingV = units.find(u=> u.kind==='verticalPair' && (u.partnerIds.includes(p1) && u.partnerIds.includes(p2)));
    if(existingV){ personToUnit[p1]=existingV.id; personToUnit[p2]=existingV.id; return; }
    const gMin = Math.min(gen[p1] ?? 0, gen[p2] ?? 0);
    const vUnit: VerticalPairUnit = { kind:'verticalPair', partnerIds: [top,bottom], id: vid, generation: gMin, x:0, y:0 };
    // Remove individual single units representing p1/p2 if they exist
    for(const pid of [p1,p2]){
      const uid = personToUnit[pid];
      const idx = units.findIndex(u=>u.id===uid && u.kind==='single');
      if(idx!==-1) units.splice(idx,1);
    }
    units.push(vUnit);
    personToUnit[p1]=vid; personToUnit[p2]=vid;
  });

  // Visual edges: parent unit -> child unit
  const edgeKey = (a:string,b:string)=>`${a}->${b}`;
  const vEdgesMap: Record<string,VisualEdge> = {};
  parentEdges.forEach(e => {
    const su = personToUnit[e.sourceId];
    const tu = personToUnit[e.targetId];
    if (!su || !tu) return;
    const k = edgeKey(su,tu);
    if (!vEdgesMap[k]) vEdgesMap[k] = { id: k, sourceUnitId: su, targetUnitId: tu };
  });
  const vEdges = Object.values(vEdgesMap);

  // Improved layout: compute subtree widths and center parents over children.
  const unitChildren: Record<string,string[]> = {};
  vEdges.forEach(e => { (unitChildren[e.sourceUnitId] ||= []).push(e.targetUnitId); });
  const unitParentsCount: Record<string,number> = {};
  vEdges.forEach(e => { unitParentsCount[e.targetUnitId] = (unitParentsCount[e.targetUnitId]||0)+1; });
  const rootUnits = units.filter(u => !unitParentsCount[u.id]);

  const baseWidth = (u:VisualUnit)=> (u.kind==='couple'?220: (u.kind==='verticalPair'?160:140));
  const gap = horizontalGap;
  const subtreeWidthCache: Record<string,number> = {};
  function calcSubtreeWidth(id:string): number {
    if (subtreeWidthCache[id] != null) return subtreeWidthCache[id];
    const u = units.find(x=>x.id===id)!;
    const children = unitChildren[id]||[];
    if (!children.length) return subtreeWidthCache[id] = baseWidth(u);
    const widths = children.map(c=>calcSubtreeWidth(c));
    const totalKids = widths.reduce((a,b)=>a+b,0) + gap * (children.length - 1);
    const w = Math.max(baseWidth(u), totalKids);
    subtreeWidthCache[id] = w; return w;
  }
  rootUnits.forEach(r=>calcSubtreeWidth(r.id));

  // Assign positions recursively
  function place(id:string, left:number, depth:number){
    const u = units.find(x=>x.id===id)!;
    const myWidth = subtreeWidthCache[id];
    const myBox = baseWidth(u);
    u.y = depth * verticalGap;
    u.x = left + (myWidth - myBox)/2;
    const children = unitChildren[id]||[];
    if (!children.length) return;
    let cursor = left;
    children.forEach((c,i)=>{
      const cw = subtreeWidthCache[c];
      place(c, cursor, depth+1);
      cursor += cw + gap;
    });
  }
  let cursor = 0;
  rootUnits.forEach(r=>{
    const w = subtreeWidthCache[r.id];
    place(r.id, cursor, 0);
    cursor += w + gap*2; // extra gap between root subtrees
  });

  // Warnings generation
  const warnings: string[] = [];
  const suggestions: Suggestion[] = [];
  const nameById: Record<string,string> = Object.fromEntries(rawPeople.map(p=>[p.id,p.name]));
  // Missing second parent (child with exactly one parent)
  Object.entries(parentsOf).forEach(([cid, plist]) => {
    if (plist.length === 1) {
      warnings.push(`"${nameById[cid]||cid}" has only one parent`);
      // Suggest adding a second parent if the existing parent has no spouse pair
      const existingParentId = plist[0];
      const existingParentPaired = paired[existingParentId];
      if (!existingParentPaired) {
        suggestions.push({ kind:'add_parent', referencePersonId: cid, reason: 'Add missing second parent', recommendedRelationType: 'parent' });
      }
    }
    if (plist.length === 0 && (childrenOf[cid]?.length||0) > 0) {
      warnings.push(`Parents missing for "${nameById[cid]||cid}"`);
      suggestions.push({ kind:'add_parent', referencePersonId: cid, reason: 'Add a parent for lineage continuity', recommendedRelationType: 'parent' });
    }
  });
  // Multi spouse (should not happen with our pairing logic)
  const spouseCounts: Record<string,number> = {};
  spouseEdges.forEach(e=>{ spouseCounts[e.sourceId]=(spouseCounts[e.sourceId]||0)+1; spouseCounts[e.targetId]=(spouseCounts[e.targetId]||0)+1; });
  Object.entries(spouseCounts).forEach(([pid,c])=>{ if(c>2) warnings.push(`Person ${pid} appears in more than one spouse pairing`); });
  // Orphan (no parents and no children and no spouse) more than root set size 1
  rawPeople.forEach(p=>{
    if(!parentsOf[p.id].length && !childrenOf[p.id].length && !paired[p.id]) {
      warnings.push(`Isolated person "${p.name}" (no parents, spouse, or children)`);
      suggestions.push({ kind:'add_parent', referencePersonId: p.id, reason: 'Connect isolated person by adding a parent', recommendedRelationType: 'parent' });
    }
    // Spouse suggestion: if person has >=2 children and no spouse edge and not already paired
    if (!paired[p.id] && (childrenOf[p.id]?.length||0) >=2) {
      suggestions.push({ kind:'add_spouse', referencePersonId: p.id, reason: 'Add spouse for co-parent relationship', recommendedRelationType: 'spouse' });
    }
    // Cousin suggestions: if an aunt/uncle exists with no children, suggest adding cousin for current person via that aunt/uncle
  const directParentIds = parentsOf[p.id];
  const auntUncleIds = new Set<string>();
  directParentIds.forEach(parId => {
      const gpIds = parentsOf[parId] || [];
      gpIds.forEach(gpid => {
        const gpChildren = childrenOf[gpid] || [];
        gpChildren.forEach(ch => { if (ch !== parId) auntUncleIds.add(ch); });
      });
    });
    auntUncleIds.forEach(auId => {
      const auChildren = childrenOf[auId] || [];
      if (auChildren.length === 0) {
        suggestions.push({ kind:'add_cousin', referencePersonId: p.id, reason: 'Add cousin (aunt/uncle has no children)', recommendedRelationType: 'cousin', uncleAuntId: auId });
      }
    });
    // Grandparent suggestions (maternal / paternal)
  const parentIds = parentsOf[p.id];
    const motherId = parentIds.find(pid => rawPeople.find(rp=>rp.id===pid)?.gender === 'FEMALE');
    const fatherId = parentIds.find(pid => rawPeople.find(rp=>rp.id===pid)?.gender === 'MALE');
    if (motherId) {
      const maternalGrandCount = parentsOf[motherId]?.length || 0;
      if (maternalGrandCount === 0) {
        suggestions.push({ kind:'add_grandparents', referencePersonId: p.id, reason: 'Add maternal grandparents pair', recommendedRelationType: 'maternal_grandparents', createPair:true, side:'maternal' });
      } else if (maternalGrandCount === 1) {
        suggestions.push({ kind:'add_grandparents', referencePersonId: p.id, reason: 'Add missing maternal grandparent', recommendedRelationType: 'maternal_grandparents', createPair:false, side:'maternal' });
      }
    }
    if (fatherId) {
      const paternalGrandCount = parentsOf[fatherId]?.length || 0;
      if (paternalGrandCount === 0) {
        suggestions.push({ kind:'add_grandparents', referencePersonId: p.id, reason: 'Add paternal grandparents pair', recommendedRelationType: 'paternal_grandparents', createPair:true, side:'paternal' });
      } else if (paternalGrandCount === 1) {
        suggestions.push({ kind:'add_grandparents', referencePersonId: p.id, reason: 'Add missing paternal grandparent', recommendedRelationType: 'paternal_grandparents', createPair:false, side:'paternal' });
      }
    }
  });

  return { units, edges: vEdges, personToUnit, warnings, suggestions };
}
