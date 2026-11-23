import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const zip = path.join(root, "release", "colecciones-1.0.zip");

test("el ZIP de release contiene los iconos actuales y el manifest", () => {
  const ps = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${zip}');`,
    "$names=@($z.Entries | ForEach-Object { $_.FullName.Replace('\\','/') });",
    "'manifest.json','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png' | ForEach-Object {",
    "  $name=$_; if ($name -notin $names) { \"$name=MISSING\"; return }",
    "  $entry=$z.Entries | Where-Object { $_.FullName.Replace('\\','/') -eq $name } | Select-Object -First 1;",
    "  $stream=$entry.Open(); $ms=New-Object System.IO.MemoryStream; $stream.CopyTo($ms); $stream.Dispose();",
    "  $bytes=$ms.ToArray(); $ms.Dispose();",
    "  $file=[IO.File]::ReadAllBytes('" + root.replace(/\\/g, "\\\\") + "\\' + $name.Replace('/','\\'));",
    "  \"$name=$([Linq.Enumerable]::SequenceEqual([byte[]]$bytes,[byte[]]$file))\"",
    "};",
    "$z.Dispose()",
  ].join(" ");

  const output = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim();
  const results = Object.fromEntries(output.split(/\r?\n/).map((line) => line.split("=")));
  for (const [name, value] of Object.entries(results)) {
    assert.equal(value, "True", `${name} no coincide con el archivo del repositorio`);
  }
  assert.equal(Object.keys(results).length, 5);
});
