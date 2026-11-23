import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("el icono no depende de un asset de Icon-Icons", () => {
  assert.equal(
    existsSync(path.join(root, "tools", "bookmark-source.png")),
    false,
    "el PNG de icon-icons.com debe retirarse del repositorio"
  );
  const generator = readFileSync(path.join(root, "tools", "generate-icons.ps1"), "utf8");
  assert.ok(!/icon-icons\.com/i.test(generator), "el generador no debe referenciar icon-icons.com");
});

test("se incluye la licencia MIT del icono bookmark-fill de Bootstrap Icons", () => {
  const license = path.join(root, "licenses", "BOOTSTRAP-ICONS-LICENSE.txt");
  assert.ok(existsSync(license), "debe incluirse el texto de licencia");
  const text = readFileSync(license, "utf8");
  assert.ok(text.includes("The MIT License (MIT)"));
  assert.ok(text.includes("The Bootstrap Authors"));
});
