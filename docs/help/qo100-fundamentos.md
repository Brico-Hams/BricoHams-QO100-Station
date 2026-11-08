# Fundamentos de QO-100

*Para empezar sin experiencia previa. Resumen con palabras propias basado en el Curso Iniciación QO-100 de EA5EN Mateo (ver [referencias](../references/ea5en/README.md)). Las cifras del curso son orientativas; el contraste con BricoHams está al final.*

## 1. El satélite

Fuente: Curso Iniciación QO-100, EA5EN Mateo (diapositivas 4 y 5).

- Es el primer satélite **geoestacionario** para radioaficionados: está a unos 35 780 km sobre el ecuador y siempre en la misma posición del cielo, **25,8° Este**, así que la parábola se apunta una vez y se olvida.
- Su nombre oficial es Es'hail-2. Se lanzó en noviembre de 2018 con un Falcon 9 y entró en servicio en abril de 2019. Participan AMSAT-DL y QARS (Qatar); los centros de control están en Doha y Bochum.
- Lleva dos transpondedores de aficionados: **NB** (banda estrecha, SSB y CW) y **WB** (banda ancha, unos 8 MHz, pensado para vídeo digital DATV). Funciona como «tubo doblado» (*bent pipe*): recibe y retransmite sin demodular.
- Subida en **2,4 GHz** (banda S) y bajada en **10 GHz** (banda X). BricoHams solo cubre el NB.

| | Subida (TX) | Bajada (RX) |
|---|---|---|
| NB | 2400,000–2400,500 MHz, polarización circular a derechas (**RHCP**) | 10489,500–10490,000 MHz, polarización lineal **vertical** |
| WB (no soportado por BricoHams) | 2401,500–2409,500 MHz aprox., RHCP | 10491,000–10499,000 MHz aprox., lineal **horizontal** |

Los márgenes del WB no están en las diapositivas de texto: confírmalos en el plan de bandas oficial.

### Normas de buen uso (diapositiva 8)

- Mantén tu señal **por debajo del nivel de la baliza**. Si saturas el transpondedor, el sistema LEILA envía un aviso para que bajes la potencia.
- En NB, máximo 2,7 kHz de ancho: no FM ni modos digitales anchos.
- No transmitas fuera de las balizas (ni por debajo de la CW inferior ni por encima de la superior) y deja libre la banda de guarda alrededor de ellas.
- El **dúplex completo** es obligatorio: debes oír tu propia bajada mientras transmites.
- La baliza central es BPSK de 400 bit/s con telemetría, y las balizas las genera la estación terrestre con referencia GPS: por eso son una buena referencia de frecuencia.

### Seguridad (diapositiva 9)

El curso avisa de dos riesgos: la fijación mecánica de la parábola (el viento) y la **radiación de RF**. Con 5 W a 2,4 GHz y una parábola de 80 cm la potencia radiada equivalente ronda el kilovatio, así que nadie debe estar delante de la antena de TX. Un medidor de radiación ayuda a fijar la distancia de seguridad.

## 2. Plan de bandas (NB)

El curso lo muestra como imagen (diapositiva 7). El plan que usa BricoHams (CW, digital y SSB, con la baliza central en 10489,750 MHz) está en [operar-ssb.md](operar-ssb.md), [operar-cw.md](operar-cw.md) y [operar-digitales.md](operar-digitales.md) y se marca como pendiente de confirmar con el plan oficial.

## 3. El LNB y su oscilador local

El LNB baja los 10 GHz a una **frecuencia intermedia (FI)** que sí llega por cable a tu SDR (diapositivas 14 y 18):

```
FI = frecuencia de bajada − LO
```

Los LNB «universales» para televisión que se usan para RX (Octagon, Bullseye, Televes…) tienen LO de **9750 MHz**.

| Frecuencia de bajada | Cálculo con LO = 9750 MHz | FI |
|---|---|---|
| Baliza CW inferior | 10489,500 − 9750 | 739,500 MHz |
| **Baliza BPSK central** | 10489,750 − 9750 | **739,750 MHz** |
| Baliza CW superior | 10490,000 − 9750 | 740,000 MHz |

Todo el NB queda, pues, entre 739,5 y 740,0 MHz. Un RTL-SDR u otro SDR de banda ancha lo recibe directamente.

### LO que no es exactamente 9750 MHz

Los LNB baratos usan un cristal sin termostato: el LO real difiere de 9750 MHz en kHz o más y **deriva con la temperatura**. Si el LO real es `9750 + δ`, todo aparece desplazado `−δ` en la FI: la baliza central se ve en `739,750 − δ`. El curso propone obtener el LO real con la baliza (diapositivas 14 y 15):

1. Busca a mano la baliza en la FI.
2. LO real = frecuencia de bajada de la baliza − FI observada. Ejemplo: baliza vista en 739,720 MHz, LO real = 10489,750 − 739,720 = 9750,030 MHz.
3. Introduce ese valor en el programa de recepción (en SDR Console, mediante un convertidor).

### Cómo lo resuelve BricoHams

- `station.lnbLoHz` es tu LO aproximado (por defecto 9 750 000 000 Hz). Con él la baliza debería caer cerca de 739,750 MHz; si el LO real es muy distinto, ajústalo a mano para acercarla.
- El módulo de baliza mide dónde ve realmente el pico (por defecto busca en ±10 kHz alrededor de lo esperado) y calcula la **deriva** en Hz. Esa corrección se aplica de forma continua a la recepción, de modo que las señales no se mueven aunque el LNB se caliente o se enfríe.
- La corrección en TX es opcional (`station.applyCorrectionToTx`, por defecto desactivada): solo tiene sentido si el transmisor comparte la referencia del receptor.

## 4. Apuntar la parábola desde España

Fuente: Curso Iniciación QO-100, EA5EN Mateo (diapositivas 11 a 15).

**Tres variables:** azimut, elevación y giro de polarización (*skew*), más el LO del LNB. El curso recomienda este orden:

1. Mirar el LO aproximado del LNB (si no lo sabes, 9750 MHz) y buscar la baliza.
2. Calcular azimut, elevación y offset de polarización con una herramienta (Satlex, DishPointer, el apuntador del BATC) y poner la elevación aproximada con la escala de la parábola o un inclinómetro.
3. Montar parábola y LNB en un mástil **a nivel**, con el azimut flojo, y orientarlo con una brújula o con las referencias de los programas.
4. Conectar el SDR, introducir el LO en el programa y sintonizar la baliza de CW: se debería ver y oír débil.
5. Ajustar **azimut y elevación alternativamente** sobre la baliza hasta el máximo.
6. Girar el LNB (polarización) hasta la mejor relación señal/ruido.

La diapositiva 11 señala que QO-100 queda a 25,8° E, más al este que Astra 19,2° E (la diapositiva lo compara también con Hispasat, 30° O), y que el giro de polarización ronda los **30°**.

**Valores aproximados** (cálculo propio para satélite geoestacionario a 25,8° E; ¡verifícalos con las herramientas anteriores y mide con la baliza!). El azimut es respecto al norte geográfico, hacia el sureste. Las parábolas offset apuntan con el plato más vertical de lo que indica la elevación real: lee la escala o inclinómetro del fabricante.

| Ciudad (aprox.) | Azimut | Elevación | Giro de polarización |
|---|---|---|---|
| Murcia (38° N, 1,4° O) | ≈ 140° | ≈ 37° | ≈ 30° |
| Madrid (40,4° N, 3,7° O) | ≈ 139° | ≈ 34° | ≈ 30° |

El sentido del giro depende del LNB y del lado desde el que lo mires; el curso lo ajusta por relación señal/ruido, no por fórmula.

**Tamaño del plato (diapositivas 6 y 10):** en zonas con buena cobertura bastan **60 a 80 cm**; el curso da ganancias de unos 34,6 dBi (60 cm) a 42,5 dBi (150 cm), unos 2 dB más por cada paso. Una parábola offset suele rendir más que una de foco primario del mismo diámetro (diapositivas 11 y 12).

## 5. Cadena de recepción (diapositiva 40)

```
Parábola + LNB (10 GHz) → coaxial de TV de 75 Ω → bias-T (alimenta el LNB) → SDR → USB → PC (FI ≈ 739 MHz)
```

- Un **bias-T** envía corriente continua al LNB por el mismo coaxial. Según el curso, 12–14 V seleccionan la polarización **vertical** (la del NB) y 16–18 V la horizontal (WB y DATV) (diapositiva 19). Algunos SDR (por ejemplo RTL-SDR V4 o ciertos Airspy) lo incluyen.
- Con RTL-SDR en Windows el curso usa el controlador Zadig (diapositivas 33 y 34).
- También cita convertidores comerciales 144/432 MHz con alimentación y referencia de 25 MHz (diapositivas 20 y 21).

## 6. Cadena de transmisión

Fuente: Curso Iniciación QO-100, EA5EN Mateo (diapositivas 23 a 30 y 41 a 47).

```
Transmisor (IC-705, Pluto, HackRF…) → up-converter a 2,4 GHz → amplificador de 2,4 GHz → hélice o parche RHCP
```

- **Up-converters** citados: HiDes BU500 (500 mW), SG-Labs (2,5 W, con entrada de referencia), DXPatrol (con entrada de 10 MHz), entre otros. Convierten una señal de 28, 144, 432 o 1200 MHz a 2,4 GHz.
- **SDR directo**: ADALM-Pluto (o LimeSDR) más amplificadores de Wi-Fi en serie. El Pluto da pocos mW y su oscilador deriva mucho (±25 ppm según la diapositiva 25), por lo que aquí el **GPSDO** es todavía más importante.
- **Amplificadores**: modelos de 2,4 GHz de 1 W a 12 W y la modificación de un amplificador Wi-Fi barato (EDUP) hasta unos 2,5 W (diapositiva 29). Es un montaje delicado: mide siempre con carga ficticia.
- **Antena TX**: hélice de varias vueltas (hay ejemplos de 18,8 dBi y de 4 vueltas) o parche, siempre **RHCP**. Puede ser una antena independiente o compartir parábola con el LNB (diapositiva 44).
- **Cableado**: conectores SMA, BNC o N y cable de baja pérdida tipo Aircell 7 o mejor, lo más corto posible; evita PL y RG-58 (diapositiva 24).

## 7. El GPSDO

Fuente: Curso Iniciación QO-100, EA5EN Mateo (diapositiva 30).

Un GPSDO es un oscilador de 10 MHz disciplinado por GPS. El curso lo considera **fundamental para FT8 y FT4**, porque estos modos exigen que la frecuencia de TX no se mueva unos pocos hercios. Sirve de reloj común para el up-converter y, opcionalmente, para el LNB o el SDR. Con un GPSDO compartido por TX y RX, la corrección de baliza en TX deja de ser necesaria; sin él, vigila tu propia subida.

## 8. Costes orientativos del curso

Cifras sueltas, de épocas distintas y sin garantía; úsalas solo como orden de magnitud.

| Elemento | Orden de magnitud (curso) |
|---|---|
| SDR de recepción | 30–300 USD (diapositiva 40); receptores comerciales de unos 45 a 435 € (diapositiva 22) |
| Bias-T | 5–15 USD |
| LNB Bullseye | ≈ 30 USD |
| Parábola | 80–120 USD (mínimo recomendado 80 cm; más de 1 m mejora las señales débiles) |
| Soporte | 30–120 USD |
| Transmisores y up-converters | unos 140–230 € (diapositivas 25 y 30) |
| GPSDO | ≈ 66–160 € (diapositiva 30) |

## Frecuencias de referencia y discrepancias con el curso

| Tema | Curso | BricoHams | Qué hacer |
|---|---|---|---|
| Baliza de CW para encontrar el LO | 10489,550 MHz → 739,550 MHz (diapositiva 14) | Balizas de CW en 10489,500 y 10490,000 MHz; BPSK central en 10489,750 MHz | Con LO 9750 la baliza de CW inferior es 739,500 MHz. Toma 10489,500 como referencia y usa el curso solo como método. |
| Enlace de ejemplo al receptor de EA5EN | `#freq=739805800` en el curso; el enlace público actual usa `740100000` | NB = FI 739,500–740,000 MHz con LO 9750 | 740,100 MHz queda fuera del NB con LO 9750: su receptor usa su propio LO. Compara balizas, no frecuencias absolutas. |
| Polarización de subida | RHCP (el texto de la diapositiva 6 mezcla «vertical» y «RHCP» en la subida) | No configurable | Subida **RHCP** y bajada NB **vertical**. |
| Búsqueda de la baliza | LO a mano, sin límite explícito | El estimador busca solo ±10 kHz | Si el LNB está más desviado, corrige `station.lnbLoHz` primero. |
| Relación subida/bajada | No la da | Subida = bajada − 8089,5 MHz (sin modelar la inversión de banda) | Verificar con el [checklist](../testing/CHECKLIST.md). |
| Bias-T / polarización | 12–14 V vertical, 16–18 V horizontal | BricoHams no controla la tensión del LNB | Alimenta el LNB con el bias-T del SDR o externo. |
| WB/DATV | Explica el hardware | Fuera de alcance (no objetivo) | Solo informativo. |
