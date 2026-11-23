import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import {
  SCHEMA_VERSION,
  createEmptyState,
  uid,
  createCollection,
  renameCollection,
  deleteCollection,
  addItem,
  updateItem,
  deleteItem,
  moveItem,
  createSection,
  assignItemToSection,
  deleteSection,
  sortCollections,
  importIntoState,
  previewImport,
  renumberOrders,
  partitionItemsBySection,
  migrate,
} from "../lib/store.js";

describe("Store - estado vacío y utilidades", () => {
  it("createEmptyState devuelve esquema, colecciones vacías y tema system", () => {
    const state = createEmptyState();
    assert.strictEqual(state.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(state.collections, []);
    assert.strictEqual(state.settings.theme, "system");
  });

  it("uid genera identificadores únicos con prefijo", () => {
    const a = uid("col");
    const b = uid("col");
    assert.notStrictEqual(a, b);
    assert.ok(a.startsWith("col_"));
  });
});

describe("Store - colecciones", () => {
  it("createCollection añade una colección con los campos base", () => {
    const state = createCollection(createEmptyState(), "Viajes");
    assert.strictEqual(state.collections.length, 1);
    const c = state.collections[0];
    assert.strictEqual(c.name, "Viajes");
    assert.strictEqual(typeof c.createdAt, "number");
    assert.strictEqual(typeof c.updatedAt, "number");
    assert.deepEqual(c.items, []);
    assert.deepEqual(c.sections, []);
  });

  it("renameCollection y deleteCollection son inmutables", () => {
    const s0 = createCollection(createEmptyState(), "Viajes");
    const id = s0.collections[0].id;
    const s1 = renameCollection(s0, id, "Trabajo");
    assert.strictEqual(s1.collections[0].name, "Trabajo");
    assert.strictEqual(s0.collections[0].name, "Viajes");
    const s2 = deleteCollection(s1, id);
    assert.strictEqual(s2.collections.length, 0);
    assert.strictEqual(s1.collections.length, 1);
  });
});

describe("Store - ítems y dedupe", () => {
  it("addItem añade y omite duplicados por URL en la misma colección", () => {
    let state = createCollection(createEmptyState(), "A");
    const cid = state.collections[0].id;
    state = addItem(state, cid, { type: "page", url: "https://a.test", title: "A" });
    assert.strictEqual(state.collections[0].items.length, 1);
    state = addItem(state, cid, { type: "page", url: "https://a.test", title: "Otra" });
    assert.strictEqual(state.collections[0].items.length, 1);
  });

  it("addItem permite la misma URL en otra colección (dedupe por colección)", () => {
    let state = createCollection(createEmptyState(), "A");
    state = createCollection(state, "B");
    const [a, b] = state.collections;
    state = addItem(state, a.id, { type: "page", url: "https://a.test", title: "A" });
    state = addItem(state, b.id, { type: "page", url: "https://a.test", title: "B" });
    assert.strictEqual(state.collections[0].items.length, 1);
    assert.strictEqual(state.collections[1].items.length, 1);
  });

  it("updateItem y deleteItem actualizan sin mutar el estado previo", () => {
    let s0 = createCollection(createEmptyState(), "A");
    const cid = s0.collections[0].id;
    s0 = addItem(s0, cid, { type: "note", title: "Nota", text: "x" });
    const iid = s0.collections[0].items[0].id;
    const s1 = updateItem(s0, iid, { title: "Editada" });
    assert.strictEqual(s1.collections[0].items[0].title, "Editada");
    assert.strictEqual(s0.collections[0].items[0].title, "Nota");
    const s2 = deleteItem(s1, iid);
    assert.strictEqual(s2.collections[0].items.length, 0);
  });

  it("moveItem cambia de colección y respeta el índice", () => {
    let s = createCollection(createEmptyState(), "A");
    s = createCollection(s, "B");
    const [a, b] = s.collections;
    s = addItem(s, a.id, { type: "page", url: "https://1.test", title: "Uno" });
    s = addItem(s, a.id, { type: "page", url: "https://2.test", title: "Dos" });
    s = addItem(s, b.id, { type: "page", url: "https://b.test", title: "B" });
    const itemId = s.collections[0].items[0].id;
    s = moveItem(s, itemId, b.id, 0);
    assert.strictEqual(s.collections[0].items.length, 1);
    assert.strictEqual(s.collections[1].items.length, 2);
    assert.strictEqual(s.collections[1].items[0].id, itemId);
    assert.strictEqual(s.collections[1].items[0].collectionId, b.id);
  });
});

describe("Store - secciones (sin tipo heading)", () => {
  it("createSection + assignItemToSection agrupan sin crear ítems heading", () => {
    let s = createCollection(createEmptyState(), "A");
    const cid = s.collections[0].id;
    s = addItem(s, cid, { type: "page", url: "https://a.test", title: "A" });
    s = createSection(s, cid, "Lugares");
    const section = s.collections[0].sections[0];
    assert.strictEqual(section.title, "Lugares");
    const itemId = s.collections[0].items[0].id;
    s = assignItemToSection(s, itemId, section.id);
    assert.strictEqual(s.collections[0].items[0].sectionId, section.id);
    assert.ok(!s.collections[0].items.some((i) => i.type === "heading"));
  });
});

describe("Store - ordenación", () => {
  it("deleteSection elimina la sección y deja sus ítems sin sección (visibles)", () => {
    let s = createEmptyState();
    s = createCollection(s, "Viaje");
    const cid = s.collections[0].id;
    s = createSection(s, cid, "Transporte");
    const sec = s.collections[0].sections[0];
    s = addItem(s, cid, { type: "page", title: "JR Pass", url: "https://jr.test" });
    const itemId = s.collections[0].items[0].id;
    s = assignItemToSection(s, itemId, sec.id);

    const resultado = deleteSection(s, sec.id);
    assert.equal(resultado.collections[0].sections.length, 0);
    assert.equal(resultado.collections[0].items.length, 1);
    assert.equal(resultado.collections[0].items[0].sectionId, null);
    assert.equal(s.collections[0].sections.length, 1, "el estado original no se muta");
    const { sinSeccion } = partitionItemsBySection(resultado.collections[0]);
    assert.equal(sinSeccion.length, 1, "el ítem sigue visible sin sección");
  });

  it("sortCollections por nombre descendente no muta el estado", () => {
    let s = createEmptyState();
    s = createCollection(s, "Alpha");
    s = createCollection(s, "Zeta");
    s = createCollection(s, "Beta");
    const sorted = sortCollections(s, "name", "desc");
    assert.deepEqual(
      sorted.collections.map((c) => c.name),
      ["Zeta", "Beta", "Alpha"]
    );
    assert.deepEqual(
      s.collections.map((c) => c.name),
      ["Alpha", "Zeta", "Beta"]
    );
  });
});

describe("Store - importación", () => {
  it("importIntoState fusiona por nombre, deduplica y cuadra las stats", () => {
    let s = createCollection(createEmptyState(), "Viajes");
    const cid = s.collections[0].id;
    s = addItem(s, cid, { type: "page", url: "https://a.test", title: "A" });
    const incoming = [
      {
        name: "Viajes",
        items: [
          { type: "page", url: "https://a.test", title: "A duplicado" },
          { type: "page", url: "https://b.test", title: "B nuevo" },
          { type: "note", title: "Nota nueva" },
        ],
      },
    ];
    const result = importIntoState(s, incoming);
    assert.strictEqual(result.stats.added, 2);
    assert.strictEqual(result.stats.skipped, 1);
    assert.strictEqual(result.stats.added + result.stats.skipped, 3);
    assert.strictEqual(result.state.collections.length, 1);
    assert.strictEqual(result.state.collections[0].items.length, 3);
    assert.strictEqual(s.collections[0].items.length, 1);
  });
});

describe("Store - vista previa de importación", () => {
  it("previewImport cuenta las colecciones creadas o con altas y deduplica elementos", () => {
    let s = createCollection(createEmptyState(), "Viajes");
    s = addItem(s, s.collections[0].id, {
      type: "page",
      url: "https://a.test",
      title: "A",
    });
    const incoming = [
      {
        name: "Viajes",
        items: [
          { type: "page", url: "https://a.test", title: "Duplicado" },
          { type: "page", url: "https://b.test", title: "Nuevo" },
        ],
      },
      { name: "Nueva", items: [{ type: "note", title: "Nota" }] },
      { name: "Sin elementos", items: [] },
    ];

    const vista = previewImport(s, incoming);

    assert.equal(
      vista.collections,
      3,
      "Viajes gana un ítem; Nueva y Sin elementos se crean (aunque esta última quede vacía)"
    );
    assert.equal(vista.items, 2, "Un duplicado se omite; entran 2 elementos");
    assert.equal(vista.skipped, 1);
    assert.equal(vista.added, 2, "Cuadra con importIntoState");
    assert.equal(s.collections.length, 1, "La vista previa no muta el estado");
  });
});

describe("Store - renumeración tras reordenar", () => {
  it("renumberOrders asigna order igual al índice new de cada tarjeta", () => {
    let s = createCollection(createEmptyState(), "A");
    const cid = s.collections[0].id;
    s = addItem(s, cid, { type: "page", url: "https://1.test", title: "Uno" });
    s = addItem(s, cid, { type: "page", url: "https://2.test", title: "Dos" });
    s = addItem(s, cid, { type: "page", url: "https://3.test", title: "Tres" });
    const [uno, dos, tres] = s.collections[0].items.map((i) => i.id);

    const reordenado = renumberOrders(s, cid, [tres, uno, dos]);
    const items = reordenado.collections[0].items;

    assert.equal(items.find((i) => i.id === tres).order, 0);
    assert.equal(items.find((i) => i.id === uno).order, 1);
    assert.equal(items.find((i) => i.id === dos).order, 2);
    assert.deepEqual(
      s.collections[0].items.map((i) => i.order),
      [0, 1, 2],
      "El estado original no se muta"
    );
  });
});

describe("Store - reparto de ítems por sección", () => {
  it("partitionItemsBySection agrupa los ítems asignados a secciones existentes", () => {
    const collection = {
      id: "col",
      name: "Viajes",
      sections: [
        { id: "sec-b", title: "B", order: 1 },
        { id: "sec-a", title: "A", order: 0 },
      ],
      items: [
        { id: "i1", title: "En A", sectionId: "sec-a", order: 0 },
        { id: "i2", title: "Sin sección", sectionId: null, order: 1 },
        { id: "i3", title: "En B", sectionId: "sec-b", order: 2 },
      ],
    };

    const reparto = partitionItemsBySection(collection);

    assert.deepEqual(reparto.sections.map((g) => g.section.id), ["sec-a", "sec-b"]);
    assert.deepEqual(reparto.sections[0].items.map((i) => i.id), ["i1"]);
    assert.deepEqual(reparto.sections[1].items.map((i) => i.id), ["i3"]);
    assert.deepEqual(reparto.sinSeccion.map((i) => i.id), ["i2"]);
  });

  it("partitionItemsBySection pone en sinSeccion los ítems con sectionId huérfano", () => {
    const collection = {
      id: "col",
      sections: [{ id: "sec-viva", title: "Viva", order: 0 }],
      items: [
        { id: "i1", sectionId: "sec-viva", order: 0 },
        { id: "huerfano", sectionId: "sec-borrada", order: 1 },
      ],
    };

    const reparto = partitionItemsBySection(collection);

    assert.deepEqual(reparto.sections[0].items.map((i) => i.id), ["i1"]);
    assert.deepEqual(reparto.sinSeccion.map((i) => i.id), ["huerfano"]);
    assert.equal(
      reparto.sections.reduce((n, g) => n + g.items.length, 0) + reparto.sinSeccion.length,
      2,
      "ningún ítem desaparece del reparto"
    );
  });

  it("partitionItemsBySection deja sin sección los ítems sin sectionId", () => {
    const collection = {
      id: "col",
      sections: [{ id: "sec-a", title: "A", order: 0 }],
      items: [
        { id: "i1", order: 0 },
        { id: "i2", sectionId: "", order: 1 },
        { id: "i3", sectionId: undefined, order: 2 },
      ],
    };

    const reparto = partitionItemsBySection(collection);

    assert.deepEqual(reparto.sections[0].items, []);
    assert.deepEqual(reparto.sinSeccion.map((i) => i.id), ["i1", "i2", "i3"]);
  });
});

describe("Store - migraciones", () => {
  it("migrate lleva una versión 0 al esquema actual y rellena defaults", () => {
    const state = migrate({ schemaVersion: 0, collections: [] });
    assert.strictEqual(state.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(state.collections, []);
    assert.strictEqual(state.settings.theme, "system");
  });

  it("migrate conserva colecciones e ítems de versiones antiguas", () => {
    const state = migrate({
      schemaVersion: 0,
      collections: [
        {
          name: "Vieja",
          items: [{ type: "page", url: "https://old.test", title: "Old" }],
        },
      ],
    });
    assert.strictEqual(state.schemaVersion, SCHEMA_VERSION);
    assert.strictEqual(state.collections.length, 1);
    assert.strictEqual(state.collections[0].items.length, 1);
    assert.strictEqual(
      state.collections[0].items[0].collectionId,
      state.collections[0].id
    );
  });
});
