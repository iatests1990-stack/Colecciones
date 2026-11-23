// lib/bingsaves.js
// Normalización del payload que emite el scraper de Bing Saves (Task 9).
// Módulo puro: sin chrome, sin DOM, sin red. Nunca genera `thumbnailData`:
// Bing solo entrega `thumbnailUrl` como referencia (las imágenes pueden ser
// cross-origin o depender de la sesión y no se descargan bytes).

const ITEM_TYPES = new Set(["page", "link", "image", "text", "note"]);

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUrl(value) {
  return str(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deriveTitleFromUrl(url) {
  const match = url.match(/^https?:\/\/([^/]+)/i);
  return match ? match[1].toLowerCase().replace(/^www\./, "") : "";
}

// Convierte una tarjeta del payload a la forma canónica de un ítem.
// Devuelve null cuando la tarjeta no aporta URL, texto ni miniatura.
function toItem(raw) {
  const src = isObject(raw) ? raw : {};
  const url = normalizeUrl(src.url);
  const text = str(src.text);
  const thumbnailUrl = str(src.thumbnailUrl);
  const title = str(src.title);

  // Sin enlace: nota si hay texto, imagen si hay miniatura; si no, se omite.
  if (!url) {
    if (text) {
      const item = {
        type: "note",
        title: title || text.slice(0, 60),
        url: "",
        text,
      };
      if (thumbnailUrl) item.thumbnailUrl = thumbnailUrl;
      return item;
    }
    if (thumbnailUrl) {
      return { type: "image", title: title || "Imagen", url: "", thumbnailUrl };
    }
    return null;
  }

  const item = {
    type: ITEM_TYPES.has(src.type) ? src.type : "page",
    title: title || deriveTitleFromUrl(url) || url,
    url,
  };
  if (text) item.text = text;
  if (thumbnailUrl) item.thumbnailUrl = thumbnailUrl;
  // No se copia thumbnailData aunque el payload lo trajera por error.
  return item;
}

/**
 * Normaliza el payload de Bing Saves al mismo formato de ítems que mapEdgeCsv.
 *
 * @param {{rootName?:string, collections?:Array<{name?:string, items?:Array, skipped?:number}>, skipped?:number}} payload
 * @param {string} [fallbackName] nombre para colecciones sin nombre
 * @returns {{collections:Array<{name:string, items:Array}>, stats:{collections:number, items:number, skipped:number, duplicatesRemoved:number}}}
 */
export function normalizeBingPayload(payload, fallbackName = "Import") {
  const src = isObject(payload) ? payload : {};
  const incoming = Array.isArray(src.collections) ? src.collections : [];
  const rootName = str(src.rootName);
  const fallback = str(fallbackName) || "Import";

  // La raíz es la colección que coincide con rootName; si no, la primera sin
  // nombre; si no, la primera entrada. El resto son colecciones con nombre.
  const byName = rootName
    ? incoming.findIndex((c) => str(isObject(c) ? c.name : "").toLowerCase() === rootName.toLowerCase())
    : -1;
  const byEmpty = incoming.findIndex((c) => str(isObject(c) ? c.name : "") === "");
  const rootIndex = byName >= 0 ? byName : byEmpty >= 0 ? byEmpty : 0;

  // 1. URLs ya presentes en las colecciones con nombre (todo salvo la raíz).
  const namedUrls = new Set();
  incoming.forEach((col, index) => {
    if (index === rootIndex) return;
    const items = isObject(col) && Array.isArray(col.items) ? col.items : [];
    for (const raw of items) {
      const url = normalizeUrl(isObject(raw) ? raw.url : "");
      if (url) namedUrls.add(url);
    }
  });

  // 2. Skipped: se prefiere el total del payload; si no está, se suman los
  //    contadores por colección. Las tarjetas omitidas aquí también cuentan.
  let skipped = Number.isFinite(src.skipped) ? src.skipped : 0;
  if (!Number.isFinite(src.skipped)) {
    for (const col of incoming) {
      if (isObject(col) && Number.isFinite(col.skipped)) skipped += col.skipped;
    }
  }

  let duplicatesRemoved = 0;
  const collections = [];

  for (let index = 0; index < incoming.length; index++) {
    const col = isObject(incoming[index]) ? incoming[index] : {};
    const isRoot = index === rootIndex;
    const rawName = str(col.name);
    const name = rawName || (isRoot ? rootName : "") || fallback;
    const seenUrls = new Set();
    const items = [];

    for (const raw of Array.isArray(col.items) ? col.items : []) {
      const url = normalizeUrl(isObject(raw) ? raw.url : "");

      // Deduplicar dentro de la colección y quitar de la raíz lo que ya
      // aparece en una colección con nombre.
      if (url && (seenUrls.has(url) || (isRoot && namedUrls.has(url)))) {
        duplicatesRemoved += 1;
        continue;
      }

      const item = toItem(raw);
      if (!item) {
        skipped += 1;
        continue;
      }

      if (url) seenUrls.add(url);
      items.push(item);
    }

    collections.push({ name, items });
  }

  return {
    collections,
    stats: {
      collections: collections.length,
      items: collections.reduce((sum, c) => sum + c.items.length, 0),
      skipped,
      duplicatesRemoved,
    },
  };
}
