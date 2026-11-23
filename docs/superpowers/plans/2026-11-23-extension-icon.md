# Icono de la extensión Colecciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el cuadrado azul liso de los iconos de la extensión por una tarjeta con cinta de marcador, regenerar el ZIP de release y recargar la extensión en Edge.

**Architecture:** Un generador determinista dibuja el mismo diseño con System.Drawing a 16, 32, 48, 128 y 300 px; los PNG resultantes sustituyen a los actualos y se reempaqueta el ZIP. No se toca el código de la extensión ni el manifest.

**Tech Stack:** PowerShell + System.Drawing (Windows), Node `node:test` para las comprobaciones estáticas, `Compress-Archive` para el ZIP.

**Spec:** `docs/superpowers/specs/2026-11-23-extension-icon-design.md`

## Global Constraints

- Imagen fuente: `tools/bookmark-source.png`, marcador azul con degradado y fondo transparente, según el URL indicado por el usuario y el spec actualizado.
- Tamaños: 16, 32, 48, 128 px en `icons/`; 300×300 en `release/logo-300.png`.
- El ZIP debe contener solo `manifest.json`, `background.js`, `sidepanel/`, `content/`, `lib/`, `offscreen/` e `icons/`.
- No se publica en Chrome Web Store; no se suben datos personales al repo público.

## Review Focus

- Icono a 16 px: la cinta debe seguir distinguiéndose; verificación visual en la barra de Edge.
- Fondo y transparencia: los PNG deben conservar el formato correcto y no quedar con un borde blanco; comprobación visual en Edge.
- Coincidencia manifest/archivos: `tests/icon-design.test.mjs` comprueba que los cuatro tamaños declarados existen y tienen las dimensiones exactas.
- Paquete de release: `tests/release.test.mjs` comprueba que el ZIP contiene los cuatro iconos y el manifest, y que los artefactos están versionados.
- Recarga en Edge: pulsar «Volver a cargar» en `edge://extensions` y confirmar con captura que aparece el icono nuevo.

---

### Task 1: Generar los iconos

**Files:**
- Create: `tools/generate-icons.ps1`
- Create: `tests/icons.test.mjs`
- Modify: `icons/icon16.png`, `icons/icon32.png`, `icons/icon48.png`, `icons/icon128.png`
- Modify: `release/logo-300.png`

**Interfaces:**
- Consumes: colores y formas del spec.
- Produces: cinco PNG con el diseño acordado; `tests/icons.test.mjs`.

- [ ] **Step 1: Write the failing test**

`tests/icon-design.test.mjs` comprueba: (1) los cuatro archivos de `icons/` existen y su cabecera PNG declara exactamente 16/32/48/128 px; (2) `release/logo-300.png` declara 300×300; (3) el manifest declara esos cuatro tamaños y el dibujo es el marcador con muesca y fondo transparente.

- [ ] **Step 2: Run test to verify it fails**

Run: `& "C:\Program Files\nodejs\node.exe" --test tests/icons.test.mjs`
Expected: PASS de dimensiones si los archivos actuales ya tienen esos tamaños; por eso añadir además una comprobación de que el ZIP incluye los iconos con el mismo contenido que los archivos actuales (debe fallar antes de regenerarlo).

- [ ] **Step 3: Implement `tools/generate-icons.ps1`**

Escala con System.Drawing (interpolación bicúbica de alta calidad) la imagen `tools/bookmark-source.png` a los cuatro tamaños y al logo de 300 px, conservando la transparencia. Sin texto añadido.

- [ ] **Step 4: Run tests to verify they pass**

Run: `& "C:\Program Files\nodejs\node.exe" --test tests`
Expected: PASS (190 tests anteriores + los nuevos).

- [ ] **Step 5: Commit**

`git add tools/generate-icons.ps1 tools/bookmark-source.png tests/icon-design.test.mjs icons release/logo-300.png`
`git commit -m "feat: use the provided bookmark image as the extension icon"`

### Task 2: Regenerar el ZIP y recargar en Edge

**Files:**
- Modify: `release/colecciones-1.0.zip`
- Modify: `release/README.txt`

**Interfaces:**
- Consumes: los PNG de Task 1.
- Produces: ZIP actualizado con su nuevo SHA256; extensión recargada en Edge.

- [ ] **Step 1: Regenerar el ZIP**

Repite el staging de solo archivos de ejecución y `Compress-Archive` sobre `release/colecciones-1.0.zip`.

- [ ] **Step 2: Actualizar `release/README.txt`**

Escribe el nuevo SHA256 y la misma lista de contenido.

- [ ] **Step 3: Verificar**

Run: `& "C:\Program Files\nodejs\node.exe" --test tests` y listing del ZIP.
Expected: tests en verde; los cuatro iconos dentro del ZIP.

- [ ] **Step 4: Recargar en Edge**

Abrir `edge://extensions`, pulsar «Volver a cargar» en la tarjeta de Colecciones y comprobar con captura que el icono mostrado es la tarjeta con cinta.

- [ ] **Step 5: Commit**

`git add .gitignore release/` (los artefactos de release se versionan explícitamente) y commit de documentación.
