import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import { toMarkdown, toHtml, toLinkList } from "../lib/render.js";

// Dos colecciones con un page, un note y un image.
const collections = [
  {
    name: "Colección 1",
    items: [
      { type: "page", title: "Google", url: "https://google.com" },
      { type: "page", title: "GitHub", url: "https://github.com" },
    ],
  },
  {
    name: "Colección 2",
    items: [
      { type: "note", title: "Mis notas", text: "Esta es una nota de prueba" },
      { type: "image", title: "Imagen", url: "https://example.com/image.png", thumbnailUrl: "https://example.com/thumb.png" },
    ],
  },
];

describe("toMarkdown", () => {
  it("contiene ## por colección", () => {
    const md = toMarkdown(collections);
    assert.ok(md.includes("## Colección 1"));
    assert.ok(md.includes("## Colección 2"));
  });

  it("usa [Título](URL) para páginas", () => {
    const md = toMarkdown(collections);
    assert.ok(md.includes("[Google](https://google.com)"));
    assert.ok(md.includes("[GitHub](https://github.com)"));
  });

  it("incluye el texto de la nota", () => {
    const md = toMarkdown(collections);
    assert.ok(md.includes("Mis notas"));
    assert.ok(md.includes("Esta es una nota de prueba"));
  });
});

describe("toHtml", () => {
  it("comienza con <!DOCTYPE html>", () => {
    const html = toHtml(collections);
    assert.strictEqual(html.startsWith("<!DOCTYPE html>"), true);
  });

  it("es autocontenido (sin src='http)", () => {
    const html = toHtml(collections);
    assert.ok(!html.includes('src="http') && !html.includes('src="https'));
  });

  it("escapa <script> en títulos", () => {
    const collectionsWithScript = [
      {
        name: "Test",
        items: [
          { type: "page", title: "<script>alert('xss')</script>", url: "https://example.com" },
        ],
      },
    ];
    const html = toHtml(collectionsWithScript);
    // <script> literal debe estar escapado, no debe aparecer
    assert.ok(!html.includes("<script>"));
    // Debe aparecer la versión escapada
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("incluye enlaces <a href=", () => {
    const html = toHtml(collections);
    assert.ok(html.includes('<a href='));
  });

  it("neutraliza URLs javascript: en href (defense-in-depth)", () => {
    const malicious = [
      {
        name: "Test",
        items: [
          { type: "page", title: "Malicioso", url: "javascript:alert(1)" },
          { type: "page", title: "Normal", url: "https://example.com/ok" },
        ],
      },
    ];
    const html = toHtml(malicious);
    // No debe emitir un href ejecutable javascript:
    assert.ok(!html.includes('href="javascript:'));
    assert.ok(!html.includes("javascript:"));
    // El enlace peligroso se neutraliza a '#'
    assert.ok(html.includes('href="#"'));
    // Las URLs https normales siguen generando enlaces correctos
    assert.ok(html.includes('<a href="https://example.com/ok">'));
  });
});

describe("toLinkList", () => {
  it("devuelve una línea por URL con formato Título — URL", () => {
    const list = toLinkList(collections);
    const lines = list.split("\n");
    assert.ok(lines.some((l) => l.includes("Google — https://google.com")));
    assert.ok(lines.some((l) => l.includes("GitHub — https://github.com")));
  });

  it("no incluye notas", () => {
    const list = toLinkList(collections);
    assert.ok(!list.includes("Mis notas"));
  });

  it("incluye imágenes con su título y URL", () => {
    const list = toLinkList(collections);
    assert.ok(list.includes("Imagen — https://example.com/image.png"));
  });
});

describe("ordenación de ítems por order", () => {
  const orderedCollection = [
    {
      name: "Ordenada",
      items: [
        { type: "page", title: "Tercero", url: "https://c.example.com", order: 2 },
        { type: "page", title: "Primero", url: "https://a.example.com", order: 0 },
        { type: "page", title: "Segundo", url: "https://b.example.com", order: 1 },
      ],
    },
  ];

  it("toMarkdown emite los ítems en orden por order", () => {
    const md = toMarkdown(orderedCollection);
    const pos = (t) => md.indexOf(`[${t}]`);
    assert.ok(pos("Primero") < pos("Segundo"));
    assert.ok(pos("Segundo") < pos("Tercero"));
  });

  it("toHtml emite los ítems en orden por order", () => {
    const html = toHtml(orderedCollection);
    const pos = (t) => html.indexOf(`>${t}</a>`);
    assert.ok(pos("Primero") < pos("Segundo"));
    assert.ok(pos("Segundo") < pos("Tercero"));
  });

  it("toLinkList emite los ítems en orden por order", () => {
    const list = toLinkList(orderedCollection);
    assert.deepEqual(list.split("\n"), [
      "Primero — https://a.example.com",
      "Segundo — https://b.example.com",
      "Tercero — https://c.example.com",
    ]);
  });

  it("los ítems sin order conservan su posición original", () => {
    const mixed = [
      {
        name: "Mixta",
        items: [
          { type: "page", title: "FijoA", url: "https://fija-a.example.com" },
          { type: "page", title: "Tercero", url: "https://c.example.com", order: 2 },
          { type: "page", title: "FijoB", url: "https://fija-b.example.com" },
          { type: "page", title: "Primero", url: "https://a.example.com", order: 0 },
          { type: "page", title: "Segundo", url: "https://b.example.com", order: 1 },
        ],
      },
    ];
    assert.deepEqual(toLinkList(mixed).split("\n"), [
      "FijoA — https://fija-a.example.com",
      "Primero — https://a.example.com",
      "FijoB — https://fija-b.example.com",
      "Segundo — https://b.example.com",
      "Tercero — https://c.example.com",
    ]);
  });

  it("no muta las colecciones ni el array de entrada", () => {
    const before = JSON.stringify(orderedCollection);
    toMarkdown(orderedCollection);
    toHtml(orderedCollection);
    toLinkList(orderedCollection);
    assert.strictEqual(JSON.stringify(orderedCollection), before);
    assert.strictEqual(orderedCollection[0].items[0].title, "Tercero");
  });
});