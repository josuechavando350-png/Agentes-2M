# SEMAR para investigación comercial y venta

La primera entrega utilizable por un comprador es un auditor local de notas de crédito. El comprador puede revisar un archivo, encontrar por fila qué ventas respaldan las cancelaciones y verificar el certificado sin enviar sus registros a un servidor. La tecnología también admite herramientas aprendidas por la fábrica. El nicho definitivo sigue abierto.

## Qué se ha demostrado

| Pregunta | Prueba | Resultado |
| --- | --- | --- |
| ¿Entrega una herramienta utilizable? | Producto con importación de CSV, exportación, verificador y búsqueda por factura. Examen de UCI Online Retail con 541,909 filas de origen y 24,329 filas admitidas. | En 90 días de búsqueda, 34,577 unidades canceladas quedaron sin respaldo observable, por GBP 59,672.75. La consulta simple reutilizaba 654 unidades. |
| ¿Distingue un hallazgo individual de una diferencia compartida? | 8,539 notas contrastadas con tres cálculos de flujo por nota. | GBP 44,863.00 correspondían a diferencias individualmente inevitables con ventana completa. GBP 14,140.56 correspondían a notas cercanas al inicio del archivo y GBP 669.19 a diferencias compartidas por notas. |
| ¿Investiga una discrepancia nueva mejor que la regla existente? | Dos periodos reservados de Iowa, 200 facturas por periodo. Se sellaron las decisiones antes de abrir los importes. | 397 aciertos sobre 400 frente a 398 del precio declarado. Se mantuvo el método anterior. En 13 de 16 errores ya conocidos, al menos una explicación rival reconstruyó el importe histórico. La factura original sigue siendo necesaria para confirmar la causa. |
| ¿Cien millones compran más información? | Historial aleatorizado Hillstrom. 16,000 clientes para ajustar, 10,000 para buscar, 14,000 para seleccionar y 24,000 para examinar una sola vez. | Los 100 millones de contribuciones reprodujeron todos los puntajes de un cálculo exacto de un trabajador. Diez mil reglas produjeron 9,005 series distintas de decisiones en los clientes de búsqueda. Se conservó la oferta uniforme. |
| ¿Mejoró el resultado comercial de esa campaña? | Diferencias de gasto por cliente en el grupo de examen. | Oferta seleccionada frente a ausencia de contacto, +USD 0.40 por cliente, intervalo aproximado del 95 % desde −USD 0.07 hasta +USD 0.87. Frente al método simple, diferencia cero. |
| ¿Generó ventas propias? | El libro distingue propuesta, pedido, recuperación confirmada, comisión devengada, dinero recibido, devoluciones y margen. | La entrega incluye una demostración contable y exámenes con datos públicos. La medición de ingresos propios necesita un piloto con cliente, costos y extracto verificables. |

[Resultados de conciliación](../evidence/sale-retail.json) · [Registro de partidas](../evidence/sale-register.json) · [Iowa](../evidence/sale-iowa.json) · [Campaña](../evidence/sale-hillstrom.json) · [Tiempos de ejecución](../evidence/sale-throughput.json)

## Probar el producto

```sh
npm ci
npm run setup
npm test
npm run sale:product -- entrega-ventas
node entrega-ventas/credit-cli.mjs audit entrega-ventas/ejemplo.json
node entrega-ventas/credit-cli.mjs check entrega-ventas/ejemplo.json entrega-ventas/certificado.json
npm run sale:demo
```

La carpeta exportada contiene el programa, ejemplos CSV y JSON, la configuración de columnas, un certificado, una hoja de revisión y las huellas del contenido. La persona que recibe esa carpeta solo necesita Node 24 para usarla. [Manual del auditor](auditor-creditos.md)

## Convertir una investigación en una venta

1. El titular de tesorería registra el mandato `open`, la moneda, presupuesto y plazo máximo de 168 horas. Para `LIVE`, incluye en `commercialAuthority` la clave pública Ed25519 del verificador de titulares. El verificador acredita la cuenta de conciliación y la identidad y grupo empresarial del comprador con `purpose=enrollment`, alcance temporal y huella del original.
2. `sale-account` y `sale-client` inscriben a los participantes. Para la auditoría de notas, `credit-reserve` recibe `scope`, `buyer`, `packet` y `cap`. `global-work` calcula el flujo y su certificado. El costo real del trabajo queda identificado con `settle`. Para herramientas aprendidas, se exige una versión aprobada por el examen y un expediente nuevo del comprador. Una investigación con hipótesis rivales admite `probe-reserve` y `probe-observe`. El nuevo documento debe responder la pregunta autorizada y conservar la familia de procedencia y el costo observado.
3. El comprador firma el alcance con `purpose=brief`, la huella del expediente, la base de los términos y su vencimiento. `sale-offer` calcula la comisión, el precio máximo, el costo y cuánto conserva el comprador. `sale-quote` devuelve la propuesta para revisión. `sale-best` compara hasta 17 ofertas factibles en escenarios declarados, incluido el de cero cobros, y permite conservar caja.
4. El comprador firma `order` o `decline` y, si acepta la entrega, `delivery` con la recuperación comprobada. El custodio del extracto firma `statement` con su fuente, periodo continuo, saldos y movimientos. `sale-bank` comprueba la aritmética y cada devolución contra su cobro. Un depósito pendiente de asignación mantiene abierto el margen. `sale-assign` admite una distribución firmada entre entregas y aportaciones, conservando el importe original.
5. `sale-close` registra horas, tarifa y fecha de corte. El informe deduce costos de servicio, investigación conciliada y gastos comunes. Un nuevo extracto vuelve a exigir el cierre de horas. Las operaciones que aumentan compromisos necesitan presupuesto; las conciliaciones permanecen disponibles después de agotarlo. La firma acredita qué clave respaldó cada hecho. La comprobación de titularidad de las claves y de autenticidad de los documentos originales corresponde a las partes.
6. `sale-readiness` cruza los cierres con un ensayo aleatorizado registrado por adelantado. Cada comprador debe tener una asignación aplicada, un grupo independiente y un cierre que coincida en cobros, devoluciones, costos y horas. El seguimiento sin oferta puede presentar `sale-activity` con firma del comprador y los gastos bancarios correspondientes. `sale-portfolio` comprueba varios mandatos, descarta movimientos duplicados o cortes superpuestos y exige repetición en otro periodo y con otros compradores antes de calificar un efecto como replicado.

Cada orden de tesorería se firma como `SEMAR-GLOBAL-1`. Las atestaciones externas usan `SEMAR-SALE-1`, el mismo identificador de libro y una clave distinta según el papel. Los programas que firmaron la decisión se conservan en la bitácora para reproducirla. El archivo de datos del piloto y las claves privadas permanecen bajo control de sus titulares. [Libro y firmas](operacion-global.md) · [Ejemplo ejecutable de pedidos, cobro y devolución](../scripts/sale/pilot.mjs) · [Mandato con expediente histórico](../scripts/sale/credit-mission.mjs)

```sh
node scripts/global/sign.mjs clave-propia.pem documento.json > firmado.json
SEMAR_DB=operacion.sqlite node src/cli.mjs global-command orden-de-tesoreria-firmada.json
SEMAR_DB=operacion.sqlite node src/cli.mjs sale-report LIVE
SEMAR_DB=operacion.sqlite node src/cli.mjs sale-readiness LIVE
node src/cli.mjs sale-portfolio libros.json
```

`libros.json` contiene `{"paths":["semana1.sqlite","semana2.sqlite"],"mode":"LIVE"}`. Para comprobar la bitácora de una base concreta se usa `global-audit`. Las comisiones se expresan en unidades monetarias mínimas. El informe distingue montos en esa moneda y el gasto histórico por cliente del experimento.

## Cómo operan los 100 millones

Los diez sectores reparten los clientes de búsqueda y las reglas de oferta. Cada fundador participante tiene una sola tarea identificable mediante su ID, acción y contribución aritmética. Los diez sellos se calculan sobre todas esas contribuciones. El cálculo comprimido suma tablas por pares de variables y obtiene exactamente el mismo vector. `sale-search` usa el censo local para emitir los recibos. `sale-route` obtiene la misma receta, decisiones y sello de examen en un solo trabajador. `sale-agent` permite reconstruir la participación de un ID y recalcular si su sustitución por el control cambiaría la regla ganadora.

```sh
SEMAR_DB=padron.sqlite node src/cli.mjs sale-search paquete.json > poblacion.json
node src/cli.mjs sale-route paquete.json > comprimido.json
node src/cli.mjs sale-agent poblacion.json paquete.json 100000000 1000000
node src/cli.mjs sale-grade poblacion.json clientes-reservados.json desenlaces.json SELLO
node src/cli.mjs sale-recommend comprimido.json clientes-nuevos.json HUELLA_RECETA
```

Para el ensayo de latencia se prepararon las mismas filas y reglas de antemano. Se repitieron las siete configuraciones 31 veces en orden rotativo. Las mediciones incluyen la preparación de la entrada nativa y su transporte al proceso. Los resultados de ventas requieren observación posterior. [Receta y comando de medición](../scripts/sale/throughput.mjs)

## Fuentes y compromisos anteriores al examen

Hillstrom es un ensayo histórico con tres tratamientos de correo equiprobables. SEMAR usó los atributos previos al contacto. Los costos de contacto declarados en este examen son cero; el margen del comercio depende de costos ausentes en la fuente. Las diferencias por cliente usan la probabilidad conocida de asignación, ajuste de respuesta entrenado en otros clientes y contrastes pareados. Los límites de selección entre escalas usan un multiplicador 2.74. [Descripción del autor](https://blog.minethatdata.com/2008/03/minethatdata-e-mail-analytics-and-data.html) · [Decisiones selladas](https://github.com/josuechavando350-png/Agentes-2M/blob/667e737175d07cd90ce0d1ca6624be60bf9203d8/evidence/sale-seal.json)

Los datos de Iowa proceden de la revisión fijada del espejo público de Iowa Liquor Sales. Para cada factura se toman referencias del mismo producto, de fechas estrictamente anteriores y a lo sumo 21 días atrás. Se excluye el indicador derivado del importe objetivo. [Repositorio de datos](https://github.com/gatewaycat/iowa-liquor-sales2/tree/1ee2a06e0d9d0f470607f89417acaaec6bd43607) · [Compromiso de los dos periodos](https://github.com/josuechavando350-png/Agentes-2M/blob/50ba99e3f8070dfea321817e63e6aa3622db649d/evidence/sale-diagnostic-seal.json)

Daqing Chen publicó Online Retail bajo CC BY 4.0. La adaptación convierte ventas y cancelaciones a cantidades, precios en peniques y grupos de conciliación. El informe de admisión cuenta las exclusiones y cada partida conserva su fila original. [Datos y licencia de UCI](https://doi.org/10.24432/C5BW33)
