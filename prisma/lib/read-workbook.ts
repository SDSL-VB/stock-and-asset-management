/**
 * A minimal .xlsx reader. An xlsx is a zip of XML, and node ships zlib, so
 * reading one needs no dependency — which matters for a script that has to run
 * on whatever machine happens to have the file.
 *
 * Handles what a hand-typed BOM sheet actually contains: shared strings, inline
 * strings, numbers, and merged/blank cells. Not formulas, not dates.
 */
import { readFileSync } from "fs";
import { inflateRawSync } from "zlib";

type ZipEntry = { name: string; data: Buffer };

function readZip(path: string): Map<string, Buffer> {
  const buf = readFileSync(path);

  // Find the end-of-central-directory record, scanning back from the tail
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory record)");

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");

    // The local header repeats the name and extra fields, at its own lengths
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    entries.push({
      name,
      data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw),
    });

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return new Map(entries.map((e) => [e.name, e.data]));
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

/** All <t> runs in an element, concatenated — a styled cell splits into several */
function textOf(xml: string): string {
  const parts = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlText(m[1]));
  return parts.join("").trim();
}

/** "BC12" → { col: 54, row: 12 } */
function parseRef(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) };
}

export type Sheet = { name: string; rows: string[][] };

/** Every sheet in the workbook, as a grid of trimmed strings. */
export function readWorkbook(path: string): Sheet[] {
  const zip = readZip(path);

  const sharedXml = zip.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  // Sheet name → file, via the workbook and its relationships
  const workbookXml = zip.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relsXml = zip.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";

  const relTargets = new Map(
    [...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(
      (m) => [m[1], m[2].replace(/^\/?xl\//, "")]
    )
  );

  const sheets: Sheet[] = [];
  for (const m of workbookXml.matchAll(/<sheet[^>]*\/?>/g)) {
    const tag = m[0];
    const name = decodeXmlText(/name="([^"]*)"/.exec(tag)?.[1] ?? "Sheet");
    const rid = /r:id="([^"]*)"/.exec(tag)?.[1];
    const target = rid ? relTargets.get(rid) : undefined;
    const data = target ? zip.get(`xl/${target}`) : undefined;
    if (!data) continue;

    const sheetXml = data.toString("utf8");
    const rows: string[][] = [];

    for (const rowMatch of sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowIndex = Number(rowMatch[1]) - 1;
      const cells: string[] = [];

      for (const cellMatch of rowMatch[2].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1];
        const body = cellMatch[2];
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const { col } = parseRef(ref);

        let value = "";
        if (type === "s") {
          const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "-1");
          value = shared[idx] ?? "";
        } else if (type === "inlineStr") {
          value = textOf(body);
        } else {
          value = decodeXmlText(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "").trim();
        }

        cells[col] = value;
      }

      rows[rowIndex] = Array.from(cells, (c) => c ?? "");
    }

    sheets.push({
      name,
      rows: Array.from(rows, (r) => r ?? []),
    });
  }

  return sheets;
}
