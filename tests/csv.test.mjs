import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { parseCsv, mapEdgeCsv } from "../lib/csv.js";

describe("CSV Parser - parseCsv", () => {
  it("ignora BOM al inicio del texto", () => {
    const text = "\uFEFFCollection,Title,URL\nA,B,C";
    const rows = parseCsv(text);
    assert.strictEqual(rows[0][0], "Collection");
  });

  it("respeta comillas dobles escapadas (\"\" ) -> A,\"B\"\"C\",D es [\"A\",\"B\\\"C\",\"D\"]", () => {
    const text = 'A,"B""C",D';
    const rows = parseCsv(text);
    assert.deepEqual(rows[0], ['A', 'B"C', 'D']);
  });

  it("no produce filas vacías finales", () => {
    const text = "Collection,Title,URL\nA,B,C\n\n";
    const rows = parseCsv(text);
    assert.strictEqual(rows.length, 2);
  });

  it("con \\r\\n y \\r sueltos produce el mismo número de filas", () => {
    const textCRLF = "Collection,Title,URL\r\nA,B,C\r\nD,E,F";
    const textLFPure = "Collection,Title,URL\nA,B,C\nD,E,F";
    assert.strictEqual(parseCsv(textCRLF).length, parseCsv(textLFPure).length);
  });

  it("analiza comilla con delimitador incrustado: A,\"B,C\",D -> 3 campos", () => {
    const rows = parseCsv('A,"B,C",D');
    assert.deepEqual(rows[0], ['A', 'B,C', 'D']);
  });

  it("detecta un solo delimitador desde la primera línea (coma literal con ';' como delimitador)", () => {
    const rows = parseCsv('a;b,c;d');
    assert.deepEqual(rows[0], ['a', 'b,c', 'd']);
  });

  it("dos filas con salto de línea dentro de comilla producen dos filas", () => {
    const text = 'C1;"Reading\nlist";https://x.com\nC2;Title2;https://y.com';
    const rows = parseCsv(text);
    assert.strictEqual(rows.length, 2);
    assert.deepEqual(rows[0], ['C1', 'Reading\nlist', 'https://x.com']);
    assert.deepEqual(rows[1], ['C2', 'Title2', 'https://y.com']);
  });
});

describe("CSV Mapper - mapEdgeCsv", async () => {
  const fs = await import("node:fs");
  const csvPrincipal = await fs.promises.readFile(
    "D:/Mis Programas/Colecciones/.worktrees/collections-extension/fixtures/collections_export.sample.csv",
    "utf-8"
  );
  const csvVariantes = await fs.promises.readFile(
    "D:/Mis Programas/Colecciones/.worktrees/collections-extension/fixtures/csv_variants.sample.csv",
    "utf-8"
  );

  it("fixture principal: 3 colecciones, 6 páginas, skipped === 0, primer ítem tiene title 'Tokyo neighborhood guide'", async () => {
    const result = mapEdgeCsv(csvPrincipal, "Default");
    assert.strictEqual(result.stats.collections, 3);
    assert.strictEqual(result.stats.pages, 6);
    assert.strictEqual(result.stats.skipped, 0);
    assert.strictEqual(result.collections[0].items[0].type, "page");
    assert.strictEqual(result.collections[0].items[0].title, "Tokyo neighborhood guide");
    assert.strictEqual(result.collections[0].items[0].url, "https://www.example.com/tokyo-guide");
  });

  it("fixture variantes: detecta ';', título con coma, y título con salto de línea", async () => {
    // ';' detected: header is parsed into exactly 3 fields
    assert.deepEqual(parseCsv(csvVariantes)[0], ['Collection', 'Title', 'URL']);

    const result = mapEdgeCsv(csvVariantes, "Variants");
    assert.strictEqual(result.stats.collections, 3);
    assert.strictEqual(result.stats.pages, 3);
    assert.strictEqual(result.stats.skipped, 0);

    const allItems = result.collections.flatMap(c => c.items);
    // Comma preserved inside quoted title
    assert.ok(allItems.some(i =>
      i.title === 'Tokyo, Japan travel guide' && i.url === 'https://www.example.com/japan'
    ), 'Falta el ítem con título "Tokyo, Japan travel guide" y su URL');
    assert.ok(allItems.some(i =>
      i.title === 'Home, office setup' && i.url === 'https://www.example.com/home'
    ), 'Falta el ítem con título "Home, office setup" y su URL');
    // Embedded newline preserved inside quoted title
    assert.ok(allItems.some(i =>
      i.title === 'Reading\nlist' && i.url === 'https://www.example.com/reading'
    ), 'Falta el ítem con título "Reading\\nlist" y su URL');
  });

  it("sin cabecera y 3 columnas usa [colección, título, URL]", async () => {
    const csvText = "Coleccion,Titulo,URL\nColeccionA,Pagina1,https://a.com\nColeccionB,Pagina2,https://b.com";
    const result = mapEdgeCsv(csvText, "Fallback");
    assert.strictEqual(result.stats.collections, 2);
    assert.strictEqual(result.stats.pages, 2);
    assert.strictEqual(result.collections[0].name, 'ColeccionA');
    assert.strictEqual(result.collections[1].name, 'ColeccionB');
  });

  it("con una fila sin URL tiene stats.skipped === 1", async () => {
    const csvText = "Collection,Title,URL\nA,Pagina1,https://a.com\nB,,";
    const result = mapEdgeCsv(csvText, "Fallback");
    assert.strictEqual(result.stats.skipped, 1);
  });

  it("todos los ítems tienen type === 'page' y ninguno contiene text ni image", async () => {
    const result = mapEdgeCsv(csvPrincipal, "Default");
    for (const col of result.collections) {
      for (const item of col.items) {
        assert.strictEqual(item.type, "page");
        assert.ok(!("text" in item) || item.text === undefined, "item should not have text field");
        assert.ok(!("image" in item) || item.image === undefined, "item should not have image field");
      }
    }
  });

  it("comilla con delimitador incrustado en CSV principal", async () => {
    const csvText = 'Collection,Title,URL\nC1,"Tokyo, Japan guide",https://example.com/tokyo';
    const result = mapEdgeCsv(csvText, "Default");
    assert.strictEqual(result.stats.collections, 1);
    assert.strictEqual(result.stats.pages, 1);
    assert.strictEqual(result.collections[0].items[0].title, "Tokyo, Japan guide");
    assert.strictEqual(result.collections[0].items[0].url, "https://example.com/tokyo");
  });

  it("varios saltos de línea dentro de comilla en variante", async () => {
    const result = mapEdgeCsv(csvVariantes, "Variants");
    const hasNewlineTitle = result.collections.some(col =>
      col.items.some(item => item.title === 'Reading\nlist')
    );
    assert.ok(hasNewlineTitle, 'Expected an item with title "Reading\\nlist"');
  });

  it("colección con nombre vacío se agrupa bajo fallbackName y cuenta en stats.pages", async () => {
    const csvText = 'Collection,Title,URL\n,Pagina1,https://a.com';
    const result = mapEdgeCsv(csvText, "MyFallback");
    assert.strictEqual(result.stats.collections, 1);
    assert.strictEqual(result.stats.pages, 1);
    assert.strictEqual(result.collections[0].name, "MyFallback");
  });
});