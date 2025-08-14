"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ReactFlow, type Edge, type Node, Background, Controls, MarkerType, Handle, Position, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as htmlToImage from 'html-to-image';
import { api } from '@/lib/api';
import { transform as genTransform, RawPerson as GenPerson, RawEdge as GenEdge } from '@/lib/treev2/transform';
import { mapRelationError } from '@/lib/relationErrors';
import { getSocket } from '@/lib/socket';
import { toast } from '@/lib/toast';

type EdgeType = 'SPOUSE' | 'PARENT' | 'SON' | 'DAUGHTER';

export default function FamilyTreeByIdPage() {
  const params = useParams<{ id: string }>();
  const familyId = params.id;
  const [families, setFamilies] = useState<Array<{ id: string; name: string }>>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState<string>("");
  const [manualToId, setManualToId] = useState<string>('');
  const [manualType, setManualType] = useState<EdgeType | ''>('');
  // Add Person relationship (optional)
  const [pRelType, setPRelType] = useState<EdgeType | ''>('');
  // Controlled Add Person inputs
  const [pName, setPName] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pGender, setPGender] = useState('');
  const [pBirth, setPBirth] = useState('');
  const [pTemp, setPTemp] = useState('');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const [snap, setSnap] = useState<boolean>(false);
  // New backend relation feature panel state
  const [showRelAddNew, setShowRelAddNew] = useState(false);
  const [relTypeNew, setRelTypeNew] = useState('parent');
  const [relRefId, setRelRefId] = useState<string>('');
  const [relName, setRelName] = useState('');
  const [relEmail, setRelEmail] = useState('');
  const [relGender, setRelGender] = useState('');
  const [relGenderLocked, setRelGenderLocked] = useState(false); // quick-add lock
  const [relBirth, setRelBirth] = useState('');
  const [relTempPwd, setRelTempPwd] = useState('');
  const [relCreatePair, setRelCreatePair] = useState(false);
  const [partnerName, setPartnerName] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerTempPwd, setPartnerTempPwd] = useState('');
  const [auSide, setAuSide] = useState<'maternal'|'paternal'|''>('');
  const [cousinUncleAuntId, setCousinUncleAuntId] = useState('');
  const [relSaving, setRelSaving] = useState(false);
  const [relError, setRelError] = useState<string|null>(null);
  const [relFriendly, setRelFriendly] = useState<string|null>(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        const me = await api<{ user: { sub: string; email: string } }>("/auth/me");
        setCurrentUserId(me.user.sub);
      } catch { window.location.href = '/login'; return; }
      try {
        const res = await api<{ families: Array<{ id: string; name: string }> }>(`/families`);
        setFamilies(res.families);
        const fam = res.families.find((f) => f.id === familyId);
        if (fam) setFamilyName(fam.name);
      } catch {}
      if (familyId) {
        try {
          const data = await api<{ nodes: any[]; edges: Edge[] }>(`/families/${familyId}/tree`);
      setNodes(data.nodes.map((n) => ({
            ...n,
            type: 'personNode',
            data: {
              name: n.data?.name,
              email: n.data?.email,
              gender: n.data?.gender,
              birthDate: n.data?.birthDate,
        deathDate: n.data?.deathDate,
            },
          })));
          setEdges(data.edges);
        } catch {
          toast.error('Family not found');
          window.location.href = '/families';
          return;
        }
      }
    }
    bootstrap();
  }, [familyId]);

  useEffect(() => {
    const s = getSocket();
    if (!familyId) return;
    s.emit('join-family', familyId);
  const upsert = (node: any) => setNodes((prev) => {
      const idx = prev.findIndex((n) => n.id === node.id);
      const entry: Node = {
        id: node.id,
        type: 'personNode',
    data: { name: node.name, email: node.email, gender: node.gender, birthDate: node.birthDate, deathDate: node.deathDate },
        position: { x: Number(node.posX ?? 0), y: Number(node.posY ?? 0) }
      };
      if (idx === -1) return [...prev, entry];
      const clone = [...prev];
      clone[idx] = { ...clone[idx], data: entry.data, position: entry.position };
      return clone;
    });
    const move = (p: { id: string; posX: number; posY: number }) => setNodes((prev) => prev.map((n) => n.id === p.id ? { ...n, position: { x: Number(p.posX), y: Number(p.posY) } } : n));
    const edgeCreated = (e: any) => setEdges((prev) => {
      if (prev.some((ed) => ed.id === e.id)) return prev;
      const filtered = prev.filter((ed) => !(ed.source === e.sourceId && ed.target === e.targetId));
      toast.success('Relationship created');
      return [...filtered, { id: e.id, source: e.sourceId, target: e.targetId, label: e.label, data: { type: e.label } }];
    });
    s.on('node:upsert', upsert);
    s.on('node:move', move);
    s.on('edge:created', edgeCreated);
  const onNodeDeleted = (p: { id: string }) => setNodes((prev) => prev.filter((n) => n.id !== p.id));
  const onEdgeDeleted = (p: { id: string }) => setEdges((prev) => prev.filter((e) => e.id !== p.id));
  s.on('node:deleted', onNodeDeleted);
  s.on('edge:deleted', onEdgeDeleted);
    return () => {
      s.off('node:upsert', upsert);
      s.off('node:move', move);
      s.off('edge:created', edgeCreated);
      s.off('node:deleted', onNodeDeleted);
      s.off('edge:deleted', onEdgeDeleted);
    };
  }, [familyId]);

  const onNodesChange = (changes: any) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  };

  const onNodeDragStop = async (_: any, node: Node) => {
    if (!familyId) return;
    try {
      await api(`/families/${familyId}/nodes/${node.id}/position`, { method: 'PATCH', body: JSON.stringify({ posX: node.position.x, posY: node.position.y }) });
    } catch { toast.error('Failed to save position'); }
  };

  const onConnect = async (params: any) => {
    if (!familyId) return;
    if (params.source === params.target) { toast.error('Cannot link a node to itself'); return; }
    const typePrompt = window.prompt('Relationship type (PARENT, SPOUSE, SON, DAUGHTER)', 'PARENT');
    if (!typePrompt) return;
    const type = typePrompt.toUpperCase().trim();
    if (!['PARENT','SPOUSE','SON','DAUGHTER'].includes(type)) { toast.error('Invalid type'); return; }
    if (type === 'SPOUSE') {
      const exists = edges.some((e) => (e.source === params.source && e.target === params.target) || (e.source === params.target && e.target === params.source));
      if (exists) { toast.error('Spouse relationship already exists'); return; }
    } else {
      const exists = edges.some((e) => e.source === params.source && e.target === params.target);
      if (exists) { toast.error('Relationship already exists'); return; }
    }
    await createEdge(params.source, params.target, type as EdgeType);
  };

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const manualDuplicate = useMemo(() => {
    if (!selectedNodeId || !manualToId || !manualType) return false;
    if (manualType === 'SPOUSE') {
      return edges.some((e) => ((e.source === selectedNodeId && e.target === manualToId) || (e.source === manualToId && e.target === selectedNodeId)));
    }
    return edges.some((e) => e.source === selectedNodeId && e.target === manualToId);
  }, [edges, selectedNodeId, manualToId, manualType]);

  async function createFamily(name: string) {
    const res = await api<{ family: { id: string } }>(`/families`, { method: 'POST', body: JSON.stringify({ name }) });
    const id = res.family.id;
    window.location.href = `/families/${id}/tree`;
  }

  async function upsertNode(name: string, email: string, gender?: string, birthDate?: string, tempPassword?: string) {
    if (!familyId) return;
    // place new node with a slight random offset to reduce overlap
    const baseX = 100 + Math.floor(Math.random() * 120);
    const baseY = 100 + Math.floor(Math.random() * 120);
    if (!email) { toast.error('Email is required'); return; }
    if (!tempPassword || tempPassword.length < 8) { toast.error('Temporary password (min 8 chars) is required'); return; }
    const res = await api<{ node: any }>(`/families/${familyId}/nodes`, {
      method: 'POST',
      body: JSON.stringify({ name, email, posX: baseX, posY: baseY, gender, birthDate, tempPassword })
    }).catch((err) => { toast.error('Failed to add person'); throw err; });
    const node = res.node;
    setNodes((prev) => [...prev, {
      id: node.id,
      data: { name: node.name, email: node.email, gender: node.gender, birthDate: node.birthDate },
      position: { x: node.posX ?? 0, y: node.posY ?? 0 }, type: 'personNode'
    }]);
    // Auto-link from current user if relationship chosen in modal
    if (pRelType) {
      const source = currentUserId || selectedNodeId; // current user preferred
      if (source) await createEdge(source, node.id, pRelType, true);
    }
    toast.success('Person added');
  }

  async function createEdge(sourceId: string, targetId: string, type: EdgeType, silent = false) {
    if (!familyId) return;
    try {
      const res = await api<{ edge: { id: string; sourceId: string; targetId: string; type: string; label?: string } }>(
        `/families/${familyId}/edges`,
        { method: 'POST', body: JSON.stringify({ sourceId, targetId, type }) }
      );
      // Optimistically update if socket misses
      setEdges((prev) => {
        if (prev.some((e) => e.id === res.edge.id)) return prev;
        const label = res.edge.label || res.edge.type;
        return [
          ...prev.filter((e) => !(e.source === res.edge.sourceId && e.target === res.edge.targetId)),
          { id: res.edge.id, source: res.edge.sourceId, target: res.edge.targetId, label, data: { type: label } } as any,
        ];
      });
      if (!silent) toast.success('Relationship created');
    } catch (err: any) {
      const msg = err?.message || 'Failed to create relationship';
      if (!silent) toast.error(msg);
    }
  }

  async function updateSelectedPosition(x: number, y: number) {
    if (!familyId || !selectedNode) return;
    setNodes((prev) => prev.map((n) => (n.id === selectedNode.id ? { ...n, position: { x, y } } : n)));
    await api(`/families/${familyId}/nodes/${selectedNode.id}/position`, { method: 'PATCH', body: JSON.stringify({ posX: x, posY: y }) });
  }

  const [showAddPerson, setShowAddPerson] = useState(false);
  // Removed legacy manual relationship panel (unified backend add) - old showAddRel state removed
  const [showMore, setShowMore] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [transformState, setTransformState] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  // Measure toolbar height (for popover positioning) when visibility changes / resize
  useEffect(() => {
    function measure() { if (toolbarRef.current) setToolbarHeight(toolbarRef.current.getBoundingClientRect().height); }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [showAddPerson, showRelAddNew]);
  // Keyboard shortcuts: A(Add Person), R(Add Relationship), F(Fit)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (['input','textarea','select'].includes(tag)) return; // avoid while typing
  if (e.key === 'a' || e.key === 'A') { setShowAddPerson((p:boolean) => !p); setShowRelAddNew(false); }
  if (e.key === 'r' || e.key === 'R') { setShowRelAddNew((p:boolean) => !p); setShowAddPerson(false); }
      if (e.key === 'f' || e.key === 'F') { try { rfInstance?.fitView?.({ padding: 0.2 }); } catch {} }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rfInstance]);
  const manualFormType = manualType; // (legacy manual) retained for connector compatibility
  const [autoLayoutAfterAdd, setAutoLayoutAfterAdd] = useState(false);

  function autoLayout(){
    const people: GenPerson[] = nodes.map(n=>({ id:n.id, name: (n.data as any)?.name || 'Unknown', email:(n.data as any)?.email||null, gender:(n.data as any)?.gender||null, birthDate:(n.data as any)?.birthDate||null }));
    const seenSpouse = new Set<string>();
    const relEdges: GenEdge[] = edges.flatMap(e=>{
      const type = e.data?.type || e.label;
      if(type==='PARENT') return [{ type:'PARENT_OF', sourceId:e.source, targetId:e.target } as any];
      if(type==='SON' || type==='DAUGHTER') return [{ type:'PARENT_OF', sourceId:e.source, targetId:e.target } as any];
      if(type==='SPOUSE') {
        const k = e.source < e.target ? e.source+'::'+e.target : e.target+'::'+e.source; // undirected uniqueness
        if(seenSpouse.has(k)) return [];
        seenSpouse.add(k);
        return [{ type:'SPOUSE_OF', sourceId:e.source, targetId:e.target } as any];
      }
      return [];
    });
    const t = genTransform(people, relEdges);
    const targetPos: Record<string,{x:number;y:number}> = {};
    t.units.forEach(u=>{
      if(u.kind==='single') targetPos[u.personId]={ x: Math.round(u.x), y: Math.round(u.y) };
      else { const [a,b]=u.partnerIds; const baseX=u.x; const baseY=u.y; targetPos[a]={x:Math.round(baseX),y:Math.round(baseY)}; targetPos[b]={x:Math.round(baseX+110),y:Math.round(baseY)}; }
    });
    // Animate
    const startPositions: Record<string,{x:number;y:number}> = {};
    nodes.forEach(n=>{ startPositions[n.id]={ x:n.position.x, y:n.position.y }; });
    const duration = 400; const startTs = performance.now();
    function frame(now:number){
      const p = Math.min(1, (now-startTs)/duration);
      const ease = p<0.5 ? 2*p*p : -1+(4-2*p)*p; // easeInOutQuad
      setNodes(prev=> prev.map(n=>{
        const tgt = targetPos[n.id]; if(!tgt) return n;
        const start = startPositions[n.id];
        const x = Math.round(start.x + (tgt.x-start.x)*ease);
        const y = Math.round(start.y + (tgt.y-start.y)*ease);
        return { ...n, position:{ x,y } };
      }));
      if(p<1) requestAnimationFrame(frame); else {
        // Persist final only
        if(familyId){ Object.entries(targetPos).forEach(([id,pv])=>{ api(`/families/${familyId}/nodes/${id}/position`, { method:'PATCH', body: JSON.stringify({ posX:pv.x, posY:pv.y }) }).catch(()=>{}); }); }
        toast.success('Auto layout applied');
      }
    }
    requestAnimationFrame(frame);
  }
  return (
    <main className="h-[calc(100dvh-96px)] mx-4 my-0 border rounded overflow-hidden flex flex-col">
      {/* Top Toolbar (simplified) */}
      <div ref={toolbarRef} className="flex flex-wrap items-center gap-2 p-2 border-b bg-white text-sm relative z-20">
  <button className="bg-gray-800 text-white px-3 py-1 rounded" onClick={()=>{ setShowAddPerson((p:boolean)=>!p); setShowRelAddNew(false); }}>Add Person</button>
  {/* Removed: legacy manual add relationship button */}
  <button className="bg-indigo-700 text-white px-3 py-1 rounded" onClick={()=>{ setShowRelAddNew(s=>!s); if(!relRefId && selectedNodeId) setRelRefId(selectedNodeId); }}>Add Relative (new)</button>
        <div className="flex items-center gap-1 ml-2 text-[11px]">
          {/* Quick core relations */}
          <span className="text-gray-500">Quick:</span>
          <button className="px-2 py-0.5 border rounded" disabled={!selectedNodeId} title="Add spouse" onClick={()=>{ if(!selectedNodeId) return; setRelRefId(selectedNodeId); setRelTypeNew('spouse'); setRelGender(''); setShowRelAddNew(true); }}>Spouse</button>
          <button className="px-2 py-0.5 border rounded" disabled={!selectedNodeId} title="Add mother" onClick={()=>{ if(!selectedNodeId) return; setRelRefId(selectedNodeId); setRelTypeNew('parent'); setRelGender('FEMALE'); setShowRelAddNew(true); }}>Mother</button>
          <button className="px-2 py-0.5 border rounded" disabled={!selectedNodeId} title="Add father" onClick={()=>{ if(!selectedNodeId) return; setRelRefId(selectedNodeId); setRelTypeNew('parent'); setRelGender('MALE'); setShowRelAddNew(true); }}>Father</button>
          <button className="px-2 py-0.5 border rounded" disabled={!selectedNodeId} title="Add son" onClick={()=>{ if(!selectedNodeId) return; /* selected is parent */ setRelRefId(selectedNodeId); setRelTypeNew('child'); setRelGender('MALE'); setShowRelAddNew(true); }}>Son</button>
          <button className="px-2 py-0.5 border rounded" disabled={!selectedNodeId} title="Add daughter" onClick={()=>{ if(!selectedNodeId) return; setRelRefId(selectedNodeId); setRelTypeNew('child'); setRelGender('FEMALE'); setShowRelAddNew(true); }}>Daughter</button>
          <button className="px-2 py-0.5 border rounded" disabled={!selectedNodeId || !edges.some(e=> (e.label==='PARENT' || e.data?.type==='PARENT') && e.target===selectedNodeId)} title="Add sibling (requires selected person to have a parent)" onClick={()=>{ if(!selectedNodeId) { return;} if(!edges.some(e=> (e.label==='PARENT' || e.data?.type==='PARENT') && e.target===selectedNodeId)){ toast.error('Selected person needs a parent first'); return; } setRelRefId(selectedNodeId); setRelTypeNew('sibling'); setRelGender(''); setShowRelAddNew(true); }}>Sibling</button>
          <button className="px-2 py-0.5 border rounded" title="Auto generation layout" onClick={()=>autoLayout()}>Auto Layout</button>
        </div>
        <button className="border px-3 py-1 rounded bg-white hover:bg-gray-50" onClick={()=>setShowMore(m=>!m)}>More ▾</button>
        {showMore && (
          <div className="absolute top-full left-0 mt-1 w-[260px] bg-white border rounded shadow text-xs p-2 z-30 space-y-1">
            <div className="flex items-center justify-between">
              <span>Snap to grid</span>
              <input type="checkbox" checked={snap} onChange={(e)=>setSnap(e.target.checked)} />
            </div>
            <button className="w-full text-left px-2 py-1 rounded hover:bg-gray-100" onClick={()=>{ try { rfInstance?.fitView?.({ padding:0.2 }); } catch {}; setShowMore(false); }}>Fit View (F)</button>
            <button className="w-full text-left px-2 py-1 rounded hover:bg-gray-100" onClick={async ()=>{ try { await navigator.clipboard.writeText(window.location.href); toast.success('Link copied'); } catch {}; setShowMore(false); }}>Copy Link</button>
            <button className="w-full text-left px-2 py-1 rounded hover:bg-gray-100" onClick={async ()=>{ const el=canvasRef.current as HTMLDivElement|null; if(!el) return; try { const dataUrl= await htmlToImage.toPng(el,{pixelRatio:2}); const a=document.createElement('a'); a.href=dataUrl; a.download=`family-tree-${familyId||'export'}.png`; a.click(); } catch { toast.error('Export failed'); } setShowMore(false); }}>Export PNG</button>
            {selectedNode && selectedNode.id !== currentUserId && <button className="w-full text-left px-2 py-1 rounded hover:bg-red-50 hover:text-red-700" onClick={async ()=>{ if(!familyId||!selectedNode) return; if(selectedNode.id===currentUserId){ toast.error('You cannot delete yourself'); return; } try { await api(`/families/${familyId}/nodes/${selectedNode.id}`, { method:'DELETE'}); toast.success('Person removed'); } catch (e:any) { toast.error(e?.message||'Delete failed'); } setNodes(prev=>prev.filter(n=>n.id!==selectedNode.id)); setSelectedNodeId(null); setShowMore(false); }}>Delete Selected Node</button>}
            {selectedEdgeId && <button className="w-full text-left px-2 py-1 rounded hover:bg-red-50 hover:text-red-700" onClick={async ()=>{ if(!familyId||!selectedEdgeId) return; try { await api(`/families/${familyId}/edges/${selectedEdgeId}`, { method:'DELETE'}); toast.success('Relationship removed'); } catch { toast.error('Delete failed'); } setEdges(prev=>prev.filter(e=>e.id!==selectedEdgeId)); setSelectedEdgeId(null); setShowMore(false); }}>Delete Selected Edge</button>}
    <div className="pt-1 border-t mt-1 text-[10px] text-gray-500">Shortcuts: A Add Person · R Add Relationship · F Fit View</div>
          </div>
        )}
  </div>
      {/* Popover Panels */}
      {showAddPerson && (
        <div className="absolute z-30 bg-white border rounded shadow p-4 w-80 space-y-2 text-sm" style={{ top: toolbarHeight + 100, left: 32 }}>
          <div className="font-semibold mb-1">Add Person</div>
          <input value={pName} onChange={(e)=>setPName(e.target.value)} placeholder="Name" className="border rounded px-2 py-1 w-full" />
          <input value={pEmail} onChange={(e)=>setPEmail(e.target.value)} placeholder="Email" type="email" className="border rounded px-2 py-1 w-full" />
          <div className="flex gap-2">
            <select value={pGender} onChange={(e)=>setPGender(e.target.value)} className="border rounded px-2 py-1 w-full">
              <option value="">Gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
            <input value={pBirth} onChange={(e)=>setPBirth(e.target.value)} type="date" className="border rounded px-2 py-1 w-full" />
          </div>
          <input value={pTemp} onChange={(e)=>setPTemp(e.target.value)} type="password" placeholder="Temp password (min 8)" className="border rounded px-2 py-1 w-full" />
          <select value={pRelType} onChange={(e)=>setPRelType((e.target.value||'') as any)} className="border rounded px-2 py-1 w-full">
            <option value="">No immediate relationship</option>
            <option value="PARENT">PARENT</option>
            <option value="SPOUSE">SPOUSE</option>
            <option value="SON">SON</option>
            <option value="DAUGHTER">DAUGHTER</option>
          </select>
          <div className="flex justify-between pt-1">
            <span className="text-[11px] text-gray-500">Links from you if relationship chosen.</span>
            <div className="flex gap-2">
              <button className="text-xs px-2 py-1" onClick={()=>{ setShowAddPerson(false); }}>Cancel</button>
              <button className="bg-gray-800 text-white px-3 py-1 rounded text-xs" onClick={()=>{ const name = pName.trim(); if(!name){ toast.error('Name required'); return;} upsertNode(name, pEmail.trim()||'', pGender||undefined, pBirth||undefined, pTemp||undefined); setPName(''); setPEmail(''); setPGender(''); setPBirth(''); setPTemp(''); setPRelType(''); setShowAddPerson(false); }}>Add</button>
            </div>
          </div>
        </div>
      )}
  {/* Legacy manual panel removed */}
      {showRelAddNew && (
        <div className="absolute z-30 bg-white border rounded shadow p-4 w-96 space-y-2 text-xs" style={{ top: toolbarHeight + 100, left: 360 }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold text-sm mb-1">Add Relative (Backend)</div>
              {(() => { const dyn = relTypeNew==='parent' ? (relGender==='FEMALE'?'Mother': relGender==='MALE'?'Father':'Parent') : relTypeNew==='child' ? (relGender==='FEMALE'?'Daughter': relGender==='MALE'?'Son':'Child') : relTypeNew.charAt(0).toUpperCase()+relTypeNew.slice(1); return (
              <label className="block mb-1">Relation Type <span className="ml-1 text-[10px] text-indigo-600">{dyn}</span>
                <select value={relTypeNew} onChange={e=>{ setRelTypeNew(e.target.value); setRelFriendly(null); setRelError(null);} } className="mt-0.5 w-full border rounded px-2 py-1">
                  <option value="parent">Parent</option>
                  <option value="child">Child</option>
                  <option value="spouse">Spouse</option>
                  <option value="sibling">Sibling</option>
                  <option value="maternal_grandparents">Maternal Grandparent(s)</option>
                  <option value="paternal_grandparents">Paternal Grandparent(s)</option>
                  <option value="aunt_uncle">Aunt / Uncle</option>
                  <option value="cousin">Cousin</option>
                </select>
              </label> ) })()}
              <label className="block mb-1">Reference Person
                <select value={relRefId} onChange={e=>setRelRefId(e.target.value)} className="mt-0.5 w-full border rounded px-2 py-1">
                  <option value="">-- select --</option>
                  {nodes.map(n=> <option key={n.id} value={n.id}>{String((n.data as any)?.name)||n.id}</option>)}
                </select>
              </label>
              {(relTypeNew==='aunt_uncle') && (
                <label className="block mb-1">Side
                  <select value={auSide} onChange={e=>setAuSide(e.target.value as any)} className="mt-0.5 w-full border rounded px-2 py-1">
                    <option value="">Auto</option>
                    <option value="maternal">Maternal</option>
                    <option value="paternal">Paternal</option>
                  </select>
                </label>
              )}
              {(relTypeNew==='cousin') && (
                <label className="block mb-1">Uncle/Aunt (parent's sibling)
                  <select value={cousinUncleAuntId} onChange={e=>setCousinUncleAuntId(e.target.value)} className="mt-0.5 w-full border rounded px-2 py-1">
                    <option value="">-- select --</option>
                    {nodes.filter(n=>n.id!==relRefId).map(n=> <option key={n.id} value={n.id}>{String((n.data as any)?.name)||n.id}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="flex-1 space-y-1">
              <label className="block">Name<input value={relName} onChange={e=>setRelName(e.target.value)} className="mt-0.5 w-full border rounded px-2 py-1" /></label>
              <label className="block">Email<input value={relEmail} onChange={e=>setRelEmail(e.target.value)} className="mt-0.5 w-full border rounded px-2 py-1" /></label>
              <label className="block">Temp Password<input type="password" value={relTempPwd} onChange={e=>setRelTempPwd(e.target.value)} className="mt-0.5 w-full border rounded px-2 py-1" /></label>
              <div className="flex gap-2">
                <select value={relGender} onChange={e=>{ if(relGenderLocked) return; setRelGender(e.target.value);} } className={`border rounded px-2 py-1 w-full ${relGenderLocked?'bg-gray-100 cursor-not-allowed':''}`} title="Gender sets mother/father or son/daughter semantics when using Parent/Child relation type (lock from quick-add)">
                  <option value="">Gender</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
                <input type="date" value={relBirth} onChange={e=>setRelBirth(e.target.value)} className="border rounded px-2 py-1 w-full" />
              </div>
              {relGender && <label className="flex items-center gap-1 text-[10px] text-gray-600"><input type="checkbox" checked={relGenderLocked} onChange={e=>setRelGenderLocked(e.target.checked)} /> Lock gender</label>}
              {(relTypeNew==='maternal_grandparents' || relTypeNew==='paternal_grandparents') && (
                <div className="border rounded p-2 bg-slate-50 space-y-1">
                  <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={relCreatePair} onChange={e=>setRelCreatePair(e.target.checked)} /> Create both grandparents (pair)</label>
                  {relCreatePair && (
                    <div className="space-y-1 text-[11px]">
                      <div className="font-medium">Partner</div>
                      <input placeholder="Partner Name" value={partnerName} onChange={e=>setPartnerName(e.target.value)} className="border rounded px-2 py-1 w-full" />
                      <input placeholder="Partner Email" value={partnerEmail} onChange={e=>setPartnerEmail(e.target.value)} className="border rounded px-2 py-1 w-full" />
                      <input placeholder="Partner Temp Password" type="password" value={partnerTempPwd} onChange={e=>setPartnerTempPwd(e.target.value)} className="border rounded px-2 py-1 w-full" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {relFriendly && <div className="text-amber-600 text-[11px]">{relFriendly}</div>}
          {relError && <div className="text-red-600 text-[11px]">{relError}</div>}
          <div className="flex items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={autoLayoutAfterAdd} onChange={e=>setAutoLayoutAfterAdd(e.target.checked)} /> Auto layout after create</label>
            <div className="flex gap-2">
            <button className="px-2 py-1 rounded border" onClick={()=>setShowRelAddNew(false)} disabled={relSaving}>Close</button>
            <button className="px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-50" disabled={relSaving} onClick={async ()=>{
              if(!relRefId){ setRelError('Reference required'); return; }
              if(!relName.trim()){ setRelError('Name required'); return; }
              if(!relTempPwd || relTempPwd.length<8){ setRelError('Temp password min 8 chars'); return; }
              setRelSaving(true); setRelError(null); setRelFriendly(null);
              try {
                const body:any = { referenceId: relRefId, relationType: relTypeNew, person:{ name: relName.trim(), email: relEmail.trim()||undefined, tempPassword: relTempPwd, gender: relGender||undefined, birthDate: relBirth||undefined } };
                if(relTypeNew==='maternal_grandparents' || relTypeNew==='paternal_grandparents'){
                  if(relCreatePair){ body.options={ createPair:true }; body.partner={ name: partnerName.trim(), email: partnerEmail.trim()||undefined, tempPassword: partnerTempPwd }; }
                  else body.options={ createPair:false };
                }
                if(relTypeNew==='aunt_uncle'){ if(auSide) body.options={ side: auSide }; }
                if(relTypeNew==='cousin'){ if(!cousinUncleAuntId){ setRelError('Select uncle/aunt id'); setRelSaving(false); return;} body.options={ uncleAuntId: cousinUncleAuntId }; }
                const idem = crypto.randomUUID();
                const resp = await api<{nodes:any[];edges:{type:string;sourceId:string;targetId:string}[]}>(`/relations/add`, { method:'POST', headers:{ 'Idempotency-Key': idem }, body: JSON.stringify(body) });
                // integrate new nodes
                setNodes(prev=>{
                  const existing = new Set(prev.map(n=>n.id));
                  const additions = resp.nodes.filter(n=>!existing.has(n.id)).map(n=>({ id:n.id, type:'personNode', data:{ name:n.name, email:n.email, gender:n.gender, birthDate:n.birthDate }, position:{ x: (Math.random()*200)|0, y:(Math.random()*200)|0 } }));
                  return additions.length? [...prev, ...additions]: prev;
                });
                setEdges(prev=>{
                  const existingKeys = new Set(prev.map(e=> e.source+'>'+e.target+'>'+e.label));
                  const mapped = resp.edges.map(e=>{
                    const label = e.type==='PARENT_OF' ? 'PARENT' : (e.type==='SPOUSE_OF' ? 'SPOUSE' : e.type);
                    return { id: e.sourceId+'-'+e.targetId+'-'+label, source: e.sourceId, target: e.targetId, label, data:{ type: label } } as Edge;
                  }).filter(e=> !existingKeys.has(e.source+'>'+e.target+'>'+e.label));
                  return mapped.length? [...prev, ...mapped]: prev;
                });
                setRelName(''); setRelEmail(''); setRelGender(''); setRelBirth(''); setRelTempPwd(''); setRelCreatePair(false); setPartnerName(''); setPartnerEmail(''); setPartnerTempPwd(''); setCousinUncleAuntId(''); toast.success('Relative added');
                if(autoLayoutAfterAdd) { try { autoLayout(); } catch {} }
                // Quick-add lock reset
                setRelGenderLocked(false);
              } catch(e:any){
                const code = e?.code || e?.raw?.code;
                if(code) setRelFriendly(mapRelationError(code));
                setRelError(e?.message || 'Failed');
              } finally { setRelSaving(false); }
            }}>{relSaving?'Saving...':'Create'}</button>
            </div>
          </div>
        </div>
      )}
      <section className="flex-1 relative" ref={canvasRef}>
  {/* Suggestions (computed via transformer for legacy parity) */}
  <LegacySuggestions nodes={nodes} edges={edges} onApply={(s)=>{ setRelRefId(s.referencePersonId); setRelTypeNew(s.recommendedRelationType); if('createPair' in s) setRelCreatePair(!!(s as any).createPair); if(s.recommendedRelationType==='cousin' && (s as any).uncleAuntId){ setCousinUncleAuntId((s as any).uncleAuntId);} setShowRelAddNew(true); }} />
        <div className="absolute z-10 top-2 right-2 flex gap-2 items-center">
          {/* retained empty overlay spot (previous floating controls replaced by toolbar) */}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges.map((e) => {
            const type = e.data?.type ?? e.label;
            const base = { ...e, label: type } as any;
            // Uniform blue color; arrow for directional parent-like edges
            if (type === 'PARENT' || type === 'SON' || type === 'DAUGHTER') {
              return { ...base, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#2563eb' } };
            }
            return { ...base, style: { stroke: '#2563eb' } };
          })}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onSelectionChange={(sel) => { setSelectedNodeId(sel.nodes?.[0]?.id ?? null); setSelectedEdgeId(sel.edges?.[0]?.id ?? null); }}
          onInit={(inst) => setRfInstance(inst)}
          onMove={(_, viewport) => { setTransformState({ x: viewport.x, y: viewport.y, zoom: viewport.zoom }); }}
          snapToGrid={snap}
          fitView
          nodeTypes={{ personNode: PersonNode }}
        >
          <Background />
          <Controls />
        </ReactFlow>
        {selectedNode && (
          (() => {
            const { x, y, zoom } = transformState;
            const sx = selectedNode.position.x * zoom + x;
            const sy = selectedNode.position.y * zoom + y - 40; // offset above node
            return (
              <div className="absolute bg-white/90 backdrop-blur border rounded shadow px-2 py-1 text-[11px] flex gap-1 items-center" style={{ transform: `translate(${sx}px, ${sy}px)` }}>
                <span className="text-gray-500">X</span>
                <input type="number" className="border rounded px-1 w-16" value={selectedNode.position.x} onChange={(e)=>updateSelectedPosition(Number(e.target.value), selectedNode.position.y)} />
                <span className="text-gray-500">Y</span>
                <input type="number" className="border rounded px-1 w-16" value={selectedNode.position.y} onChange={(e)=>updateSelectedPosition(selectedNode.position.x, Number(e.target.value))} />
              </div>
            );
          })()
        )}
      </section>
    </main>
  );
}

function PersonNode({ data }: any) {
  const gender = data?.gender;
  let symbol: string = '';
  if (gender === 'MALE') symbol = 'M';
  else if (gender === 'FEMALE') symbol = 'F';
  else if (gender) symbol = '•';
  return (
    <div className="px-3 py-2 rounded-xl border border-slate-300 bg-white shadow-sm min-w-[140px] max-w-[180px] relative flex items-center gap-2">
      {/* Handles to allow manual edge creation */}
      <Handle type="target" position={Position.Left} className="!w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate" title={data?.name || 'Unnamed'}>{data?.name || 'Unnamed'}</div>
      </div>
      {symbol && (
        <span className={"shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold border " + (symbol==='M' ? 'bg-blue-100 text-blue-700 border-blue-200' : symbol==='F' ? 'bg-pink-100 text-pink-700 border-pink-200' : 'bg-slate-100 text-slate-600 border-slate-200')} title={gender} aria-label={gender}>
          {symbol}
        </span>
      )}
    </div>
  );
}

// Lightweight suggestions component for legacy tree using generation transformer
function LegacySuggestions({ nodes, edges, onApply }: { nodes:any[]; edges:any[]; onApply:(s:any)=>void }){
  const suggestions = useMemo(()=>{
    const people: GenPerson[] = nodes.map(n=>({ id:n.id, name:(n.data as any)?.name||'Unknown', email:(n.data as any)?.email||null, gender:(n.data as any)?.gender||null, birthDate:(n.data as any)?.birthDate||null }));
    const seenSpouse=new Set<string>();
    const relEdges: GenEdge[] = edges.flatMap(e=>{ const type=e.data?.type||e.label; if(type==='PARENT') return [{ type:'PARENT_OF', sourceId:e.source, targetId:e.target } as any]; if(type==='SON'||type==='DAUGHTER') return [{ type:'PARENT_OF', sourceId:e.source, targetId:e.target } as any]; if(type==='SPOUSE'){ const k=e.source<e.target?e.source+'::'+e.target:e.target+'::'+e.source; if(seenSpouse.has(k)) return []; seenSpouse.add(k); return [{ type:'SPOUSE_OF', sourceId:e.source, targetId:e.target } as any]; } return []; });
    try { return genTransform(people, relEdges).suggestions.slice(0,6); } catch { return []; }
  },[nodes,edges]);
  if(!suggestions.length) return null;
  return (
    <div className="absolute left-2 bottom-2 bg-white/90 backdrop-blur border rounded shadow p-2 text-[10px] max-w-[320px] z-20">
      <div className="font-semibold mb-1 text-[11px]">Suggestions</div>
      <ul className="space-y-1">
        {suggestions.map(s=> <li key={s.kind+':'+s.referencePersonId} className="flex items-start gap-1"><span className="flex-1">{s.reason}</span><button className="px-1 py-0.5 bg-indigo-600 text-white rounded" onClick={()=>onApply(s)}>Add</button></li>)}
      </ul>
    </div>
  );
}
