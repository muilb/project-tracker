// Excel export: a valid .xlsx with what the caller may see, in their language.
import { crc32, inflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { buildXlsx, columnName, XLSX_TYPE } from '../src/export/xlsx.js';
import { loadSample, SAMPLE_NOW_VN } from '../src/seed/sample.js';
import { MemoryStore } from '../src/store/memory.js';
import { vnToIso } from '../src/time.js';
import { visibleProjects } from '../src/views.js';

const now = new Date(vnToIso(SAMPLE_NOW_VN));
let store: MemoryStore;
const call = (method: string, path: string, as: string, body?: unknown, lang = 'vi') =>
  createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send: async () => {} }).request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-dev-user': `${as}@example.com`, 'accept-language': lang },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** The files of a zip (local headers only, as buildXlsx writes them), checking each CRC. */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const crc = buf.readUInt32LE(at + 14);
    const [packed, size, nameLen] = [buf.readUInt32LE(at + 18), buf.readUInt32LE(at + 22), buf.readUInt16LE(at + 26)];
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const data = inflateRawSync(buf.subarray(at + 30 + nameLen, at + 30 + nameLen + packed));
    expect(data.length).toBe(size);
    expect(crc32(data)).toBe(crc);
    files.set(name, data.toString('utf8'));
    at += 30 + nameLen + packed;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50); // end of central directory
  return files;
}

/** Text of every cell of one worksheet, row by row. */
const cells = (xml: string) =>
  [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map((r) =>
    [...r[1].matchAll(/<(?:t xml:space="preserve"|v)>(.*?)<\/(?:t|v)>/g)].map((m) => m[1]),
  );

async function download(as: string, lang = 'vi') {
  const res = await call('GET', '/export', as, undefined, lang);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe(XLSX_TYPE);
  return unzip(Buffer.from(await res.arrayBuffer()));
}

beforeEach(async () => {
  store = new MemoryStore();
  await loadSample(store, now);
});

describe('xlsx writer', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('keeps text as text (no formulas), escapes XML and drops characters XML cannot hold', () => {
    const files = unzip(buildXlsx([{ name: 'A/B:C', columns: ['x', 'y'], rows: [['=1+1', 'a < b & "c"\u0007'], [3, null]] }]));
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).not.toContain('<f>');
    expect(cells(sheet)).toEqual([['x', 'y'], ['=1+1', 'a &lt; b &amp; &quot;c&quot;'], ['3']]);
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="A B C"');
  });
});

describe('GET /export', () => {
  it('has the projects, items and recent updates, with names instead of emails', async () => {
    const files = await download('lan'); // PMO: everything
    expect([...files.keys()].filter((f) => f.startsWith('xl/worksheets/'))).toHaveLength(3);
    const workbook = files.get('xl/workbook.xml')!;
    expect(workbook).toContain('name="Dự án"');
    const projects = cells(files.get('xl/worksheets/sheet1.xml')!);
    expect(projects[0][0]).toBe('Mã');
    const ids = projects.slice(1).map((r) => r[0]);
    expect(ids).toEqual(expect.arrayContaining(['P01', 'P07']));
    expect(projects.find((r) => r[0] === 'P01')).toEqual(expect.arrayContaining(['Hệ thống quản lý kho', 'KH A']));
    const items = files.get('xl/worksheets/sheet2.xml')!;
    expect(items).toContain('Giao hàng phase 1');
    expect(items).not.toContain('@example.com');
    expect(files.get('xl/worksheets/sheet3.xml')).toContain('Test tích hợp module nhập kho');
  });

  it('OTHER gets only the projects they take part in', async () => {
    const quang = (await store.getUser('quang@example.com'))!;
    const visible = visibleProjects(quang, await store.snapshot({ now })).map((p) => p.id).sort();
    const files = await download('quang');
    const ids = cells(files.get('xl/worksheets/sheet1.xml')!).slice(1).map((r) => r[0]).sort();
    expect(ids).toEqual(visible);
    const itemProjects = new Set(cells(files.get('xl/worksheets/sheet2.xml')!).slice(1).map((r) => r[0]));
    expect([...itemProjects].every((id) => visible.includes(id))).toBe(true);
  });

  it('leaves out deleted items and writes headers in Japanese for ja', async () => {
    const body = { type: 'issue', title: 'Họp nhầm', priority: 'low', date: '2026-10-20' };
    const { item } = await (await call('POST', '/projects/P01/items', 'an', body)).json();
    await call('DELETE', `/projects/P01/items/${item.id}`, 'an');
    const files = await download('lan', 'ja');
    expect(files.get('xl/worksheets/sheet2.xml')).not.toContain('Họp nhầm');
    expect(files.get('xl/workbook.xml')).toContain('name="プロジェクト"');
    expect(cells(files.get('xl/worksheets/sheet1.xml')!)[0][1]).toBe('プロジェクト名');
  });

  it('needs a login', async () => {
    const app = createApp({ store, auth: { mode: 'dev', adminEmails: [] }, clock: () => now, send: async () => {} });
    expect((await app.request('/export')).status).toBe(401);
  });
});
