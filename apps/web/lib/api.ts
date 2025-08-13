const defaultApi = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:4001`
  : 'http://localhost:4001';
export const API_URL = process.env.NEXT_PUBLIC_API_URL || defaultApi;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init && 'body' in (init as any) && (init as any).body != null;
  const headers = hasBody
    ? { 'Content-Type': 'application/json', ...(init?.headers || {}) }
    : { ...(init?.headers || {}) };
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers,
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
