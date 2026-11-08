# Operar en SSB

*English: band plan in [src/modes/README.md](../../src/modes/README.md).*

Necesitas rol `operator` u `owner`. Los `listener` solo pueden escuchar.

## Sintonizar

- Pulsa el modo **USB**. Frecuencia por defecto de bajada: 10489,700 MHz.
- Haz clic en el espectro o usa las flechas del teclado (con Mayúsculas, ×10). El paso se ajusta a 100 Hz en USB.
- El panel muestra la frecuencia de bajada y la de subida (subida = bajada − 8089,5 MHz). La inversión de banda del transpondedor no está modelada: **verifica en el aire**.
- Segmento SSB del plan: 10489,650–10489,990 MHz (sin verificar con el plan actual; confirma con AMSAT-DL/IARU).

## Transmitir

1. Pulsa **Listen** y comprueba que hay canal libre. Escucha antes de llamar.
2. Pulsa **Arm TX**: solicitas el turno. Si otro operador lo tiene verás «busy». Solo uno puede transmitir a la vez.
3. Permite el micrófono en el navegador (hace falta HTTPS o `localhost`).
4. **Mantén pulsado PTT** (o la barra espaciadora) para hablar; suéltalo para recibir. El medidor muestra el nivel; un limitador evita la sobremodulación, pero ajusta la ganancia del micrófono para no llegar al máximo.
5. El temporizador TOT cuenta atrás (600 s por defecto) y corta solo.
6. Pulsa **Disarm** al terminar para liberar el turno. Si cierras la pestaña o pierdes la conexión, la portadora se corta en menos de 2 s.

No se puede cambiar de modo ni sintonía de TX mientras transmites: el cambio se aplica al soltar.

## Buenas prácticas

- Potencia mínima: tu señal en bajada no debe superar a la baliza.
- Nada de portadoras fijas ni de CW o digital en el segmento de SSB.
- Anota el contacto en [el registro](log-lotw-qrz.md).
