// lib/sync.js
// Lógica pura de la sincronización por archivo. Sin dependencias de la API de
// extensiones ni del árbol visual: se importa igual en Node (tests) que en la
// extensión. Toda la resolución de conflictos se decide aquí.

import { SCHEMA_VERSION } from "./store.js";

// Devuelve una marca de tiempo utilizable. Si el estado no trae una marca
// válida se usa `ahora` como última modificación conocida.
function marcaDe(estado, ahora) {
  return estado && Number.isFinite(estado.updatedAt) ? estado.updatedAt : ahora;
}

// Serialización estable: el mismo contenido con distinto orden de claves debe
// compararse como idéntico. Así evitamos conflictos espurios entre un archivo
// escrito a mano y un estado reconstruido por las migraciones.
function serializable(valor) {
  if (valor === undefined) return "null";
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(serializable).join(",")}]`;
  const claves = Object.keys(valor).sort();
  return `{${claves
    .map((clave) => `${JSON.stringify(clave)}:${serializable(valor[clave])}`)
    .join(",")}}`;
}

// Envuelve un estado en el sobre que se escribe en el archivo compartido.
export function syncPayload(state) {
  const estado = state && typeof state === "object" ? state : {};
  return {
    version: SCHEMA_VERSION,
    updatedAt: Number.isFinite(estado.updatedAt) ? estado.updatedAt : Date.now(),
    state: estado,
  };
}

// Última modificación gana. Con marcas iguales, contenidos distintos se
// señalan como conflicto y gana el estado local (desempate local).
export function mergeStates(local, remote, now) {
  const marcaLocal = marcaDe(local, now);
  const marcaRemota = marcaDe(remote, now);
  if (marcaRemota > marcaLocal) return { state: remote, conflict: false };
  if (marcaLocal > marcaRemota) return { state: local, conflict: false };
  return { state: local, conflict: serializable(local) !== serializable(remote) };
}

// ¿Tiene sentido traer el estado remoto? Solo si es estrictamente más nuevo.
// Ante marcas dudosas se prefiere no sobrescribir el trabajo local.
export function shouldPull(localMeta, remoteMeta) {
  const local = localMeta && Number.isFinite(localMeta.updatedAt) ? localMeta.updatedAt : null;
  const remoto = remoteMeta && Number.isFinite(remoteMeta.updatedAt) ? remoteMeta.updatedAt : null;
  if (local === null || remoto === null) return false;
  return remoto > local;
}
