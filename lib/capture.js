// lib/capture.js
// Helpers puros para la captura de contenido. Sin `chrome`, sin DOM y sin
// dependencias: se importa igual en Node (tests), en el service worker MV3 y
// en el panel lateral.

// Única clave raíz del estado en chrome.storage.local, compartida por el
// service worker y el panel (Tasks 2 y 8).
export const STATE_STORAGE_KEY = "colecciones.state";

// Cola serializadora pura (FIFO). Cada tarea se encadena a la anterior, por lo
// que nunca se solapan; el valor devuelto es el de la tarea. Un rechazo no
// rompe la cola: la siguiente tarea se ejecuta igual. Sin dependencias ni
// globals de navegador: se usa en Node (tests) y en el service worker MV3.
export function createSerializedQueue() {
  let cola = Promise.resolve();
  return function encolar(tarea) {
    const resultado = cola.then(() =>
      typeof tarea === "function" ? tarea() : tarea
    );
    cola = resultado.then(
      () => undefined,
      () => undefined
    );
    return resultado;
  };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Acepta solo URLs http(s) absolutas. Descarta relativas, protocol-relativas,
// data: (incluidas las grandes) y cualquier otro esquema. Así las miniaturas
// remotas se guardan como referencia (thumbnailUrl), nunca como data URL
// incrustada (thumbnailData) — Review Focus #3.
export function isAbsoluteHttpUrl(value) {
  const candidate = text(value);
  if (!/^https?:\/\//i.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Prioridad: ogImage -> firstImage -> favicon -> null. `pageUrl` forma parte
// del contexto extraído, pero no se usa para "arreglar" URLs relativas: el
// contrato exige devolver únicamente una URL http(s) absoluta o null.
export function pickThumbnail({ ogImage, firstImage, favicon, pageUrl } = {}) {
  void pageUrl;
  for (const candidate of [ogImage, firstImage, favicon]) {
    if (isAbsoluteHttpUrl(candidate)) return text(candidate);
  }
  return null;
}

// Cadena de respaldo que el panel usa al pintar una tarjeta: miniatura remota,
// favicon y, como último recurso, una miniatura local ya guardada. Nunca se
// incluyen data: arbitrarios ni esquemas javascript:/vbscript: (Review Focus #3).
export function thumbnailCandidates(item = {}) {
  const src = item && typeof item === "object" ? item : {};
  const candidatos = [src.thumbnailUrl, src.faviconUrl];
  const locales = typeof src.thumbnailData === "string" &&
    /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(src.thumbnailData.trim())
    ? [src.thumbnailData.trim()]
    : [];
  const resultado = [];
  for (const candidato of candidatos) {
    if (isAbsoluteHttpUrl(candidato) && !resultado.includes(text(candidato))) {
      resultado.push(text(candidato));
    }
  }
  for (const local of locales) {
    if (!resultado.includes(local)) resultado.push(local);
  }
  return resultado;
}

// Construye un ítem "crudo" aceptado por addItem (lib/store.js), que se
// encarga de asignar id, timestamps y orden. No genera thumbnailData bajo
// ninguna circunstancia: un ogImage cross-origin se conserva como URL.
export function buildCapturedItem({
  url,
  title,
  selection,
  linkUrl,
  imageUrl,
  ogImage,
  favicon,
} = {}) {
  const pageUrl = text(url);
  const selected = text(selection);
  const image = text(imageUrl);
  const link = text(linkUrl);

  let type = "page";
  let itemUrl = pageUrl;
  let itemText = "";

  // Prioridad de captura: texto seleccionado > imagen > enlace > página.
  if (selected) {
    type = "text";
    itemText = selected;
  } else if (image) {
    type = "image";
    itemUrl = image;
  } else if (link) {
    type = "link";
    itemUrl = link;
  }

  return {
    type,
    title: text(title) || selected.slice(0, 120) || itemUrl || "Sin título",
    url: itemUrl,
    sourceUrl: pageUrl || null,
    text: itemText,
    annotation: "",
    faviconUrl: text(favicon) || null,
    thumbnailUrl: pickThumbnail({
      ogImage,
      firstImage: image,
      favicon,
      pageUrl: itemUrl || pageUrl,
    }),
    // Intencionadamente ausente: thumbnailData jamás se genera aquí.
  };
}
