import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("el instalador portable incluye el script y la extension", () => {
  const zip = path.join(root, "release", "instalador-colecciones.zip");
  assert.ok(existsSync(zip), "debe existir release/instalador-colecciones.zip");
  const ps = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${zip}');`,
    "$names=@($z.Entries | ForEach-Object { $_.FullName.Replace('\\','/') });",
    "$z.Dispose();",
    "$names -join '|'",
  ].join(" ");
  const names = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim().split("|");
  for (const file of [
    "install.ps1",
    "install.cmd",
    "LEEME.txt",
    "extension/manifest.json",
    "extension/background.js",
    "extension/icons/icon128.png",
  ]) {
    assert.ok(names.includes(file), `${file} debe estar en el instalador portable`);
  }
});

test("el instalador detecta Edge, Chrome, Brave, Vivaldi y Opera", () => {
  const browsers = ["edge", "chrome", "brave", "vivaldi", "opera"];
  for (const file of ["tools/installer/install.ps1", "tools/installer/Installer.cs"]) {
    const text = readFileSync(path.join(root, file), "utf8").toLowerCase();
    for (const browser of browsers) {
      assert.ok(text.includes(browser), `${file} debe detectar ${browser}`);
    }
    for (const scheme of browsers.map((b) => `${b}://extensions`)) {
      assert.ok(text.includes(scheme), `${file} debe abrir ${scheme}`);
    }
  }
});

test("existe el ejecutable autodescriptivo", () => {
  const exe = path.join(root, "release", "instala-colecciones.exe");
  assert.ok(existsSync(exe), "debe existir release/instala-colecciones.exe");
  assert.ok(statSync(exe).size > 50000, "el EXE debe incluir la extension empaquetada");
});
