const defaultApi = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:4001`
  : 'http://localhost:4001';
export const API_URL = process.env.NEXT_PUBLIC_API_URL || defaultApi;

export interface ApiError extends Error { code?: string; status?: number; raw?: any; }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let body = (init as any)?.body;
  const isPlainObject = body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof URLSearchParams);
  if(isPlainObject) body = JSON.stringify(body);
  const hasBody = body != null;
  const headers = hasBody ? { 'Content-Type': 'application/json', ...(init?.headers||{}) } : { ...(init?.headers||{}) };
  const res = await fetch(`${API_URL}${path}`, { credentials:'include', headers, ...init, body });
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if(!res.ok){
    const err: ApiError = new Error(json?.message || res.statusText);
    err.code = json?.code; err.status = res.status; err.raw = json; throw err;
  }
  return (json as T);
}

function safeJson(t:string){ try { return JSON.parse(t); } catch { return null; } }
