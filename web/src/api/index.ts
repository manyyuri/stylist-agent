/** 统一 REST 封装：JSON、错误冒泡、类型安全 */
const BASE = '';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

/** multipart 上传 */
export async function upload<T>(path: string, files: File[], field = 'photo'): Promise<T> {
  const fd = new FormData();
  if (files.length === 1) fd.append(field, files[0]!);
  else files.forEach((f) => fd.append(field === 'photo' ? 'photos' : field, f));
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: fd });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
