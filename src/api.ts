async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  async get<T = unknown>(url: string) {
    return { data: await request<T>(url) };
  },
  async post<T = unknown>(url: string, data?: unknown) {
    return { data: await request<T>(url, { method: 'POST', body: JSON.stringify(data ?? {}) }) };
  },
};
