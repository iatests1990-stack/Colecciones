// lib/store.js
// Modelo de datos puro e inmutable para Colecciones.
// Sin dependencias ni globals de navegador: se importa igual en Node (tests)
// que en el navegador (extension MV3).

export const SCHEMA_VERSION = 1;

const ITEM_TYPES = new Set(["page", "link", "image", "text", "note"]);

function defaultSettings() {
  return {
    theme: "system",
    defaultCollectionId: null,
    captureShortcut: "Ctrl+Shift+S",
    sortMode: "name",
    sortDirection: "asc",
    sync: { enabled: false, fileHandleName: null, lastSyncAt: null },
    autoFileRules: [],
  };
}

export function createEmptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    collections: [],
    settings: defaultSettings(),
    updatedAt: Date.now(),
  };
}

export function uid(prefix = "id") {
  let uuid;
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    uuid = webCrypto.randomUUID();
  } else {
    uuid =
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10) +
      "-" +
      Math.random().toString(36).slice(2, 10);
  }
  return prefix ? `${prefix}_${uuid}` : uuid;
}

function normalizeUrl(url) {
  return typeof url === "string" ? url.trim() : "";
}

// Construye un ítem completo a partir de la forma parcial que usan los
// importadores ({type, title, url, text, thumbnailUrl, ...}). Nunca crea
// ítems de tipo 'heading': la agrupación canónica son las Section.
function makeItem(collectionId, raw, order = 0) {
  const src = raw && typeof raw === "object" ? raw : {};
  const now = Date.now();
  return {
    ...src,
    id: src.id || uid("item"),
    collectionId,
    sectionId: src.sectionId ?? null,
    type: ITEM_TYPES.has(src.type) ? src.type : "page",
    title: src.title ?? "",
    url: src.url ?? "",
    sourceUrl: src.sourceUrl ?? null,
    text: src.text ?? "",
    annotation: src.annotation ?? "",
    faviconUrl: src.faviconUrl ?? null,
    thumbnailUrl: src.thumbnailUrl ?? null,
    thumbnailData: src.thumbnailData ?? null,
    createdAt: src.createdAt ?? now,
    updatedAt: now,
    order: src.order ?? order,
  };
}

function normalizeCollection(raw, index) {
  const src = raw && typeof raw === "object" ? raw : {};
  const id = src.id || uid("col");
  const now = Date.now();
  const items = Array.isArray(src.items)
    ? src.items.map((it, i) => makeItem(id, it, i))
    : [];
  const sections = Array.isArray(src.sections)
    ? src.sections.map((s, i) => {
        const sec = s && typeof s === "object" ? s : {};
        return {
          ...sec,
          id: sec.id || uid("sec"),
          collectionId: id,
          title: sec.title ?? "",
          order: sec.order ?? i,
        };
      })
    : [];
  return {
    ...src,
    id,
    name: src.name ?? "Sin título",
    createdAt: src.createdAt ?? now,
    updatedAt: src.updatedAt ?? now,
    color: src.color ?? null,
    sortOrder: src.sortOrder ?? index,
    items,
    sections,
  };
}

export function createCollection(state, name, extra = {}) {
  const opts = extra && typeof extra === "object" ? extra : {};
  const now = Date.now();
  const collection = {
    ...opts,
    id: opts.id || uid("col"),
    name: name ?? "Sin título",
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
    color: opts.color ?? null,
    sortOrder: opts.sortOrder ?? state.collections.length,
    items: [],
    sections: [],
  };
  return {
    ...state,
    collections: [...state.collections, collection],
    updatedAt: now,
  };
}

export function renameCollection(state, id, name) {
  const now = Date.now();
  return {
    ...state,
    collections: state.collections.map((c) =>
      c.id === id ? { ...c, name, updatedAt: now } : c
    ),
    updatedAt: now,
  };
}

export function deleteCollection(state, id) {
  const now = Date.now();
  const settings =
    state.settings && state.settings.defaultCollectionId === id
      ? { ...state.settings, defaultCollectionId: null }
      : state.settings;
  return {
    ...state,
    collections: state.collections.filter((c) => c.id !== id),
    settings,
    updatedAt: now,
  };
}

// Añade un ítem a una colección. Deduplica por URL dentro de esa colección:
// la misma URL puede existir en colecciones distintas.
export function addItem(state, collectionId, item) {
  const now = Date.now();
  const url = normalizeUrl(item && item.url);
  const collections = state.collections.map((c) => {
    if (c.id !== collectionId) return c;
    if (url && c.items.some((i) => normalizeUrl(i.url) === url)) return c;
    return {
      ...c,
      items: [...c.items, makeItem(collectionId, item, c.items.length)],
      updatedAt: now,
    };
  });
  return { ...state, collections, updatedAt: now };
}

export function updateItem(state, itemId, patch) {
  const now = Date.now();
  const p = patch && typeof patch === "object" ? patch : {};
  const collections = state.collections.map((c) =>
    c.items.some((i) => i.id === itemId)
      ? {
          ...c,
          items: c.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  ...p,
                  id: i.id,
                  collectionId: i.collectionId,
                  updatedAt: now,
                }
              : i
          ),
          updatedAt: now,
        }
      : c
  );
  return { ...state, collections, updatedAt: now };
}

export function deleteItem(state, itemId) {
  const now = Date.now();
  const collections = state.collections.map((c) =>
    c.items.some((i) => i.id === itemId)
      ? {
          ...c,
          items: c.items.filter((i) => i.id !== itemId),
          updatedAt: now,
        }
      : c
  );
  return { ...state, collections, updatedAt: now };
}

// Mueve un ítem a otra colección (o a otra posición de la misma) insertinglo
// en `index`. Fuera de rango se ajusta al principio/final.
export function moveItem(state, itemId, targetCollectionId, index) {
  const source = state.collections.find((c) =>
    c.items.some((i) => i.id === itemId)
  );
  const target = state.collections.find((c) => c.id === targetCollectionId);
  if (!source || !target) return state;

  const original = source.items.find((i) => i.id === itemId);
  const now = Date.now();
  const moved = { ...original, collectionId: targetCollectionId, updatedAt: now };

  const collections = state.collections.map((c) => {
    if (c.id !== source.id && c.id !== targetCollectionId) return c;
    let items = c.items.filter((i) => i.id !== itemId);
    if (c.id === targetCollectionId) {
      const requested =
        index === undefined || index === null ? items.length : Number(index);
      const at = Number.isFinite(requested)
        ? Math.max(0, Math.min(requested, items.length))
        : items.length;
      items = [...items.slice(0, at), moved, ...items.slice(at)];
    }
    return { ...c, items, updatedAt: now };
  });
  return { ...state, collections, updatedAt: now };
}

export function createSection(state, collectionId, title) {
  const now = Date.now();
  const collections = state.collections.map((c) => {
    if (c.id !== collectionId) return c;
    const section = {
      id: uid("sec"),
      collectionId,
      title: title ?? "Nueva sección",
      order: c.sections.length,
    };
    return {
      ...c,
      sections: [...c.sections, section],
      updatedAt: now,
    };
  });
  return { ...state, collections, updatedAt: now };
}

export function deleteSection(state, sectionId) {
  const now = Date.now();
  if (!sectionId) return state;
  const collections = state.collections.map((c) => {
    if (!c.sections.some((s) => s.id === sectionId)) return c;
    return {
      ...c,
      sections: c.sections.filter((s) => s.id !== sectionId),
      items: c.items.map((i) =>
        i.sectionId === sectionId ? { ...i, sectionId: null, updatedAt: now } : i
      ),
      updatedAt: now,
    };
  });
  return { ...state, collections, updatedAt: now };
}

export function assignItemToSection(state, itemId, sectionId) {
  const now = Date.now();
  const collections = state.collections.map((c) =>
    c.items.some((i) => i.id === itemId)
      ? {
          ...c,
          items: c.items.map((i) =>
            i.id === itemId
              ? { ...i, sectionId: sectionId ?? null, updatedAt: now }
              : i
          ),
          updatedAt: now,
        }
      : c
  );
  return { ...state, collections, updatedAt: now };
}

export function sortCollections(state, mode = "name", direction = "asc") {
  const dir = String(direction).toLowerCase() === "desc" ? -1 : 1;
  const key = String(mode || "name");
  const numeric = key === "createdAt" || key === "updatedAt" || key === "sortOrder";
  const valueOf = (c) => {
    if (numeric) return typeof c[key] === "number" ? c[key] : 0;
    if (key === "items") return Array.isArray(c.items) ? c.items.length : 0;
    return String(c.name ?? "");
  };
  const collections = [...state.collections].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    const cmp = numeric ? av - bv : av.localeCompare(bv, "es", { sensitivity: "base" });
    return cmp * dir;
  });
  return { ...state, collections, updatedAt: Date.now() };
}

// Importa colecciones ya mapeadas por los importadores. Fusiona por nombre
// (insensible a mayúsculas) y omite ítems cuya URL ya exista en la colección.
// Cada ítem de entrada se contabiliza exactamente una vez en added o skipped.
export function importIntoState(state, collections) {
  const incoming = Array.isArray(collections) ? collections : [];
  const now = Date.now();
  const working = state.collections.map((c) => ({
    ...c,
    items: [...c.items],
    sections: [...c.sections],
  }));
  let added = 0;
  let skipped = 0;

  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const name = String(raw.name ?? "Sin título");
    const normalizedName = name.trim().toLowerCase();
    let collection = working.find(
      (c) => String(c.name ?? "").trim().toLowerCase() === normalizedName
    );
    if (!collection) {
      collection = {
        id: uid("col"),
        name,
        createdAt: now,
        updatedAt: now,
        color: raw.color ?? null,
        sortOrder: working.length,
        items: [],
        sections: [],
      };
      working.push(collection);
    }

    const items = Array.isArray(raw.items) ? raw.items : [];
    for (const rawItem of items) {
      const url = normalizeUrl(rawItem && rawItem.url);
      if (url && collection.items.some((i) => normalizeUrl(i.url) === url)) {
        skipped += 1;
        continue;
      }
      collection.items.push(
        makeItem(collection.id, rawItem, collection.items.length)
      );
      added += 1;
    }
    collection.updatedAt = now;
  }

  return {
    state: { ...state, collections: working, updatedAt: now },
    stats: { added, skipped },
  };
}

// Vista previa pura de una importación: aplica exactamente el mismo reducer
// que importIntoState (sin persistir) y devuelve los recuentos que debe mostrar
// el panel antes de pedir confirmación. Cuenta las colecciones que se crean
// (incluso vacías) y las que reciben al menos un elemento; los duplicados se
// omiten del recuento de elementos.
export function previewImport(state, incoming) {
  const { state: siguiente, stats } = importIntoState(state, incoming);
  const nombre = (valor) => String(valor ?? "Sin título").trim().toLowerCase();
  const cantidad = (estado) => {
    const mapa = new Map();
    for (const col of estado.collections) {
      const clave = nombre(col.name);
      mapa.set(clave, (mapa.get(clave) || 0) + (Array.isArray(col.items) ? col.items.length : 0));
    }
    return mapa;
  };
  const antes = cantidad(state);
  const despues = cantidad(siguiente);
  const nombres = new Set(
    (Array.isArray(incoming) ? incoming : [])
      .filter((col) => col && typeof col === "object")
      .map((col) => nombre(col.name))
  );
  let colecciones = 0;
  for (const clave of nombres) {
    if (!antes.has(clave) || (despues.get(clave) || 0) > (antes.get(clave) || 0)) {
      colecciones += 1;
    }
  }
  return {
    collections: colecciones,
    items: stats.added,
    added: stats.added,
    skipped: stats.skipped,
  };
}

// Reordena las tarjetas de una colección y renumbra el campo `order` para que
// coincida con el índice final de cada una (carry-over del Task 2). Los ids no
// incluidos conservan su posición relativa detrás de los explícitos.
export function renumberOrders(state, collectionId, ids) {
  const now = Date.now();
  const collections = state.collections.map((col) => {
    if (col.id !== collectionId) return col;
    const actuales = Array.isArray(col.items) ? col.items : [];
    const porId = new Map(actuales.map((item) => [item.id, item]));
    const vistos = new Set();
    const ordenados = [];

    for (const id of Array.isArray(ids) ? ids : []) {
      const item = porId.get(id);
      if (item && !vistos.has(id)) {
        ordenados.push(item);
        vistos.add(id);
      }
    }
    for (const item of actuales) {
      if (!vistos.has(item.id)) ordenados.push(item);
    }

    const posiciones = new Map(ordenados.map((item, index) => [item.id, index]));
    return {
      ...col,
      items: ordenados.map((item) => ({
        ...item,
        order: posiciones.get(item.id),
        updatedAt: now,
      })),
      updatedAt: now,
    };
  });
  return { ...state, collections, updatedAt: now };
}

// Reparte los ítems de una colección en cubos por sección para pintarlos en el
// panel. Un `sectionId` huérfano (sección borrada o backup restaurado con
// referencias antiguas) NO debe hacer invisible el ítem: cae en `sinSeccion`.
// Es puro y no muta la colección de entrada.
export function partitionItemsBySection(collection) {
  const col = collection && typeof collection === "object" ? collection : {};
  const porOrden = (a, b, indexA, indexB) => {
    const ao = Number.isFinite(a && a.order) ? a.order : Infinity;
    const bo = Number.isFinite(b && b.order) ? b.order : Infinity;
    return ao - bo || indexA - indexB;
  };
  const items = (Array.isArray(col.items) ? col.items : [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => porOrden(a.item, b.item, a.index, b.index))
    .map((entrada) => entrada.item);
  const secciones = (Array.isArray(col.sections) ? col.sections : [])
    .map((section, index) => ({ section, index }))
    .sort((a, b) => porOrden(a.section, b.section, a.index, b.index))
    .map((entrada) => entrada.section);

  const conocidas = new Set(secciones.map((section) => section && section.id));
  const grupos = new Map(secciones.map((section) => [section.id, []]));
  const sinSeccion = [];
  for (const item of items) {
    const id = item && item.sectionId;
    if (id && conocidas.has(id)) grupos.get(id).push(item);
    else sinSeccion.push(item);
  }

  return {
    sections: secciones.map((section) => ({
      section,
      items: grupos.get(section.id),
    })),
    sinSeccion,
  };
}

// Migraciones secuenciales: MIGRATIONS[n] transforma la versión n en n+1.
const MIGRATIONS = [
  // 0 -> 1: esquema inicial (sin transformación de datos).
  (s) => s,
];

// Normaliza un estado persistido (de cualquier versión <= SCHEMA_VERSION)
// rellenando los campos que falten con valores por defecto.
export function migrate(raw) {
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  let version = Number.isFinite(base.schemaVersion)
    ? Math.trunc(base.schemaVersion)
    : 0;
  let state = { ...base };
  while (version < SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (typeof migration === "function") state = migration(state);
    version += 1;
  }

  const collections = Array.isArray(state.collections)
    ? state.collections.map(normalizeCollection)
    : [];
  const userSettings =
    state.settings && typeof state.settings === "object" && !Array.isArray(state.settings)
      ? state.settings
      : {};
  const settings = {
    ...defaultSettings(),
    ...userSettings,
    sync: {
      ...defaultSettings().sync,
      ...(userSettings.sync && typeof userSettings.sync === "object" ? userSettings.sync : {}),
    },
    autoFileRules: Array.isArray(userSettings.autoFileRules)
      ? userSettings.autoFileRules
      : [],
  };
  if (!settings.theme) settings.theme = "system";

  return {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    collections,
    settings,
    updatedAt: typeof state.updatedAt === "number" ? state.updatedAt : Date.now(),
  };
}
