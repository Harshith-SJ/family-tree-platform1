"use client";
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { toast } from '@/lib/toast';

type Message = { id: string; text: string; userId: string; userName: string; createdAt: string };

export default function FamilyChatPage() {
  const params = useParams<{ id: string }>();
  const familyId = params.id;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      try { await api('/auth/me'); } catch { window.location.href = '/login'; return; }
      if (!familyId) { window.location.href = '/families'; return; }
      try {
        const res = await api<{ messages: Message[] }>(`/families/${familyId}/messages`);
        setMessages(res.messages);
      } catch { toast.error('Failed to load messages'); }
      const s = getSocket();
      s.emit('join-family', familyId);
      const onMsg = (m: Message) => setMessages((prev) => [...prev, m]);
      s.on('chat:message', onMsg);
      return () => { s.off('chat:message', onMsg); };
    })();
  }, [familyId]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  async function send() {
    if (!familyId || !input.trim()) return;
    try {
      await api(`/families/${familyId}/messages`, { method: 'POST', body: JSON.stringify({ text: input.trim() }) });
      setInput('');
    } catch { toast.error('Failed to send'); }
  }

  return (
    <main className="p-4 max-w-3xl mx-auto h-[calc(100dvh-4rem)] grid grid-rows-[1fr_auto]">
      <div ref={listRef} className="overflow-y-auto bg-white border rounded p-3 space-y-2">
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2 items-baseline">
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 border">{m.userName}</span>
            <span className="text-sm">{m.text}</span>
            <span className="ml-auto text-[10px] text-gray-500">{new Date(m.createdAt).toLocaleTimeString()}</span>
          </div>
        ))}
        {messages.length === 0 && <div className="text-sm text-gray-500">No messages yet.</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="flex-1 border rounded px-3 py-2" placeholder="Type a message" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
        <button className="px-4 py-2 rounded bg-black text-white" onClick={send}>Send</button>
      </div>
    </main>
  );
}
