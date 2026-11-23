export function parseCsv(text) {
  // 1. Remove BOM (real U+FEFF byte, or a literal "\uFEFF" escape sequence
  //    as written in some hand-authored CSV fixtures)
  let cleaned = text.replace(/^\uFEFF/, '').replace(/^\\uFEFF/, '');

  // 2. Normalize line endings: CRLF -> LF, bare CR -> LF
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Detect a SINGLE delimiter from the first non-empty line,
  //    counting only separators that appear OUTSIDE quotes.
  let firstLine = '';
  for (const line of cleaned.split('\n')) {
    if (line.trim() !== '') { firstLine = line; break; }
  }
  let delimiter = ',';
  let semiCount = 0, commaCount = 0, inQ = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') {
      if (inQ && i + 1 < firstLine.length && firstLine[i + 1] === '"') { i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (inQ) continue;
    if (ch === ';') semiCount++;
    else if (ch === ',') commaCount++;
  }
  if (semiCount > 0 && semiCount >= commaCount) delimiter = ';';
  else if (commaCount > 0) delimiter = ',';

  // 4. Single-pass parse into rows of fields.
  //    inQuotes is always reset to false when a closing quote is found,
  //    so newlines/delimiters after a quoted field end the row/field normally.
  const rows = [];
  let currentRow = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < cleaned.length && cleaned[i + 1] === '"') {
          // Escaped quote: add one literal " and consume both characters
          field += '"';
          i += 2;
          continue;
        }
        // Closing quote — reset state so the rest of the line is parsed normally
        inQuotes = false;
        i++;
        continue;
      }
      // Newlines and delimiters inside quotes are literal field content
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      currentRow.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      currentRow.push(field);
      rows.push(currentRow);
      currentRow = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || currentRow.length > 0) {
    currentRow.push(field);
    rows.push(currentRow);
  }

  // 5. Remove trailing empty rows (a single empty field)
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}

// Helper: check if a row looks like a CSV header (English or Spanish names)
function rowLooksLikeHeader(row) {
  if (row.length < 3) return false;
  const cols = row.map(cell => String(cell || '').trim().toLowerCase());
  const collectionKeywords = ['collection', 'group', 'folder', 'coleccion', 'grupo', 'carpeta'];
  const hasCollection = collectionKeywords.some(k => cols.includes(k));
  const hasUrl = cols.some(c => /url|link|address|href/.test(c));
  const titleKeywords = ['title', 'name', 'text', 'titulo', 'nombre', 'texto'];
  const hasTitle = titleKeywords.some(k => cols.includes(k));
  return hasCollection && hasUrl && hasTitle;
}

// Helper: get safe string from a parsed field row
function getField(row, idx) {
  return idx >= 0 && idx < row.length ? row[idx].trim() : '';
}

export function mapEdgeCsv(csvText, fallbackName = 'Import') {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { collections: [], stats: { collections: 0, pages: 0, skipped: 0 } };

  // Step 1: Determine if the first row is a header or data
  const originalHeader = rows[0] || [];
  const headerLooksLike = rowLooksLikeHeader(originalHeader);

  let dataRows;
  let colCollection = -1, colUrl = -1, colTitle = -1;

  if (headerLooksLike) {
    dataRows = rows.slice(1);
    // Map columns from header — match English AND Spanish names
    for (let i = 0; i < originalHeader.length; i++) {
      const name = String(originalHeader[i] || '').trim().toLowerCase();
      if (['collection', 'group', 'folder', 'coleccion', 'grupo', 'carpeta'].includes(name)) colCollection = i;
      if (/url|link|address|href/.test(name)) colUrl = i;
      if (/title|name|text|titulo|nombre|texto/.test(name)) colTitle = i;
    }
    // Guard: if ANY column failed to map, reset ALL to positional [0,1,2]
    if (colCollection === -1 || colUrl === -1 || colTitle === -1) {
      colCollection = 0;
      colTitle = 1;
      colUrl = 2;
    }
  } else {
    // No recognizable header: all rows are data, positional columns [0,1,2]
    dataRows = rows;
    colCollection = 0;
    colTitle = 1;
    colUrl = 2;
  }

  // Step 2: Group rows by collection name
  const collectionMap = new Map(); // mapKey -> {name, items}
  let skipped = 0;

  function deriveTitleFromUrl(url) {
    if (!url) return '';
    try {
      const m = url.match(/^https?:\/\/([^/]+)/i);
      if (m) return m[1].toLowerCase().replace(/^www\./, '');
    } catch {}
    return '';
  }

  for (const row of dataRows) {
    const collectionName = getField(row, colCollection);
    const title = getField(row, colTitle);
    const url = getField(row, colUrl);

    if (!url) { skipped++; continue; }

    const finalTitle = title ? title : deriveTitleFromUrl(url);
    if (!finalTitle) { skipped++; continue; }

    // Normalize empty collection name to fallbackName (consistent keying)
    const mapKey = collectionName === '' ? fallbackName : collectionName;
    const colEntry = collectionMap.get(mapKey) || { name: mapKey, items: [] };
    colEntry.items.push({ type: 'page', title: finalTitle, url });
    collectionMap.set(mapKey, colEntry);
  }

  // Step 3: Build ordered collections list (preserve first-appearance order)
  const orderedCollections = [];
  const seen = new Set();
  for (const row of dataRows) {
    const collectionName = getField(row, colCollection);
    const mapKey = collectionName === '' ? fallbackName : collectionName;
    if (!seen.has(mapKey)) {
      seen.add(mapKey);
      const entry = collectionMap.get(mapKey);
      if (entry) orderedCollections.push(entry);
    }
  }

  const stats = {
    collections: orderedCollections.length,
    pages: orderedCollections.reduce((sum, c) => sum + c.items.length, 0),
    skipped,
  };

  return { collections: orderedCollections, stats };
}