# Diseño: icono de la extensión Colecciones

Fecha: 2026-11-23. Cambio pequeño.

## Intención y motivo

La extensión está a punto de publicarse en Microsoft Edge Add-ons. Los iconos
declarados en el manifest existen y se incluyen en el ZIP, pero los cuatro
archivos son un cuadrado liso de color `#0F6CBD` y el logo de 300×300 de la
ficha es ese mismo cuadrado ampliado. El usuario quiere un icono
**representativo**, con un señalador (cinta de marcador) como idea directriz,
para que se reconozca de un vistazo tanto en la barra de herramientas de Edge
como en la tienda.

## Objetivos

- Que el icono comunique «guardar para volver» y «colección».
- Que siga siendo reconocible a 16×16 px en la barra del navegador.
- Que sirva también como logo de 300×300 en la ficha de Edge Add-ons.
- Mantener el azul actual `#0F6CBD` como color base.

## No objetivos

- Cambiar el nombre, la descripción ni el comportamiento de la extensión.
- Rediseñar el panel lateral ni las capturas de la tienda.
- Publicar en Chrome Web Store.

## Anti-objetivos

- Un degradado o detalle fino que desaparezca al reducirlo a 16 px.
- Un icono genérico de «marcadores» indistinguible de otras extensiones.

## Restricciones

- Manifest V3; `manifest.json` ya declara `icons` y `action.default_icon` con
  `icons/icon16.png`, `icon32.png`, `icon48.png` e `icon128.png`.
- El paquete publicado es `release/colecciones-1.0.zip`; cualquier cambio en
  los iconos exige regenerarlo y recalcular su SHA256.
- El repositorio público no debe incluir datos personales.

## Enfoques considerados

| Opción | Trade-off |
| --- | --- |
| A. Cinta de marcador sobre tarjeta redondeada | Representa a la vez «guardado» y «colección»; legible a 16 px si la cinta es ancha y el contraste alto. Es la elegida. |
| B. Alfiler / pin | Muy claro como «guardar aquí» y legible a 16 px, pero dice poco de «colección» y es muy común. |
| C. Pila de tarjetas con cinta | Representa mejor muchos elementos guardados, pero a 16 px se pierde el detalle. |

El usuario eligió la opción **A** (cinta de marcador) y después pidió
explícitamente usar esta imagen como icono:
`https://images.icon-icons.com/10442/PNG/512/530189_bookmark_ve0eff7d145.png`

## Diseño acordado (actualizado)

- Forma: marcador azul con degradado y muesca inferior, sobre fondo
  transparente, procedente de la imagen indicada por el usuario.
- La imagen fuente (512×512) se guarda en `tools/bookmark-source.png` para que
  el generador sea reproducible sin red.
- El generador escala esa fuente con interpolación bicúbica de alta calidad.
- Mismos archivos de destino: `icons/icon16.png`, `icon32.png`,
  `icon48.png`, `icon128.png`, más `release/logo-300.png` para la tienda.

## Lo que queda al implementador

- Generar los cinco PNG con el mismo diseño, escalado limpio y fondo
  transparente o azul según convenga al tamaño.
- Sustituir los archivos actuales y regenerar `release/colecciones-1.0.zip`.
- Recalcular y documentar el SHA256 del ZIP.
- Ejecutar la batería de tests (debe seguir en verde) y hacer commit.
