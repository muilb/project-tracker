// Minimal .xlsx writer: one worksheet per sheet, text as inline strings, bold frozen header row with
// filters. A workbook is a zip of XML parts; node:zlib provides deflate and CRC-32.
import { crc32, deflateRawSync } from 'node:zlib';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const OFFICE_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

export type Cell = string | number | undefined | null;

export interface Sheet {
  name: string;
  columns: string[];
  rows: Cell[][];
}

/** Excel limits: 31 characters per sheet name (some characters not allowed), 32767 per cell. */
const MAX_CELL = 32_767;
const sheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';

const escapeXml = (s: string) =>
  s
    // Characters XML 1.0 cannot hold at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A, B, …, Z, AA, AB, … */
export function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cell(value: Cell, ref: string, style: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : '';
  // Inline string: text starting with "=" stays text, never a formula.
  const text = escapeXml(value.length > MAX_CELL ? value.slice(0, MAX_CELL) : value);
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function worksheet(sheet: Sheet): string {
  const width = (i: number) => {
    const longest = sheet.rows.reduce((n, r) => Math.max(n, String(r[i] ?? '').length), sheet.columns[i].length);
    return Math.min(Math.max(longest + 2, 8), 60);
  };
  const cols = sheet.columns.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(i)}" customWidth="1"/>`).join('');
  const rows = [sheet.columns, ...sheet.rows]
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, `${columnName(c)}${r + 1}`, r === 0 ? 1 : 2)).join('')}</row>`)
    .join('');
  const range = `A1:${columnName(Math.max(sheet.columns.length - 1, 0))}${sheet.rows.length + 1}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${rows}</sheetData><autoFilter ref="${range}"/></worksheet>`
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  // 0 default, 1 header (bold), 2 body (top-aligned, so long text does not hide the row's other cells).
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** The workbook as .xlsx bytes. */
export function buildXlsx(sheets: Sheet[]): Buffer {
  const names = sheets.map((s) => escapeXml(sheetName(s.name)));
  const ns = 'http://schemas.openxmlformats.org';
  const rel = `${ns}/officeDocument/2006/relationships`;
  const parts: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/xl/workbook.xml" ContentType="${OFFICE_TYPE}.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="${OFFICE_TYPE}.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${OFFICE_TYPE}.worksheet+xml"/>`).join('') +
        '</Types>',
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>` +
        names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets><definedNames>' +
        sheets
          .map((s, i) => {
            const range = `'${names[i].replace(/'/g, "''")}'!$A$1:$${columnName(Math.max(s.columns.length - 1, 0))}$${s.rows.length + 1}`;
            return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${range}</definedName>`;
          })
          .join('') +
        '</definedNames></workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, worksheet(s)]),
  ];
  return zip(parts.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));
}

/** A zip archive (deflate, UTF-8 names, fixed 1980-01-01 timestamps). */
function zip(files: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 file name
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(0, 10); // time
    header.writeUInt16LE(0x21, 12); // date: 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(f.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(f.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    // extra, comment, disk, internal / external attributes: 0
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}
