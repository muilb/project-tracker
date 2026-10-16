import { useCallback, useEffect, useState } from 'react';
import { auth } from './auth';
import { getConfig } from './config';
import { l, lang } from './i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Called on 401 so the app can send the user back to the login page. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, authenticated = true): Promise<T> {
  const headers: Record<string, string> = { 'accept-language': lang, ...(authenticated ? await auth.headers() : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(getConfig().apiUrl.replace(/\/$/, '') + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && authenticated) {
    auth.signOut();
    onUnauthorized();
  }
  if (!res.ok) throw new ApiError(res.status, json.error ?? json.message ?? `${l('Lỗi', 'エラー')} ${res.status}`);
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  getPublic: <T>(path: string) => request<T>('GET', path, undefined, false),
};

/** Fetches `path` (null = skip) and re-fetches on `reload()` or when the path changes. */
export function useApi<T>(path: string | null, fetcher: (p: string) => Promise<T> = api.get) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    fetcher(path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(undefined);
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
