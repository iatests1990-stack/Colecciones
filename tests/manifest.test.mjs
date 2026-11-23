import { describe, it } from "node:test";
import { strict as assert } from "node:assert/strict";
import * as fs from "node:fs";

describe("Manifest validation", () => {
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

  it("manifest_version must be 3", () => {
    assert.strictEqual(manifest.manifest_version, 3);
  });

  it("permissions must contain all required permissions", () => {
    const required = [
      "sidePanel",
      "storage",
      "contextMenus",
      "commands",
      "scripting",
      "offscreen",
      "downloads",
      "unlimitedStorage",
    ];
    for (const perm of required) {
      assert.ok(manifest.permissions.includes(perm), `Missing permission: ${perm}`);
    }
  });

  it("host_permissions must contain <all_urls>", () => {
    assert.ok(manifest.host_permissions.includes("<all_urls>"));
  });

  it("side_panel.default_path must be 'sidepanel/panel.html'", () => {
    assert.strictEqual(manifest.side_panel.default_path, "sidepanel/panel.html");
  });

  it("background.service_worker must be 'background.js'", () => {
    assert.strictEqual(manifest.background.service_worker, "background.js");
  });

  it("commands['open-panel'].suggested_key.default must be 'Ctrl+Shift+Y'", () => {
    assert.strictEqual(
      manifest.commands["open-panel"].suggested_key.default,
      "Ctrl+Shift+Y"
    );
  });

  it("declara action para que Chrome acepte los comandos de acción", () => {
    assert.equal(manifest.action.default_title, "Colecciones");
    assert.equal(manifest.action.default_icon["16"], "icons/icon16.png");
  });

  it("commands['_execute_action'].suggested_key.default must be 'Alt+Shift+C'", () => {
    assert.equal(
      manifest.commands["_execute_action"].suggested_key.default,
      "Alt+Shift+C"
    );
  });

  it("commands['quick-save'].suggested_key.default must be 'Ctrl+Shift+S'", () => {
    assert.strictEqual(
      manifest.commands["quick-save"].suggested_key.default,
      "Ctrl+Shift+S"
    );
  });

  it("registra el content script del atajo alternativo en todas las páginas", () => {
    assert.ok(
      manifest.content_scripts.some(
        (cs) =>
          cs.js.includes("content/shortcuts.js") &&
          cs.matches.includes("<all_urls>")
      )
    );
  });

  it("minimum_chrome_version must be 114", () => {
    assert.strictEqual(manifest.minimum_chrome_version, "114");
  });

  it("package.json must be marked private", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    assert.strictEqual(pkg.private, true);
  });
});