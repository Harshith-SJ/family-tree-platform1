"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function FamiliesPage() {
  const [families, setFamilies] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await api('/auth/me');
      } catch {
        window.location.href = '/login';
        return;
      }
      try {
        const res = await api<{ families: Array<{ id: string; name: string }> }>(`/families`);
        setFamilies(res.families);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function openFamily(id: string) {
  window.location.href = `/families/${id}/tree`;
  }

  if (loading) return <main className="p-6">Loading...</main>;

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Your Family</h1>
      {families.length === 0 ? (
        <p className="text-gray-600">You don’t have a family yet. Create one from the Tree page after signing up.</p>
      ) : (
        <ul className="space-y-2">
          {families.slice(0, 1).map((f) => (
            <li key={f.id} className="flex items-center justify-between border rounded px-3 py-2 bg-white">
              <div>
                <div className="font-medium">{f.name}</div>
                <div className="text-xs text-gray-500">{f.id}</div>
              </div>
              <button className="px-3 py-1 border rounded" onClick={() => openFamily(f.id)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
