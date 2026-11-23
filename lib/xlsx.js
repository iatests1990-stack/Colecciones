// lib/xlsx.js
// Escritor XLSX mínimo y sin dependencias: ZIP "store" (sin compresión)
// construido a mano con CRC32 propio y XML OOXML auto-contenido.
// No usa chrome, DOM ni librerías externas: funciona en Node y en MV3.

// -- CRC32 (IEEE 802.3, check vector 0xCBF43926 para "123456789") ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  const data = toBytes(bytes);
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// -- Escritor de bytes little-endian --------------------------------------

class ByteWriter {
  constructor() {
    this.parts = [];
  }
  u8(value) {
    this.parts.push(value & 0xff);
  }
  u16(value) {
    this.u8(value);
    this.u8(value >>> 8);
  }
  u32(value) {
    this.u8(value);
    this.u8(value >>> 8);
    this.u8(value >>> 16);
    this.u8(value >>> 24);
  }
  bytes(array) {
    for (const byte of array) this.parts.push(byte & 0xff);
  }
  get length() {
    return this.parts.length;
  }
  result() {
    return Uint8Array.from(this.parts);
  }
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array(data || []);
}

function normalizeFiles(files) {
  if (Array.isArray(files)) {
    return files
      .filter(Boolean)
      .map((file) => ({ name: String(file.name), data: toBytes(file.data) }));
  }
  if (files && typeof files === "object") {
    return Object.keys(files).map((name) => ({ name, data: toBytes(files[name]) }));
  }
  return [];
}

// -- ZIP store (sin compresión) -------------------------------------------

// `files` es una lista de {name, data} (o un mapa nombre -> data).
// Devuelve un Uint8Array con un ZIP válido: local headers, central directory
// y end of central directory (EOCD), todos sin compresión (method 0).
export function zipFiles(files) {
  const entries = normalizeFiles(files);
  const writer = new ByteWriter();
  const central = [];
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = 0x0021; // 1980-01-01

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const offset = writer.length;

    // Local file header
    writer.u32(0x04034b50); // PK\x03\x04
    writer.u16(20); // versión necesaria
    writer.u16(0); // flags
    writer.u16(0); // método: store
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(crc);
    writer.u32(data.length); // tamaño comprimido
    writer.u32(data.length); // tamaño sin comprimir
    writer.u16(name.length);
    writer.u16(0); // extra
    writer.bytes(name);
    writer.bytes(data);

    central.push({ name, crc, size: data.length, offset });
  }

  const cdOffset = writer.length;
  for (const entry of central) {
    writer.u32(0x02014b50); // PK\x01\x02
    writer.u16(20); // versión de creación
    writer.u16(20); // versión necesaria
    writer.u16(0); // flags
    writer.u16(0); // método: store
    writer.u16(DOS_TIME);
    writer.u16(DOS_DATE);
    writer.u32(entry.crc);
    writer.u32(entry.size);
    writer.u32(entry.size);
    writer.u16(entry.name.length);
    writer.u16(0); // extra
    writer.u16(0); // comentario de archivo
    writer.u16(0); // disco de inicio
    writer.u16(0); // atributos internos
    writer.u32(0); // atributos externos
    writer.u32(entry.offset);
    writer.bytes(entry.name);
  }
  const cdSize = writer.length - cdOffset;

  // End of central directory (22 bytes, sin comentario)
  writer.u32(0x06054b50); // PK\x05\x06
  writer.u16(0); // disco actual
  writer.u16(0); // disco del central directory
  writer.u16(central.length); // entradas en este disco
  writer.u16(central.length); // entradas totales
  writer.u32(cdSize);
  writer.u32(cdOffset);
  writer.u16(0); // longitud del comentario

  return writer.result();
}

// -- OOXML ----------------------------------------------------------------

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const INVALID_SHEET_CHARS = new Set(["\\", "/", "*", "?", ":", "[", "]"]);

function safeSheetName(name, index) {
  let result = "";
  for (const ch of String(name ?? "")) {
    result += INVALID_SHEET_CHARS.has(ch) ? "_" : ch;
  }
  return result.trim().slice(0, 31) || `Sheet${index + 1}`;
}

function xmlRow(rowNumber, values) {
  const cells = values.map((value, colIndex) => {
    const ref = `${String.fromCharCode(65 + colIndex)}${rowNumber}`;
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  });
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

function sheetFromCollection(col, index, name) {
  const rows = [xmlRow(1, ["Title", "URL"])];
  const hyperlinks = [];
  let rowNumber = 2;

  const items = Array.isArray(col.items) ? col.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (String(item.type || "page").toLowerCase() === "note") continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) continue;
    rows.push(xmlRow(rowNumber, [item.title ?? "", url]));
    hyperlinks.push({ ref: `B${rowNumber}`, url });
    rowNumber += 1;
  }

  let hyperlinksXml = "";
  if (hyperlinks.length) {
    const links = hyperlinks
      .map(
        (link, i) =>
          `<hyperlink ref="${link.ref}" r:id="rId${i + 1}" tooltip="${escapeXml(link.url)}"/>`
      )
      .join("");
    hyperlinksXml = `<hyperlinks>${links}</hyperlinks>`;
  }

  const xml =
    `${XML_DECL}\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${DOC_REL}">` +
    `<sheetData>${rows.join("")}</sheetData>${hyperlinksXml}</worksheet>`;

  return { name, xml, hyperlinks };
}

// Construye un libro con una hoja por colección. Cada hoja contiene una
// columna de título y una de URL con hipervínculos externos. Sin dependencias.
export function buildXlsx(collections) {
  const cols = Array.isArray(collections)
    ? collections.filter((col) => col && typeof col === "object")
    : [];
  const used = new Set();
  const sheets = (cols.length ? cols : [{}]).map((col, index) => {
    const base = safeSheetName(col.name, index);
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      name = `${base.slice(0, 28)}_${suffix}`;
      suffix += 1;
    }
    used.add(name.toLowerCase());
    return sheetFromCollection(col, index, name);
  });

  const files = [];

  let contentTypes =
    `${XML_DECL}\n` +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  for (let i = 0; i < sheets.length; i += 1) {
    contentTypes +=
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  contentTypes += "</Types>";
  files.push({ name: "[Content_Types].xml", data: contentTypes });

  files.push({
    name: "_rels/.rels",
    data:
      `${XML_DECL}\n` +
      `<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="xl/workbook.xml"/>` +
      "</Relationships>",
  });

  let workbook =
    `${XML_DECL}\n` +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    `xmlns:r="${DOC_REL}"><sheets>`;
  sheets.forEach((sheet, i) => {
    workbook += `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
  });
  workbook += "</sheets></workbook>";
  files.push({ name: "xl/workbook.xml", data: workbook });

  let workbookRels = `${XML_DECL}\n<Relationships xmlns="${REL_NS}">`;
  sheets.forEach((_, i) => {
    workbookRels +=
      `<Relationship Id="rId${i + 1}" Type="${DOC_REL}/worksheet" ` +
      `Target="worksheets/sheet${i + 1}.xml"/>`;
  });
  workbookRels += "</Relationships>";
  files.push({ name: "xl/_rels/workbook.xml.rels", data: workbookRels });

  sheets.forEach((sheet, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheet.xml });
    if (sheet.hyperlinks.length) {
      let rels = `${XML_DECL}\n<Relationships xmlns="${REL_NS}">`;
      sheet.hyperlinks.forEach((link, j) => {
        rels +=
          `<Relationship Id="rId${j + 1}" Type="${DOC_REL}/hyperlink" ` +
          `Target="${escapeXml(link.url)}" TargetMode="External"/>`;
      });
      rels += "</Relationships>";
      files.push({
        name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        data: rels,
      });
    }
  });

  return zipFiles(files);
}
