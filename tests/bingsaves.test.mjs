import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeBingPayload } from "../lib/bingsaves.js";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/bing-saves.sample.json", import.meta.url), "utf-8")
);

function allItems(result) {
  return result.collections.flatMap((c) => c.items);
}

function urlsOf(result, name) {
  return result.collections
    .find((c) => c.name === name)
    .items.filter((i) => i.url)
    .map((i) => i.url);
}

describe("Normalizador de payload de Bing Saves", () => {
  it("fixture: devuelve 2 colecciones (raíz + Investigación) y elimina el enlace duplicado de la raíz", () => {
    const result = normalizeBingPayload(fixture, "Importados");
    assert.strictEqual(result.collections.length, 2);
    assert.deepEqual(result.collections.map((c) => c.name), ["Guardados", "Investigación"]);
    assert.strictEqual(result.stats.collections, 2);
    assert.strictEqual(result.stats.duplicatesRemoved, 1);
    assert.deepEqual(urlsOf(result, "Guardados"), ["https://www.example.com/home"]);
    assert.deepEqual(urlsOf(result, "Investigación"), [
      "https://www.example.com/tokyo-guide",
      "https://www.example.com/research",
    ]);
    assert.strictEqual(result.stats.items, 4);
  });

  it("la tarjeta sin URL con texto se convierte en nota y no se cuenta como skipped", () => {
    const result = normalizeBingPayload(fixture, "Importados");
    const note = allItems(result).find((i) => i.type === "note");
    assert.ok(note, "Falta el ítem de tipo nota");
    assert.strictEqual(note.text, "Comprar café y filtros para la prensa francesa");
    assert.strictEqual(note.url, "");
    // Solo se propaga el skipped declarado por el scraper (1), no se suma la nota.
    assert.strictEqual(result.stats.skipped, 1);
  });

  it("la tarjeta sin URL y sin texto se omite e incrementa stats.skipped", () => {
    const payload = {
      rootName: "Guardados",
      collections: [
        {
          name: "Guardados",
          items: [
            { title: "Página", url: "https://a.example.com/p" },
            { title: "Tarjeta vacía" },
          ],
          skipped: 0,
        },
      ],
      skipped: 0,
    };
    const result = normalizeBingPayload(payload, "Importados");
    assert.strictEqual(result.stats.items, 1);
    assert.strictEqual(result.stats.skipped, 1);
    assert.strictEqual(result.collections[0].items[0].type, "page");
  });

  it("los thumbnailUrl se conservan como cadena y no se genera thumbnailData", () => {
    const result = normalizeBingPayload(fixture, "Importados");
    const thumbs = allItems(result).filter((i) => "thumbnailUrl" in i);
    assert.strictEqual(thumbs.length, 2);
    for (const item of thumbs) {
      assert.strictEqual(typeof item.thumbnailUrl, "string");
    }
    for (const item of allItems(result)) {
      assert.ok(!("thumbnailData" in item), "Ningún ítem debe tener thumbnailData");
    }

    // Defensa: aunque el scraper entregara thumbnailData, se descarta.
    const withData = {
      rootName: "Raíz",
      collections: [
        {
          name: "Raíz",
          items: [
            {
              title: "X",
              url: "https://x.example.com",
              thumbnailUrl: "https://img.example.com/x.jpg",
              thumbnailData: "data:image/png;base64,AA",
            },
          ],
        },
      ],
      skipped: 0,
    };
    const clean = normalizeBingPayload(withData, "Importados");
    assert.ok(!("thumbnailData" in clean.collections[0].items[0]));
    assert.strictEqual(clean.collections[0].items[0].thumbnailUrl, "https://img.example.com/x.jpg");
  });

  it("payload vacío de cuenta AAD → 0 colecciones y skipped 0", () => {
    const result = normalizeBingPayload({ collections: [], rootName: "" }, "Importados");
    assert.deepEqual(result.collections, []);
    assert.deepEqual(result.stats, {
      collections: 0,
      items: 0,
      skipped: 0,
      duplicatesRemoved: 0,
    });
  });

  it("no muta el payload de entrada", () => {
    const payload = JSON.parse(JSON.stringify(fixture));
    const before = JSON.stringify(payload);
    const result = normalizeBingPayload(payload, "Importados");
    assert.strictEqual(JSON.stringify(payload), before);
    // El ítem conservado 'home' es el segundo del payload original.
    assert.notStrictEqual(result.collections[0].items[0], payload.collections[0].items[1]);
  });

  it("tarjeta sin URL con thumbnailUrl se mapea a image", () => {
    const payload = {
      rootName: "Raíz",
      collections: [
        {
          name: "Raíz",
          items: [{ title: "Solo miniatura", thumbnailUrl: "https://img.example.com/a.png" }],
        },
      ],
      skipped: 0,
    };
    const result = normalizeBingPayload(payload, "Importados");
    assert.strictEqual(result.collections[0].items[0].type, "image");
    assert.strictEqual(result.collections[0].items[0].url, "");
    assert.strictEqual(result.collections[0].items[0].thumbnailUrl, "https://img.example.com/a.png");
    assert.strictEqual(result.stats.skipped, 0);
  });

  it("deduplica URLs repetidas dentro de una colección con nombre", () => {
    const payload = {
      rootName: "Raíz",
      collections: [
        { name: "Raíz", items: [{ title: "Única", url: "https://root.example.com/a" }] },
        {
          name: "Investigación",
          items: [
            { title: "Primera", url: "https://x.example.com/a" },
            { title: "Repetida", url: "https://x.example.com/a" },
          ],
        },
      ],
      skipped: 0,
    };
    const result = normalizeBingPayload(payload, "Importados");
    assert.strictEqual(result.stats.duplicatesRemoved, 1);
    assert.strictEqual(result.collections[1].items.length, 1);
    assert.strictEqual(result.collections[1].items[0].title, "Primera");
  });

  it("un type desconocido cae a page", () => {
    const payload = {
      rootName: "Raíz",
      collections: [
        {
          name: "Raíz",
          items: [{ title: "X", url: "https://x.example.com", type: "heading" }],
        },
      ],
      skipped: 0,
    };
    const result = normalizeBingPayload(payload, "Importados");
    assert.strictEqual(result.collections[0].items[0].type, "page");
  });

  it("payload nulo (WRONG_PAGE) devuelve un resultado vacío", () => {
    const result = normalizeBingPayload(null, "Importados");
    assert.deepEqual(result, {
      collections: [],
      stats: { collections: 0, items: 0, skipped: 0, duplicatesRemoved: 0 },
    });
  });
});
