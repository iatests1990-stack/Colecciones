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

function iconColors(file) {
  const ps = [
    "Add-Type -AssemblyName System.Drawing;",
    `$b=[System.Drawing.Bitmap]::FromFile('${file}');`,
    "$a=$b.GetPixel([int]($b.Width*0.5),[int]($b.Height*0.4));",
    "$c=$b.GetPixel([int]($b.Width*0.5),[int]($b.Height*0.82));",
    "\"$($a.R.ToString('X2'))$($a.G.ToString('X2'))$($a.B.ToString('X2')),$($c.R.ToString('X2'))$($c.G.ToString('X2'))$($c.B.ToString('X2'))\";",
    "$b.Dispose()",
  ].join(" ");
  return execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim();
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

test("los iconos muestran la tarjeta azul y la cinta de marcador clara", () => {
  for (const size of sizes) {
    const [card, ribbon] = iconColors(path.join(root, "icons", `icon${size}.png`)).split(",");
    assert.equal(card, "0F6CBD", `icono ${size}: color de la tarjeta`);
    assert.equal(ribbon, "69B1E8", `icono ${size}: color de la cinta`);
  }
  const [card, ribbon] = iconColors(path.join(root, "release", "logo-300.png")).split(",");
  assert.equal(card, "0F6CBD", "logo 300: color de la tarjeta");
  assert.equal(ribbon, "69B1E8", "logo 300: color de la cinta");
});
