"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import * as htmlToImage from 'html-to-image';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { toast } from '@/lib/toast';
import { transform, RawPerson, RawEdge } from '@/lib/treev2/transform';
import { mapRelationError } from '@/lib/relationErrors';

type RelationType = 'parent'|'child'|'spouse'|'sibling'|'maternal_grandparents'|'paternal_grandparents'|'aunt_uncle'|'cousin';

export default function TreeV2Page(){
  const { id: familyId } = useParams<{id:string}>();
  const [people,setPeople]=useState<RawPerson[]>([]);
  const [edges,setEdges]=useState<RawEdge[]>([]);
  const [selectedPersonId,setSelectedPersonId]=useState<string|null>(null);
  const [selectedEdgeId,setSelectedEdgeId]=useState<string|null>(null);
  const [visualEdgeMap,setVisualEdgeMap]=useState<Record<string,string[]>>({});
  const [showAdd,setShowAdd]=useState(false);
  const [relationType,setRelationType]=useState<RelationType>('spouse');
  const [targetPersonId,setTargetPersonId]=useState<string|null>(null);
  const [personName,setPersonName]=useState('');
  const [personEmail,setPersonEmail]=useState('');
  const [personGender,setPersonGender]=useState('');
  const [personBirth,setPersonBirth]=useState('');
  const [tempPassword,setTempPassword]=useState('');
  const [genderLocked,setGenderLocked]=useState(false);
  const [createPair,setCreatePair]=useState(false);
  const [partnerName,setPartnerName]=useState('');
  const [partnerEmail,setPartnerEmail]=useState('');
  const [partnerTempPassword,setPartnerTempPassword]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [friendlyError,setFriendlyError]=useState<string|null>(null);
  const [sideOverride,setSideOverride]=useState<'maternal'|'paternal'|''>('');
  const [selectedUncleAuntId,setSelectedUncleAuntId]=useState('');
  const [autoLayoutAfter,setAutoLayoutAfter]=useState(true);
  const canvasRef=useRef<HTMLDivElement|null>(null);
  const [animPositions,setAnimPositions]=useState<Record<string,{x:number;y:number}>>({});
  const animPositionsRef=useRef<Record<string,{x:number;y:number}>>({});
  const animatingRef=useRef(false);

  const t = useMemo(()=> transform(people, edges), [people, edges]);
  // Build map visual edge id -> raw edge ids (PARENT_OF only)
  useEffect(()=>{ const map:Record<string,string[]> = {}; edges.forEach(e=>{ if(e.type!=='PARENT_OF') return; const su=t.personToUnit[e.sourceId]; const tu=t.personToUnit[e.targetId]; if(!su||!tu) return; const vid=su+'->'+tu; (map[vid] ||= []).push(e.id||''); }); setVisualEdgeMap(map); },[edges, t.personToUnit]);
  const parentMap = useMemo(()=>{ const m:Record<string,string[]>={}; edges.filter(e=>e.type==='PARENT_OF').forEach(e=>{ (m[e.targetId] ||= []).push(e.sourceId); }); return m; },[edges]);
  const childrenMap = useMemo(()=>{ const m:Record<string,string[]>={}; edges.filter(e=>e.type==='PARENT_OF').forEach(e=>{ (m[e.sourceId] ||= []).push(e.targetId); }); return m; },[edges]);
  const auntsUnclesForRef = useMemo(()=>{ if(!targetPersonId) return [] as RawPerson[]; const parents=parentMap[targetPersonId]||[]; const au=new Set<string>(); parents.forEach(pid=>{ (parentMap[pid]||[]).forEach(gpid=>{ (childrenMap[gpid]||[]).forEach(ch=>{ if(ch!==pid) au.add(ch); }); }); }); return people.filter(p=>au.has(p.id)); },[targetPersonId,parentMap,childrenMap,people]);
  const refHasParent = (pid:string|null)=> pid ? (parentMap[pid]?.length||0)>0 : false;

  // Initial load
  useEffect(()=>{ (async()=>{ if(!familyId) return; try { const data= await api<{ people:RawPerson[]; edges:{id:string;sourceId:string;targetId:string;type:string}[] }>(`/families/${familyId}/graph`); setPeople(data.people||[]); setEdges(data.edges.map(e=>({ id:e.id, sourceId:e.sourceId, targetId:e.targetId, type: e.type==='PARENT'?'PARENT_OF': e.type==='SPOUSE'?'SPOUSE_OF': (e.type as any) }))); } catch { toast.error('Failed to load tree'); } })(); },[familyId]);
  // Sockets
  useEffect(()=>{ if(!familyId) return; const s=getSocket(); s.emit('join-family', familyId); const upsert=(n:any)=> setPeople(prev=>{ const idx=prev.findIndex(p=>p.id===n.id); const person:RawPerson={ id:n.id, name:n.name, email:n.email, gender:n.gender, birthDate:n.birthDate }; if(idx===-1) return [...prev, person]; const c=[...prev]; c[idx]=person; return c; }); const delNode=(p:{id:string})=> { setPeople(prev=>prev.filter(pp=>pp.id!==p.id)); setEdges(prev=>prev.filter(e=> e.sourceId!==p.id && e.targetId!==p.id)); }; const addEdge=(e:any)=> setEdges(prev=> prev.some(pe=>pe.id===e.id)?prev:[...prev,{ id:e.id, sourceId:e.sourceId, targetId:e.targetId, type: (e.type==='MOTHER'||e.type==='FATHER'||e.type==='PARENT')?'PARENT_OF': e.type==='SPOUSE'?'SPOUSE_OF': e.type }]); const delEdge=(e:{id:string})=> setEdges(prev=>prev.filter(pe=>pe.id!==e.id)); s.on('node:upsert', upsert); s.on('node:deleted', delNode); s.on('edge:created', addEdge); s.on('edge:deleted', delEdge); return ()=>{ s.off('node:upsert', upsert); s.off('node:deleted', delNode); s.off('edge:created', addEdge); s.off('edge:deleted', delEdge); }; },[familyId]);
  // Animation (simple reposition easing) – rerun when any unit x/y changes
  useEffect(()=>{
    const target:Record<string,{x:number;y:number}>={};
    t.units.forEach(u=>{ target[u.id]={x:u.x,y:u.y}; });
    if(!autoLayoutAfter){
      setAnimPositions(target); animPositionsRef.current=target; return; }
    // ensure newly added units have a starting position (their target) while we animate others
    setAnimPositions(prev=>{ const next={...prev}; Object.keys(target).forEach(id=>{ if(!next[id]) next[id]=target[id]; }); return next; });
    const startPos={...animPositionsRef.current};
    const start=performance.now(); const DUR=420; animatingRef.current=true;
    function frame(now:number){
      const p=Math.min(1,(now-start)/DUR); const ease=p<0.5?2*p*p:-1+(4-2*p)*p;
      setAnimPositions(cur=>{ const up:Record<string,{x:number;y:number}>={}; Object.entries(target).forEach(([id,tgt])=>{ const sp=startPos[id]||cur[id]||tgt; up[id]={ x:Math.round(sp.x+(tgt.x-sp.x)*ease), y:Math.round(sp.y+(tgt.y-sp.y)*ease)}; }); animPositionsRef.current=up; return up; });
      if(p<1) requestAnimationFrame(frame); else animatingRef.current=false; }
    requestAnimationFrame(frame);
  },[t.units.map(u=>`${u.id}:${u.x}:${u.y}`).join('|'), autoLayoutAfter]);

  const dynLabel = relationType==='parent'? (personGender==='FEMALE'?'Mother': personGender==='MALE'?'Father':'Parent') : relationType==='child'? (personGender==='FEMALE'?'Daughter': personGender==='MALE'?'Son':'Child') : relationType;

  async function submitAdd(){
    if(!familyId) return;
    if(!targetPersonId){ setError('Reference required'); return; }
    if(!personName.trim()){ setError('Name required'); return; }
    if(!personEmail.trim()){ setError('Email required'); return; }
    if(!tempPassword || tempPassword.length<8){ setError('Temp password min 8 chars'); return; }
    if((relationType==='maternal_grandparents' || relationType==='paternal_grandparents') && createPair){
      if(!partnerName.trim()) { setError('Partner name required'); return; }
      if(!partnerEmail.trim()) { setError('Partner email required'); return; }
      if(!partnerTempPassword || partnerTempPassword.length<8){ setError('Partner temp password min 8 chars'); return; }
    }
    if(relationType==='cousin' && !selectedUncleAuntId){ setError('Select uncle/aunt'); return; }
    setSaving(true); setError(null); setFriendlyError(null);
    try {
      const body:any={ referenceId:targetPersonId, relationType, person:{ name:personName.trim(), email:personEmail.trim(), tempPassword, gender:personGender||undefined, birthDate:personBirth||undefined } };
      let options: any = {};
      if(relationType==='maternal_grandparents' || relationType==='paternal_grandparents'){
        options.createPair = createPair;
        if(createPair){ body.partner = { name: partnerName.trim(), email: partnerEmail.trim(), tempPassword: partnerTempPassword }; }
      }
      if(relationType==='aunt_uncle' && sideOverride) options.side = sideOverride;
      if(relationType==='cousin') options.uncleAuntId = selectedUncleAuntId;
      if(Object.keys(options).length>0) body.options = options;
      const idem=crypto.randomUUID();
  const resp= await api<{nodes:RawPerson[];edges:RawEdge[]}>(`/relations/add`, { method:'POST', headers:{ 'Idempotency-Key': idem }, body });
      setPeople(prev=>{ const existing=new Set(prev.map(p=>p.id)); const adds=resp.nodes.filter(n=>!existing.has(n.id)); return adds.length? [...prev, ...adds]: prev; });
      setEdges(prev=>{ const existing=new Set(prev.map(e=>e.id)); const adds=resp.edges.filter(e=>!existing.has(e.id||'')); return adds.length? [...prev, ...adds]: prev; });
      setPersonName(''); setPersonEmail(''); setPersonGender(''); setPersonBirth(''); setTempPassword(''); setCreatePair(false); setPartnerName(''); setPartnerEmail(''); setPartnerTempPassword(''); setSelectedUncleAuntId(''); setFriendlyError(null); setError(null); toast.success('Relative added');
    } catch(e:any){
      const code=e?.code||e?.raw?.code;
      if(code) setFriendlyError(mapRelationError(code));
      if(e?.raw && Array.isArray(e.raw) && e.raw[0]?.code==='invalid_type' && e.raw[0]?.expected==='object' && e.raw[0]?.path?.length===0){ setError('Bad request payload (server expected JSON object)'); }
      else setError(e?.message||'Failed');
    } finally { setSaving(false); }
  }
  async function deleteSelectedPerson(){ if(!familyId || !selectedPersonId) return; try { await api(`/families/${familyId}/nodes/${selectedPersonId}`, { method:'DELETE'}); setPeople(p=>p.filter(pp=>pp.id!==selectedPersonId)); setEdges(es=>es.filter(e=> e.sourceId!==selectedPersonId && e.targetId!==selectedPersonId)); setSelectedPersonId(null); setSelectedEdgeId(null); toast.success('Person deleted'); } catch(e:any){ toast.error(e?.message||'Delete failed'); } }
  async function deleteSelectedEdge(){ if(!familyId || !selectedEdgeId) return; const rawIds=visualEdgeMap[selectedEdgeId]||[]; if(!rawIds.length){ toast.error('No underlying relation ids'); return;} let success=0; for(const rid of rawIds){ if(!rid) continue; try { await api(`/families/${familyId}/edges/${rid}`, { method:'DELETE'}); success++; } catch {} } if(success){ setEdges(prev=>prev.filter(e=> !rawIds.includes(e.id||''))); setSelectedEdgeId(null); toast.success(`Deleted ${success} edge${success>1?'s':''}`);} else toast.error('Delete failed'); }

  return (
    <main className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <h1 className="text-lg font-semibold">Family Tree V2</h1>
        <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ if(!canvasRef.current) return; htmlToImage.toPng(canvasRef.current,{pixelRatio:2}).then(data=>{ const a=document.createElement('a'); a.href=data; a.download=`family-tree-${familyId}.png`; a.click(); }).catch(()=>toast.error('Export failed')); }}>Export PNG</button>
        <div className="ml-auto flex gap-2">
          {selectedPersonId && <button className="text-xs px-2 py-1 border rounded" onClick={deleteSelectedPerson}>Delete Person</button>}
          {selectedEdgeId && <button className="text-xs px-2 py-1 border rounded border-red-500 text-red-600" onClick={deleteSelectedEdge}>Delete Edge</button>}
          <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ setShowAdd(s=>!s); if(!showAdd) setTargetPersonId(selectedPersonId); }}>Add Relative</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <button onClick={()=>{ setShowAdd(true); setRelationType('spouse'); setPersonGender(''); setGenderLocked(false); setTargetPersonId(selectedPersonId); }} className="px-2 py-1 border rounded">Spouse</button>
        <button onClick={()=>{ setShowAdd(true); setRelationType('parent'); setPersonGender('FEMALE'); setGenderLocked(true); setTargetPersonId(selectedPersonId); }} className="px-2 py-1 border rounded">Mother</button>
        <button onClick={()=>{ setShowAdd(true); setRelationType('parent'); setPersonGender('MALE'); setGenderLocked(true); setTargetPersonId(selectedPersonId); }} className="px-2 py-1 border rounded">Father</button>
        <button onClick={()=>{ setShowAdd(true); setRelationType('child'); setPersonGender('MALE'); setGenderLocked(true); setTargetPersonId(selectedPersonId); }} className="px-2 py-1 border rounded">Son</button>
        <button onClick={()=>{ setShowAdd(true); setRelationType('child'); setPersonGender('FEMALE'); setGenderLocked(true); setTargetPersonId(selectedPersonId); }} className="px-2 py-1 border rounded">Daughter</button>
        <button disabled={!selectedPersonId || !refHasParent(selectedPersonId)} title="Requires selected person with a parent" onClick={()=>{ if(!selectedPersonId) return; if(!refHasParent(selectedPersonId)){ toast.error('Selected person needs a parent first'); return; } setShowAdd(true); setRelationType('sibling'); setPersonGender(''); setGenderLocked(false); setTargetPersonId(selectedPersonId); }} className="px-2 py-1 border rounded disabled:opacity-40">Sibling</button>
        <label className="flex items-center gap-1 ml-2"><input type="checkbox" checked={autoLayoutAfter} onChange={e=>setAutoLayoutAfter(e.target.checked)} /> <span className="text-[10px]">Animate layout after create</span></label>
      </div>
      {showAdd && (
        <div className="mb-4 border rounded p-3 bg-white max-w-2xl text-xs space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="block">Relation
              <select value={relationType} onChange={e=>{ setRelationType(e.target.value as RelationType); setFriendlyError(null); setError(null); }} className="mt-1 border rounded p-1 text-xs">
                <option value="parent">Parent</option>
                <option value="child">Child</option>
                <option value="spouse">Spouse</option>
                <option value="sibling">Sibling</option>
                <option value="maternal_grandparents">Maternal Grandparent(s)</option>
                <option value="paternal_grandparents">Paternal Grandparent(s)</option>
                <option value="aunt_uncle">Aunt/Uncle</option>
                <option value="cousin">Cousin</option>
              </select>
            </label>
            <label className="block">Reference
              <select value={targetPersonId||''} onChange={e=>setTargetPersonId(e.target.value||null)} className="mt-1 border rounded p-1 text-xs">
                <option value="">-- select --</option>
                {people.map(p=> <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {relationType==='aunt_uncle' && (
              <label className="block">Side
                <select value={sideOverride} onChange={e=>setSideOverride(e.target.value as any)} className="mt-1 border rounded p-1 text-xs">
                  <option value="">Auto</option>
                  <option value="maternal">Maternal</option>
                  <option value="paternal">Paternal</option>
                </select>
              </label>
            )}
            {relationType==='cousin' && (
              <label className="block">Uncle/Aunt
                <select value={selectedUncleAuntId} onChange={e=>setSelectedUncleAuntId(e.target.value)} className="mt-1 border rounded p-1 text-xs">
                  <option value="">-- select --</option>
                  {auntsUnclesForRef.map(p=> <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            <label className="block">Name
              <input value={personName} onChange={e=>setPersonName(e.target.value)} className="mt-1 border rounded p-1 text-xs w-40" />
            </label>
            <label className="block">Email
              <input value={personEmail} onChange={e=>setPersonEmail(e.target.value)} className="mt-1 border rounded p-1 text-xs w-48" />
            </label>
            <label className="block">Temp Password
              <input type="password" value={tempPassword} onChange={e=>setTempPassword(e.target.value)} className="mt-1 border rounded p-1 text-xs w-40" />
            </label>
            <label className="block">Gender {genderLocked && <span className="text-[10px] text-slate-500">(locked)</span>}
              <select value={personGender} onChange={e=>{ if(genderLocked) return; setPersonGender(e.target.value); }} className="mt-1 border rounded p-1 text-xs w-28 disabled:opacity-50" disabled={genderLocked}>
                <option value="">--</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            {personGender && <label className="flex items-center gap-1 mt-5 text-[10px]"><input type="checkbox" checked={genderLocked} onChange={e=>setGenderLocked(e.target.checked)} /> Lock</label>}
            <label className="block">Birth
              <input type="date" value={personBirth} onChange={e=>setPersonBirth(e.target.value)} className="mt-1 border rounded p-1 text-xs" />
            </label>
            {(relationType==='maternal_grandparents' || relationType==='paternal_grandparents') && (
              <div className="border rounded p-2 bg-slate-50 space-y-1">
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={createPair} onChange={e=>setCreatePair(e.target.checked)} /> Create pair</label>
                {createPair && (
                  <div className="space-y-1">
                    <label className="block text-[11px]">Partner Name<input value={partnerName} onChange={e=>setPartnerName(e.target.value)} className="mt-0.5 border rounded p-1 text-xs w-full" /></label>
                    <label className="block text-[11px]">Partner Email<input value={partnerEmail} onChange={e=>setPartnerEmail(e.target.value)} className="mt-0.5 border rounded p-1 text-xs w-full" /></label>
                    <label className="block text-[11px]">Partner Temp<input type="password" value={partnerTempPassword} onChange={e=>setPartnerTempPassword(e.target.value)} className="mt-0.5 border rounded p-1 text-xs w-full" /></label>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-col justify-end pb-1">
              <div className="text-[10px] text-slate-500">{dynLabel}</div>
              <div className="flex gap-2 mt-1">
                <button className="px-2 py-1 border rounded" disabled={saving} onClick={()=>{ setShowAdd(false); }}>Close</button>
                <button className="px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={saving} onClick={submitAdd}>{saving?'Saving...':'Create'}</button>
              </div>
            </div>
          </div>
          {friendlyError && <div className="text-amber-600 text-[11px]">{friendlyError}</div>}
          {error && <div className="text-red-600 text-[11px]">{error}</div>}
        </div>
      )}
      <div className="relative border rounded bg-neutral-900 text-slate-100 overflow-auto h-[70vh] p-6" ref={canvasRef} onClick={()=>{ setSelectedPersonId(null); setSelectedEdgeId(null); }}>
        {t.units.map(u=>{ const w=u.kind==='couple'?220: (u.kind==='verticalPair'?180:140); const pos=animPositions[u.id]||{x:u.x,y:u.y}; const isSelectedSingle = u.kind==='single' && selectedPersonId===u.personId; return (
          <div key={u.id} style={{position:'absolute', left:pos.x, top:pos.y, width:w}} className={`border rounded ${u.kind==='verticalPair'?'bg-indigo-50/20':'bg-indigo-50/40'} backdrop-blur px-3 py-2 shadow-sm ${isSelectedSingle?'ring-2 ring-indigo-500':''} ${u.kind==='single' || u.kind==='couple' ? 'cursor-pointer':''}`} onClick={(e)=>{ if(u.kind==='single'){ e.stopPropagation(); setSelectedEdgeId(null); setSelectedPersonId(u.personId); } else if(u.kind==='couple'){ e.stopPropagation(); setSelectedEdgeId(null); setSelectedPersonId(null); } }}>
            {u.kind==='couple' && (
              <div className="text-xs font-medium">
                <div className="mb-1">Couple</div>
                <div className="flex gap-2 text-[11px]">
                  <span className="px-2 py-1 bg-white border rounded">{people.find(p=>p.id===u.partnerIds[0])?.name||'?'}</span>
                  <span className="px-2 py-1 bg-white border rounded">{people.find(p=>p.id===u.partnerIds[1])?.name||'?'}</span>
                </div>
              </div>
            )}
            {u.kind==='verticalPair' && (
              <div className="text-xs font-medium">
                <div className="mb-1">Parents</div>
                <div className="flex flex-col gap-1 text-[11px]">
                  {u.partnerIds.map((pid,idx)=>{ const selected = selectedPersonId===pid; return (
                    <span key={pid} onClick={(e)=>{ e.stopPropagation(); setSelectedEdgeId(null); setSelectedPersonId(pid); }} className={`px-2 py-1 border rounded text-center cursor-pointer bg-white ${selected?'ring-2 ring-indigo-500 font-semibold':''}`}>
                      {people.find(p=>p.id===pid)?.name||'?'}
                      {idx===0 && !people.find(p=>p.id===pid)?.name && ' '}
                    </span>
                  ); })}
                </div>
                <div className="mt-1 text-[10px] text-slate-600">Gen {u.generation}</div>
              </div>
            )}
            {u.kind==='single' && (
              <div>
                <div className="text-sm font-medium truncate">{people.find(p=>p.id===u.personId)?.name||'?'}</div>
                <div className="mt-1 text-[10px] text-slate-600">Gen {u.generation}</div>
              </div>
            )}
          </div>
        ); })}
        <svg className="absolute inset-0 overflow-visible pointer-events-none" width="100%" height="100%">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
            </marker>
          </defs>
        </svg>
        <svg className="absolute inset-0 overflow-visible" width="100%" height="100%">
          {t.edges.map(e=>{ const su=t.units.find(u=>u.id===e.sourceUnitId); const tu=t.units.find(u=>u.id===e.targetUnitId); if(!su||!tu) return null; const sx=su.x+(su.kind==='couple'?110:70); const sy=su.y+60; const tx=tu.x+(tu.kind==='couple'?110:70); const ty=tu.y-10; const selected=selectedEdgeId===e.id; return (
            <g key={e.id} onClick={(ev)=>{ ev.stopPropagation(); setSelectedEdgeId(e.id); setSelectedPersonId(null); }} className="cursor-pointer">
              <line x1={sx} y1={sy} x2={tx} y2={ty} stroke={selected? '#dc2626':'#6366f1'} strokeWidth={selected?4:2} markerEnd="url(#arrow)" />
              {selected && <circle cx={(sx+tx)/2} cy={(sy+ty)/2} r={6} fill="#dc2626" stroke="#fff" strokeWidth={1} />}
            </g>
          ); })}
        </svg>
      </div>
      <div className="mt-3 text-[11px] text-slate-500">Units: {t.units.length} · Visual Edges: {t.edges.length} · Raw People: {people.length} · Raw Edges: {edges.length}</div>
      {t.warnings.length>0 && (
        <div className="mt-2 bg-amber-50 border border-amber-300 rounded p-2 text-[11px] max-w-xl">
          <div className="font-semibold mb-1">Data Warnings</div>
          <ul className="list-disc ml-4 space-y-0.5">{t.warnings.slice(0,5).map(w=> <li key={w}>{w}</li>)}</ul>
          {t.warnings.length>5 && <div className="text-[10px] mt-1">+ {t.warnings.length-5} more…</div>}
        </div>
      )}
    </main>
  );
}
