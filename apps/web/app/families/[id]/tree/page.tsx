"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ReactFlow, type Edge, type Node, Background, Controls, MarkerType, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as htmlToImage from 'html-to-image';
import { api } from '@/lib/api';
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
  // Require explicit selection; empty means not chosen yet
  const [edgeType, setEdgeType] = useState<EdgeType | ''>('');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const [snap, setSnap] = useState<boolean>(false);

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
    return () => { s.off('node:upsert', upsert); s.off('node:move', move); s.off('edge:created', edgeCreated); };
  }, [familyId]);

  const onNodesChange = (changes: any) => {
    setNodes((nds) => nds.map((n) => {
      const change = changes.find((c: any) => c.id === n.id && c.type === 'position');
      if (change) return { ...n, position: change.position };
      return n;
    }));
  };

  const onNodeDragStop = async (_: any, node: Node) => {
    if (!familyId) return;
    try {
      await api(`/families/${familyId}/nodes/${node.id}/position`, { method: 'PATCH', body: JSON.stringify({ posX: node.position.x, posY: node.position.y }) });
    } catch { toast.error('Failed to save position'); }
  };

  const onConnect = async (params: any) => {
    if (!familyId) return;
    if (!edgeType) {
      toast.error('Select relationship type first');
      return;
    }
    if (params.source === params.target) {
      toast.error('Cannot link a node to itself');
      return;
    }
    // prevent duplicate spouse edges (either direction)
    if (edgeType === 'SPOUSE') {
      const exists = edges.some((e) => (e.source === params.source && e.target === params.target) || (e.source === params.target && e.target === params.source));
      if (exists) { toast.error('Spouse relationship already exists'); return; }
    }
    // prevent duplicate parent-like edges
    if (edgeType === 'PARENT' || edgeType === 'SON' || edgeType === 'DAUGHTER') {
      const exists = edges.some((e) => e.source === params.source && e.target === params.target);
      if (exists) { toast.error('Relationship already exists'); return; }
    }
    try {
      await api(`/families/${familyId}/edges`, { method: 'POST', body: JSON.stringify({ sourceId: params.source, targetId: params.target, type: edgeType }) });
    } catch { toast.error('Failed to create relationship'); }
  };

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

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
    // Auto-link: from selected node if present, otherwise from current user
    if (!edgeType) {
      // already validated, but keep guard
    } else if (selectedNodeId) {
      try { await api(`/families/${familyId}/edges`, { method: 'POST', body: JSON.stringify({ sourceId: selectedNodeId, targetId: node.id, type: edgeType }) }); } catch {}
    } else if (currentUserId) {
      try { await api(`/families/${familyId}/edges`, { method: 'POST', body: JSON.stringify({ sourceId: currentUserId, targetId: node.id, type: edgeType }) }); } catch {}
    }
    toast.success('Person added');
  }

  async function updateSelectedPosition(x: number, y: number) {
    if (!familyId || !selectedNode) return;
    setNodes((prev) => prev.map((n) => (n.id === selectedNode.id ? { ...n, position: { x, y } } : n)));
    await api(`/families/${familyId}/nodes/${selectedNode.id}/position`, { method: 'PATCH', body: JSON.stringify({ posX: x, posY: y }) });
  }

  return (
    // Fit within viewport beneath the top nav; remove extra vertical margins to prevent scrolling
    <main className="h-[calc(100dvh-96px)] mx-4 my-0 border rounded overflow-hidden grid grid-cols-[320px_1fr]">
      <aside className="p-3 border-r space-y-4 bg-white overflow-y-auto">
        <div>
          <h2 className="text-sm text-gray-600 mb-1">Family</h2>
          <div className="text-base font-semibold truncate" title={familyName || 'Family'}>{familyName || 'Family'}</div>
          {families.length > 0 && (
            <div className="mt-2">
              <select
                className="border rounded px-2 py-1 w-full"
                value={familyId ?? ''}
                onChange={async (e) => { const id = e.target.value; window.location.href = `/families/${id}/tree`; }}
              >
                {families.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            </div>
          )}
        </div>

        {/* Relationship type controls used both for manual connections and auto-link on add */}
        <div>
          <h2 className="font-semibold mb-2">Relationship Type</h2>
          <div className="space-y-2">
            <select className="border rounded px-2 py-1 w-full" value={edgeType} onChange={(e) => { setEdgeType((e.target.value || '') as any); }}>
              <option value="" disabled>Select relationship…</option>
              <option value="PARENT">PARENT</option>
              <option value="SPOUSE">SPOUSE</option>
              <option value="SON">SON</option>
              <option value="DAUGHTER">DAUGHTER</option>
            </select>
            <p className="text-xs text-gray-500">This type will be used for manual edge creation and to auto-link when adding a new person.</p>
          </div>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Add Person</h2>
          <div className="space-y-2">
            <div className="space-y-2">
              <input id="person-name" placeholder="Name" className="border rounded px-2 py-1 w-full" required />
              <input id="person-email" placeholder="Email" type="email" className="border rounded px-2 py-1 w-full" required />
            </div>
            <div className="space-y-2">
              <select id="person-gender" className="border rounded px-2 py-1 w-full">
                <option value="">Gender</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
              <input id="person-birth" type="date" placeholder="Birth date" className="border rounded px-2 py-1 w-full" />
            </div>
            <input id="person-temp-password" type="password" placeholder="Temporary password (min 8 chars)" minLength={8} className="border rounded px-2 py-1 w-full" required />
            <div className="flex gap-2 justify-end">
              <button className="bg-gray-800 text-white px-3 py-1 rounded" onClick={() => {
                const name = (document.getElementById('person-name') as HTMLInputElement).value?.trim();
                const email = (document.getElementById('person-email') as HTMLInputElement).value?.trim();
                const gender = (document.getElementById('person-gender') as HTMLSelectElement).value || undefined;
                const birthDate = (document.getElementById('person-birth') as HTMLInputElement).value || undefined;
                const tempPassword = (document.getElementById('person-temp-password') as HTMLInputElement).value || undefined;
                if (!name) { toast.error('Name is required'); return; }
                if (!edgeType) { toast.error('Select relationship type'); return; }
                upsertNode(name, email || '', gender, birthDate, tempPassword);
                (document.getElementById('person-name') as HTMLInputElement).value = '';
                (document.getElementById('person-email') as HTMLInputElement).value = '';
                (document.getElementById('person-gender') as HTMLSelectElement).value = '';
                (document.getElementById('person-birth') as HTMLInputElement).value = '';
                (document.getElementById('person-temp-password') as HTMLInputElement).value = '';
              }}>Add</button>
            </div>
            <p className="text-[11px] text-gray-500">Tip: Select a person in the canvas to link from. If none is selected, we’ll link from you.</p>
          </div>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Manual Edge</h2>
          <p className="text-xs text-gray-500">Pick a type above, then drag between node handles to create the relationship.</p>
        </div>

        {selectedNode && (
          <div>
            <h2 className="font-semibold mb-2">Selected Node Position</h2>
            <div className="flex gap-2 items-center">
              <label className="text-sm">X</label>
              <input type="number" className="border rounded px-2 py-1 w-24" value={selectedNode.position.x}
                onChange={(e) => updateSelectedPosition(Number(e.target.value), selectedNode.position.y)} />
              <label className="text-sm">Y</label>
              <input type="number" className="border rounded px-2 py-1 w-24" value={selectedNode.position.y}
                onChange={(e) => updateSelectedPosition(selectedNode.position.x, Number(e.target.value))} />
            </div>
          </div>
        )}
      </aside>

  <section className="h-full w-full relative" ref={canvasRef}>
        <div className="absolute z-10 top-2 right-2 flex gap-2 items-center">
          <label className="text-xs flex items-center gap-1 bg-white/70 border rounded px-2 py-1">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            <span>Snap to grid</span>
          </label>
          <button
            className="bg-white/80 backdrop-blur border rounded px-2 py-1 text-sm"
            onClick={() => { try { rfInstance?.fitView?.({ padding: 0.2 }); } catch {} }}
          >Fit view</button>
          <button
            className="bg-white/80 backdrop-blur border rounded px-2 py-1 text-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                toast.success('Link copied');
              } catch {}
            }}
          >Copy link</button>
          {selectedNode && (
            <button
              className="bg-white/80 backdrop-blur border rounded px-2 py-1 text-sm"
              onClick={async () => {
                if (!familyId || !selectedNode) return;
                try { await api(`/families/${familyId}/nodes/${selectedNode.id}`, { method: 'DELETE' }); toast.success('Person removed'); }
                catch { toast.error('Delete failed'); }
                setNodes((prev) => prev.filter((n) => n.id !== selectedNode.id));
                setSelectedNodeId(null);
              }}
            >Delete node</button>
          )}
          {selectedEdgeId && (
            <button
              className="bg-white/80 backdrop-blur border rounded px-2 py-1 text-sm"
              onClick={async () => {
                if (!familyId || !selectedEdgeId) return;
                try { await api(`/families/${familyId}/edges/${selectedEdgeId}`, { method: 'DELETE' }); toast.success('Relationship removed'); }
                catch { toast.error('Delete failed'); }
                setEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId));
                setSelectedEdgeId(null);
              }}
            >Delete edge</button>
          )}
          <button
            className="bg-white/80 backdrop-blur border rounded px-2 py-1 text-sm"
          onClick={async () => {
            const el = canvasRef.current as HTMLDivElement | null;
            if (!el) return;
            try {
              const dataUrl = await htmlToImage.toPng(el, { pixelRatio: 2 });
              const a = document.createElement('a');
              a.href = dataUrl;
              a.download = `family-tree-${familyId || 'export'}.png`;
              a.click();
            } catch (e) { toast.error('Export failed'); }
          }}
          >Export PNG</button>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges.map((e) => {
            const type = e.data?.type ?? e.label;
            const parentLike = type === 'PARENT' || type === 'SON' || type === 'DAUGHTER';
            if (parentLike) {
              return { ...e, animated: false, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: type === 'PARENT' ? '#2563eb' : '#16a34a' } };
            }
            if (type === 'SPOUSE') {
              return { ...e, style: { stroke: '#2563eb' } };
            }
            return e;
          })}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onSelectionChange={(sel) => { setSelectedNodeId(sel.nodes?.[0]?.id ?? null); setSelectedEdgeId(sel.edges?.[0]?.id ?? null); }}
          onInit={(inst) => setRfInstance(inst)}
          snapToGrid={snap}
          fitView
          nodeTypes={{ personNode: PersonNode }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </section>
    </main>
  );
}

        function PersonNode({ data }: any) {
  const info: string[] = [];
  if (data?.gender) info.push(String(data.gender));
  if (data?.birthDate || data?.deathDate) info.push(`${data.birthDate ?? '?'} - ${data.deathDate ?? ''}`.trim());
  return (
            <div className="px-3 py-2 rounded border bg-white shadow-sm min-w-40 max-w-64 relative">
              {/* Handles to allow manual edge creation */}
              <Handle type="target" position={Position.Left} className="!w-2 !h-2" />
              <Handle type="source" position={Position.Right} className="!w-2 !h-2" />
      <div className="font-medium text-sm truncate" title={data?.name || 'Unnamed'}>{data?.name || 'Unnamed'}</div>
      {data?.email && <div className="text-xs text-gray-500 truncate" title={data.email}>{data.email}</div>}
      {info.length > 0 && <div className="text-[10px] text-gray-600">{info.join(' • ')}</div>}
    </div>
  );
}
