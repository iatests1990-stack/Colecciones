# Cómo instalar Colecciones en el navegador

La extensión es Manifest V3 y necesita un navegador Chromium **114 o superior**.
Está probada en **Microsoft Edge** y **Google Chrome**. En Brave, Vivaldi u
Opera puede cargar, pero el panel lateral depende de que ese navegador
implemente `chrome.sidePanel`.

El instalador copia los archivos a una ruta estable y abre el navegador y la
carpeta, pero **no puede hacer los dos clics finales por ti**: ningún
instalador de usuario puede cargar una extensión sin empaquetar en silencio.

Ruta de instalación: `%LOCALAPPDATA%\Colecciones\Extension`
(por ejemplo, `C:\Users\marco\AppData\Local\Colecciones\Extension`).

---

## Opción A — Ejecutable (recomendado)

1. Copia `release\instala-colecciones.exe` a tu escritorio o descárgalo del repo.
2. **Doble clic**.
3. Si aparece Windows Defender SmartScreen:
   **Más información → Ejecutar de todos modos**. El EXE no está firmado; por eso
   sale el aviso.
4. Aparece un mensaje confirmando la ruta y se abren dos cosas:
   - la página de extensiones del navegador, y
   - una carpeta del Explorador llamada `Extension`.
5. Cierra el mensaje pulsando **Aceptar**.
6. En la página de extensiones, activa **Modo desarrollador** (arriba a la derecha).
7. Pulsa **Cargar desempaquetada** (o *Load unpacked*).
8. En el diálogo de carpetas, pega esta ruta y pulsa **Seleccionar carpeta**:

   ```
   %LOCALAPPDATA%\Colecciones\Extension
   ```

   Si el diálogo no acepta la variable, pega la ruta real que salía en el mensaje
   del instalador (por ejemplo `C:\Users\marco\AppData\Local\Colecciones\Extension`).
9. Debe aparecer la tarjeta **Colecciones 1.0** con el icono del marcador azul.
10. Opcional: fíjala en la barra de herramientas pulsando el icono de
    **extensiones** (rompecabezas) y después el «pin» de Colecciones.

## Opción B — Script portable

1. Extrae `release\instalador-colecciones.zip` en una carpeta.
2. Clic derecho en `install.ps1` → **Ejecutar con PowerShell**.
3. Si Windows lo bloquea, abre PowerShell en esa carpeta y ejecuta:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1"
   ```

4. A partir del paso 4, sigue exactamente los mismos pasos que en la Opción A.

---

## Instalar en Google Chrome (u otro Chromium)

El instalador abre Edge, pero **la carpeta que copia sirve para cualquier
Chromium**. Para usarlo en otro navegador:

1. Ejecuta el EXE o el script para que copie los archivos (aunque abra Edge).
2. Abre la página de extensiones del navegador que quieras:

   | Navegador | Página |
   | --- | --- |
   | Google Chrome | `chrome://extensions` |
   | Brave | `brave://extensions` |
   | Vivaldi | `vivaldi://extensions` |
   | Opera | `opera://extensions` |

3. Activa **Modo desarrollador** y pulsa **Cargar desempaquetada**.
4. Selecciona la misma carpeta `%LOCALAPPDATA%\Colecciones\Extension`.

> En Brave, Vivaldi y Opera el panel lateral puede no aparecer o funcionar de
> forma distinta. Si ocurre, la extensión seguirá instalada, pero esa función
> depende del navegador.

---

## Actualizar la extensión

1. Vuelve a ejecutar el EXE o el script: reemplaza los archivos de la carpeta.
2. En la página de extensiones del navegador, pulsa **Volver a cargar** en la
   tarjeta de Colecciones.
3. Comprueba que sigue apareciendo el icono del marcador.

## Desinstalar

En la página de extensiones, pulsa **Quitar** en la tarjeta de Colecciones.
Puedes borrar la carpeta `%LOCALAPPDATA%\Colecciones\Extension` si ya no la
necesitas. Tus colecciones y notas están en el perfil del navegador, no en esa
carpeta: para conservarlas, exporta antes un JSON desde **⋯ → Exportar → JSON…**.

## Problemas frecuentes

| Síntoma | Solución |
| --- | --- |
| «No se encontró el archivo manifest» al cargar | Seleccionaste otra carpeta. Elige `...\Colecciones\Extension`, la que contiene `manifest.json`. |
| SmartScreen bloquea el EXE | *Más información → Ejecutar de todos modos*. Es un instalador sin firma. |
| PowerShell dice «ejecución de scripts desactivada» | Usa el comando con `-ExecutionPolicy Bypass` indicado arriba. |
| El panel no se abre | Pulsa el icono de la barra de herramientas o usa `Alt+Shift+C`. Puedes reasignar atajos en `edge://extensions/shortcuts`. |
| El icono sigue siendo el antiguo | Pulsa **Volver a cargar** en la tarjeta de la extensión. |
| No aparece la opción «Cargar desempaquetada» | Activa primero **Modo desarrollador**. |
