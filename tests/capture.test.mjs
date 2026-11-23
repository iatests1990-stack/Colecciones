import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import {
  pickThumbnail,
  thumbnailCandidates,
  buildCapturedItem,
  createSerializedQueue,
} from "../lib/capture.js";

describe("pickThumbnail", () => {
  it("prioriza ogImage, luego firstImage, luego favicon; null si no hay nada", () => {
    const og = "https://cdn.example.com/og.png";
    const first = "https://img.example.com/first.jpg";
    const fav = "https://site.example.com/favicon.ico";

    assert.equal(pickThumbnail({ ogImage: og, firstImage: first, favicon: fav }), og);
    assert.equal(pickThumbnail({ firstImage: first, favicon: fav }), first);
    assert.equal(pickThumbnail({ favicon: fav }), fav);
    assert.equal(pickThumbnail({}), null);
  });

  it("ignora URLs relativas y data: (incluso grandes); solo devuelve http(s) absoluta", () => {
    const bigData = "data:image/png;base64," + "A".repeat(8192);
    const abs = "https://img.example.com/ok.jpg";

    assert.equal(
      pickThumbnail({ ogImage: "/images/og.png", firstImage: "images/x.jpg", favicon: abs }),
      abs
    );
    assert.equal(
      pickThumbnail({ ogImage: bigData, firstImage: "//cdn.example.com/rel.png", favicon: abs }),
      abs
    );
    assert.equal(pickThumbnail({ ogImage: "ftp://x.example.com/a.png" }), null);
    assert.equal(pickThumbnail({ ogImage: "javascript:alert(1)" }), null);
    assert.equal(pickThumbnail({ ogImage: "  " + abs + "  " }), abs);
  });
});

describe("thumbnailCandidates", () => {
  it("devuelve miniatura rota -> favicon -> ninguna, sin data: ni esquemas peligrosos", () => {
    const item = {
      thumbnailUrl: "https://cdn.example.com/caducada.jpg",
      faviconUrl: "https://site.example.com/favicon.ico",
    };
    assert.deepEqual(thumbnailCandidates(item), [
      "https://cdn.example.com/caducada.jpg",
      "https://site.example.com/favicon.ico",
    ]);

    assert.deepEqual(
      thumbnailCandidates({
        thumbnailUrl: "javascript:alert(1)",
        faviconUrl: "https://site.example.com/favicon.ico",
      }),
      ["https://site.example.com/favicon.ico"]
    );

    assert.deepEqual(
      thumbnailCandidates({ thumbnailUrl: "data:image/png;base64,AAAA" }),
      []
    );
  });

  it("conserva thumbnailData local como último recurso para el panel", () => {
    const data = "data:image/png;base64,AAAA";
    assert.deepEqual(thumbnailCandidates({ thumbnailData: data }), [data]);
  });
});

describe("buildCapturedItem", () => {
  it("ogImage cross-origin -> thumbnailUrl, nunca thumbnailData (Review Focus #3)", () => {
    const og = "https://other-origin.example.com/og.jpg";
    const item = buildCapturedItem({
      url: "https://page.example.com/article",
      title: "Artículo",
      ogImage: og,
      favicon: "https://page.example.com/favicon.ico",
    });

    assert.equal(item.thumbnailUrl, og);
    assert.ok(
      !("thumbnailData" in item),
      "buildCapturedItem nunca debe generar thumbnailData"
    );
    assert.equal(item.type, "page");
    assert.equal(item.title, "Artículo");
    assert.equal(item.url, "https://page.example.com/article");
  });

  it("selection -> type 'text' con el texto seleccionado", () => {
    const item = buildCapturedItem({
      url: "https://page.example.com/article",
      title: "Artículo",
      selection: "  Un fragmento seleccionado  ",
    });

    assert.equal(item.type, "text");
    assert.equal(item.text, "Un fragmento seleccionado");
    assert.equal(item.sourceUrl, "https://page.example.com/article");
  });

  it("imageUrl -> type 'image' y sirve como miniatura", () => {
    const imageUrl = "https://media.example.com/foto.png";
    const item = buildCapturedItem({
      url: "https://page.example.com/article",
      title: "Foto",
      imageUrl,
    });

    assert.equal(item.type, "image");
    assert.equal(item.url, imageUrl);
    assert.equal(item.thumbnailUrl, imageUrl);
  });

  it("linkUrl sin selección ni imagen -> type 'link'", () => {
    const linkUrl = "https://target.example.com/link";
    const item = buildCapturedItem({
      url: "https://page.example.com/article",
      title: "Enlace",
      linkUrl,
    });

    assert.equal(item.type, "link");
    assert.equal(item.url, linkUrl);
    assert.equal(item.sourceUrl, "https://page.example.com/article");
  });
});

describe("createSerializedQueue", () => {
  it("tareas solapadas se ejecutan estrictamente en serie y devuelven sus resultados", async () => {
    const cola = createSerializedQueue();
    let activas = 0;
    let maxActivas = 0;

    async function tarea(valor, retardo) {
      activas += 1;
      maxActivas = Math.max(maxActivas, activas);
      await new Promise((resolver) => setTimeout(resolver, retardo));
      activas -= 1;
      return valor;
    }

    const resultados = await Promise.all([
      cola(() => tarea("A", 15)),
      cola(() => tarea("B", 1)),
      cola(() => tarea("C", 1)),
    ]);

    assert.deepEqual(resultados, ["A", "B", "C"]);
    assert.equal(maxActivas, 1, "Ninguna tarea debió solaparse con otra");
    assert.equal(activas, 0);
  });

  it("un rechazo no rompe la cola: la tarea siguiente se ejecuta igual", async () => {
    const cola = createSerializedQueue();
    const ejecutadas = [];

    const resultados = await Promise.allSettled([
      cola(async () => {
        throw new Error("Fallo de prueba");
      }),
      cola(async () => {
        ejecutadas.push("después");
        return "ok";
      }),
    ]);

    assert.equal(resultados[0].status, "rejected");
    assert.equal(resultados[1].status, "fulfilled");
    assert.deepEqual(ejecutadas, ["después"]);
  });
});
