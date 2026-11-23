import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sizes = [16, 32, 48, 128];

function pngSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} debe ser PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function sample(file, points) {
  const ps = [
    "Add-Type -AssemblyName System.Drawing;",
    `$b=[System.Drawing.Bitmap]::FromFile('${file}');`,
    ...points.map(([x, y]) => `$p=$b.GetPixel([int]($b.Width*${x}),[int]($b.Height*${y})); "$($p.A),$($p.R),$($p.G),$($p.B)";`),
    "$b.Dispose()",
  ].join(" ");
  const output = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim();
  return output.split(/\r?\n/).map((line) => line.split(",").map(Number));
}

test("los iconos declarados existen con sus dimensiones exactas", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  for (const size of sizes) {
    assert.equal(manifest.icons[String(size)], `icons/icon${size}.png`);
    assert.deepEqual(pngSize(path.join(root, "icons", `icon${size}.png`)), {
      width: size,
      height: size,
    });
  }
  assert.deepEqual(pngSize(path.join(root, "release", "logo-300.png")), {
    width: 300,
    height: 300,
  });
});

test("los iconos reproducen el marcador azul con muesca y fondo transparente", () => {
  for (const size of sizes) {
    const file = path.join(root, "icons", `icon${size}.png`);
    const [center, lower, corner] = sample(file, [
      [0.5, 0.4],
      [0.5, 0.82],
      [0.1, 0.1],
    ]);
    assert.equal(center[0], 255, `icono ${size}: el centro del marcador es opaco`);
    assert.ok(center[3] > 200 && center[2] > 90 && center[1] < 110, `icono ${size}: azul del marcador`);
    assert.ok(lower[0] < 200, `icono ${size}: la muesca inferior es transparente`);
    assert.ok(corner[0] < 200, `icono ${size}: las esquinas son transparentes`);
  }
  const logo = path.join(root, "release", "logo-300.png");
  const [center, lower] = sample(logo, [
    [0.5, 0.4],
    [0.5, 0.82],
  ]);
  assert.equal(center[0], 255, "logo 300: centro opaco");
  assert.ok(lower[0] < 200, "logo 300: muesca inferior transparente");
});
