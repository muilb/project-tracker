import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setUnauthorizedHandler, useApi } from '../../src/api';
import { auth } from '../../src/auth';
import { loadConfig } from '../../src/config';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url, ...init, headers: init.headers as Record<string, string> };
};

beforeAll(async () => {
  await loadConfig(); // dev: apiUrl '/api', x-dev-user auth
});

beforeEach(async () => {
  fetchMock = vi.fn(async () => json(200, { ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  await auth.signIn(' An@Example.com ', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setUnauthorizedHandler(() => {});
});

describe('api', () => {
  it('sends the language and the login; JSON bodies with a content type', async () => {
    expect(await api.post('/projects/P01/updates', { summary: 'x' })).toEqual({ ok: true });
    expect(lastCall()).toMatchObject({
      url: '/api/projects/P01/updates',
      method: 'POST',
      body: '{"summary":"x"}',
      headers: { 'accept-language': 'vi', 'x-dev-user': 'an@example.com', 'content-type': 'application/json' },
    });
    await api.get('/me');
    expect(lastCall().headers).not.toHaveProperty('content-type');
  });

  it('the public page is fetched without the login', async () => {
    await api.getPublic('/public');
    expect(lastCall().headers).toEqual({ 'accept-language': 'vi' });
  });

  it('errors carry the status and the API message', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: 'Không tìm thấy dự án' }));
    const e = await api.get('/projects/X').catch((err) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 404, message: 'Không tìm thấy dự án' });

    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.get('/me')).rejects.toMatchObject({ status: 502, message: 'Lỗi 502' });
  });

  it('401 signs out and sends the user to the login page', async () => {
    const toLogin = vi.fn();
    setUnauthorizedHandler(toLogin);
    fetchMock.mockResolvedValueOnce(json(401, { error: 'Chưa đăng nhập' }));
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(auth.isSignedIn()).toBe(false);
    expect(toLogin).toHaveBeenCalledOnce();
  });

  it('a 401 from the public page does not sign out', async () => {
    const toLogin = vi.fn();
    setUnauthorizedHandler(toLogin);
    fetchMock.mockResolvedValueOnce(json(401, {}));
    await expect(api.getPublic('/public')).rejects.toMatchObject({ status: 401 });
    expect(auth.isSignedIn()).toBe(true);
    expect(toLogin).not.toHaveBeenCalled();
  });

  it('download saves the file under the given name, with the login', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([0x50, 0x4b]), { headers: { 'content-type': 'application/x-test' } }));
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), 'blob:test'));
    URL.revokeObjectURL = vi.fn();
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    await api.download('/export', 'report.xlsx');
    expect(lastCall().headers['x-dev-user']).toBe('an@example.com');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ download: 'report.xlsx', href: 'blob:test' });
    expect(clicks[0].isConnected).toBe(false); // removed again
    expect(blobs[0].type).toBe('application/x-test');
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b]));
  });

  it('download errors are thrown, not saved', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'Không có quyền' }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await expect(api.download('/export', 'x.xlsx')).rejects.toMatchObject({ status: 403, message: 'Không có quyền' });
    expect(click).not.toHaveBeenCalled();
  });
});

describe('useApi', () => {
  it('loads, reloads, and follows the path', async () => {
    let n = 0;
    const fetcher = vi.fn(async (p: string) => `${p}#${++n}`);
    const { result, rerender } = renderHook(({ path }) => useApi(path, fetcher), { initialProps: { path: '/a' as string | null } });
    await waitFor(() => expect(result.current.data).toBe('/a#1'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe('/a#2'));
    rerender({ path: '/b' });
    await waitFor(() => expect(result.current.data).toBe('/b#3'));
    rerender({ path: null });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps the error message, and clears it once a load succeeds', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useApi('/x', fetcher));
    await waitFor(() => expect(result.current.error).toBe('Mất kết nối'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current).toMatchObject({ data: 'ok', error: undefined, loading: false }));
  });

  it('ignores an answer for a path it has moved away from', async () => {
    let release!: (v: string) => void;
    const fetcher = vi.fn((p: string) => (p === '/slow' ? new Promise<string>((r) => (release = r)) : Promise.resolve('fast')));
    const { result, rerender } = renderHook(({ path }) => useApi(path, fetcher), { initialProps: { path: '/slow' } });
    rerender({ path: '/fast' });
    await waitFor(() => expect(result.current.data).toBe('fast'));
    await act(async () => release('slow'));
    expect(result.current.data).toBe('fast');
  });
});
