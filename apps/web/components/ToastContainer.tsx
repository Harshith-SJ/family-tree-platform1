"use client";
import { useToastStore } from "@/lib/toast";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {toasts.map((t) => (
        <div key={t.id} className={`min-w-64 max-w-sm px-3 py-2 rounded shadow text-white ${
          t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : 'bg-gray-800'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">{t.message}</span>
            <button className="text-xs/none opacity-80 hover:opacity-100" onClick={() => remove(t.id)}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
