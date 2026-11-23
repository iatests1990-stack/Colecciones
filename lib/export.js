// lib/export.js
// Exportadores CSV (RFC 4180) y backup JSON para Colecciones.
// Sin dependencias ni globals de navegador: se importa igual en Node (tests)
// que en la extensión MV3.

import { SCHEMA_VERSION } from "./store.js";

// -- CSV ------------------------------------------------------------------

// Devuelve un CSV RFC 4180 con cabecera Collection,Title,URL.
// Solo se exportan ítems con URL (páginas, enlaces, imágenes); las notas no
// producen filas. Campos con coma, comilla o salto de línea se entrecomillan
// y las comillas internas se duplican.
export function toCsv(collections) {
  const lines = ["Collection,Title,URL"];
  if (!Array.isArray(collections)) return lines.join("\r\n") + "\r\n";

  for (const col of collections) {
    if (!col || typeof col !== "object") continue;
    const collectionName = col.name ?? "Sin título";
    const items = Array.isArray(col.items) ? col.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (String(item.type || "page").toLowerCase() === "note") continue;
      const url = typeof item.url === "string" ? item.url.trim() : "";
      if (!url) continue;
      lines.push([collectionName, item.title ?? "", url].map(csvField).join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

function csvField(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// -- Backup JSON ----------------------------------------------------------

export function toJsonBackup(state) {
  return JSON.stringify(state, null, 2);
}

// Analiza un backup y valida su schemaVersion. Una versión desconocida o un
// JSON mal formado se rechaza lanzando un Error.
export function parseJsonBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Backup JSON inválido: no se pudo analizar");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.schemaVersion !== SCHEMA_VERSION
  ) {
    throw new Error(
      `Backup JSON inválido: schemaVersion no soportado (se esperaba ${SCHEMA_VERSION})`
    );
  }
  return parsed;
}
