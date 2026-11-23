// lib/render.js
// Renderers a Markdown, HTML y lista de enlaces para Colecciones.
// Sin dependencias; solo Node built-ins. Todo es auto-contenido y
// escapa texto/variables no confiables para evitar inyección de script.

// -- toMarkdown -----------------------------------------------------------

export function toMarkdown(collections) {
  if (!Array.isArray(collections)) return "";
  const parts = [];
  for (const col of collections) {
    if (!col || typeof col !== "object") continue;
    const name = col.name ?? "Sin título";
    parts.push(`## ${name}`);
    const items = orderedItems(col.items);
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const type = (item.type || "page").toLowerCase();
      const title = escapeEntities(item.title ?? "");
      const url = item.url || "";
      if (type === "page") {
        parts.push(`[${title}](${url})`);
      } else if (type === "note") {
        const text = item.text ?? "";
        if (text.trim()) {
          parts.push(`**${title}** ${text}`);
        }
      } else if (type === "image") {
        const thumb = item.thumbnailUrl || item.url || "";
        parts.push(`![${title}](${thumb})`);
      } else if (type === "link") {
        parts.push(`[${title}](${url})`);
      } else {
        parts.push(`[${title}](${url})`);
      }
    }
  }
  return parts.join("\n\n");
}

// -- toHtml ---------------------------------------------------------------

export function toHtml(collections) {
  if (!Array.isArray(collections)) return `<!DOCTYPE html><html><body></body></html>`;

  const bodyParts = [];

  for (const col of collections) {
    if (!col || typeof col !== "object") continue;
    const name = col.name ?? "Sin título";
    bodyParts.push(`<h1>${escapeEntities(name)}</h1>`);
    const items = orderedItems(col.items);
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const type = (item.type || "page").toLowerCase();
      const title = escapeEntities(item.title ?? "");
      const url = item.url || "";
      if (type === "page") {
        bodyParts.push(`<p><a href="${escapeEntities(safeHref(url))}">${title}</a></p>`);
      } else if (type === "note") {
        const text = (item.text ?? "").trim();
        if (text) {
          bodyParts.push(`<p>${escapeEntities(text)}</p>`);
        }
      } else if (type === "image") {
        // Modo self-contained: data URI en lugar de src con http/https
        bodyParts.push(`<p><img src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E" alt="${title}"></p>`);
      } else if (type === "link") {
        bodyParts.push(`<p><a href="${escapeEntities(safeHref(url))}">${title}</a></p>`);
      } else {
        bodyParts.push(`<p><a href="${escapeEntities(safeHref(url))}">${title}</a></p>`);
      }
    }
  }

  const body = bodyParts.join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

// -- toLinkList -----------------------------------------------------------

export function toLinkList(collections) {
  if (!Array.isArray(collections)) return "";
  const lines = [];
  for (const col of collections) {
    if (!col || typeof col !== "object") continue;
    const items = orderedItems(col.items);
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const type = (item.type || "page").toLowerCase();
      if (type === "note") continue;
      const title = escapeEntities(item.title ?? "");
      const url = item.url || "";
      if (url) {
        lines.push(`${title} — ${url}`);
      } else {
        lines.push(title);
      }
    }
  }
  return lines.join("\n");
}

// -- escapeEntities (internal) ------------------------------------------

function escapeEntities(text) {
  if (typeof text !== "string") return String(text);
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Neutraliza esquemas de URL peligrosos en atributos href de HTML.
// Solo se permiten esquemas web seguros; las URLs relativas (sin esquema)
// se dejan intactas. Cualquier otro esquema (javascript:, data:, vbscript:)
// se reemplaza por '#' para evitar ejecución de código al hacer clic.
function safeHref(url) {
  const value = String(url ?? "").trim();
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, "");
  const match = cleaned.match(/^([a-z][a-z0-9+.-]*):/i);
  if (match) {
    const scheme = match[1].toLowerCase();
    const allowed = ["http", "https", "mailto", "ftp", "ftps"];
    if (!allowed.includes(scheme)) return "#";
  }
  return value;
}

// Ordena los ítems por el campo `order` cuando existe, sin mutar la entrada.
// Los ítems sin `order` conservan su posición original en el array; los ítems
// con `order` se colocan (en orden ascendente) en las posiciones que aquellos
// ocupaban. En empates de `order` se respeta el orden original del array.
function orderedItems(items) {
  if (!Array.isArray(items)) return [];
  const ordered = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (
      item &&
      typeof item === "object" &&
      typeof item.order === "number" &&
      Number.isFinite(item.order)
    ) {
      ordered.push({ index: i, item, order: item.order });
    }
  }
  if (ordered.length === 0) return items;

  const slots = ordered.map((entry) => entry.index);
  const sorted = ordered.slice().sort(
    (a, b) => a.order - b.order || a.index - b.index
  );

  const result = items.slice();
  slots.forEach((index, position) => {
    result[index] = sorted[position].item;
  });
  return result;
}