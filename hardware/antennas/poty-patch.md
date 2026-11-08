# Feed dual-band tipo POTY (patch) para QO-100

El concepto **POTY** ("Patch Of The Year") es un feed de parche de doble banda que ilumina el mismo plato en 2,4 GHz (TX, polarización circular a derechas) y en 10,489 GHz (RX): un parche de banda 2,4 GHz y, por encima o integrado, un parche pequeño o una transición para 10 GHz, de modo que una sola unidad sustituye al helix y al LNB separados. Se popularizó entre los radioaficionados de QO-100 por su sencillez de construcción con circuito impreso estándar.

## Autoría y diseño original

El diseño original no es de BricoHams: pertenece a sus autores en la comunidad QO-100 (el nombre y las publicaciones oficiales se encuentran en las páginas de referencia de AMSAT-DL y de la comunidad, y en el wiki del BATC). **No copiamos sus dibujos ni sus cotas**: descarga siempre los ficheros (Gerber, planos y notas de montaje) de la fuente original y respeta su licencia.

Dónde buscar el diseño original y sus autores:

- Wiki del BATC sobre QO-100 / Es'hail-2: `https://eshail.batc.org.uk/` (portal de la comunidad, enlaces a feeds y pointing).
- Documentación de AMSAT-DL sobre el transpondedor y los feeds.
- Entradas con `QO100` en los blogs de la lista de `docs/references/ea5en/urls.txt` (p. ej. el curso EA5EN lo cita como feed combinado RX/TX en las diapositivas de sistemas completos).

**Verificar:** busca el nombre exacto del diseño y del autor en esas fuentes antes de citar; no los hemos copiado aquí porque no han sido comprobados en este repositorio.

## Qué aportan las piezas de BricoHams

- [patch_feed_spacers.scad](../3d/scad/patch_feed_spacers.scad): separadores M3 (por defecto 3,0 y 5,0 mm) para apilar las placas con los huecos de aire del diseño que construyas; cambia `heights` por las alturas reales.
- [lnb_clamp_40mm.scad](../3d/scad/lnb_clamp_40mm.scad): si el feed va junto a un LNB.

## Ventajas e inconvenientes frente al helix

| | Helix | Patch dual (POTY) |
|---|---|---|
| Construcción | Hilo y piezas impresas; sin PCB | Requiere PCB y soldadura de precisión |
| Ajuste | Mecánico, tolerante | Más sensible a tolerancias de PCB y espaciadores |
| Un solo foco para RX y TX | No (LNB aparte) | Sí |
| Referencia | [helix-2g4.md](helix-2g4.md) | Diseño original citado arriba |

## Precaución

Ajusta la altura de cada capa con calibres y comprueba ROE en 2,4 GHz y polarización (RHCP) antes de radiar; nunca radies sin comprobación en carga ficticia y con la zona del feed libre de personas.
