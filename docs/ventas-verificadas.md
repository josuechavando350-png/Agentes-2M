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
| ¿Identifica más suscripciones con una lista limitada? | UCI Bank Marketing, 9,188 contactos posteriores reservados y 1,837 plazas. | La regla elegida identificó 527 suscripciones, las mismas que el mejor control sencillo. El sorteo uniforme por bloques esperaba 517.49. |
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

1. El titular de tesorería registra el mandato `open`, la moneda, presupuesto y plazo máximo de 168 horas. Para `LIVE`, fija `commercialBudget` en `bank-outlays-v1` e incluye en `commercialAuthority` la clave pública Ed25519 del verificador de titulares. El verificador acredita la cuenta de conciliación y la identidad y grupo empresarial del comprador con `purpose=enrollment`, alcance temporal y huella del original.
2. `sale-account` y `sale-client` inscriben a los participantes. Para la auditoría de notas, `credit-reserve` recibe `scope`, `buyer`, `packet` y `cap`. `global-work` calcula el flujo y su certificado. El costo real del trabajo queda identificado con `settle`. Para herramientas aprendidas, se exige una versión aprobada por el examen y un expediente nuevo del comprador. Una investigación con hipótesis rivales admite `probe-reserve` y `probe-observe`. El nuevo documento debe responder la pregunta autorizada y conservar la familia de procedencia y el costo observado.
3. El comprador firma el alcance con `purpose=brief`, la huella del expediente, la base de los términos y su vencimiento. `sale-offer` calcula la comisión, el precio máximo, el costo y cuánto conserva el comprador. `sale-quote` devuelve la propuesta para revisión. `sale-best` compara hasta 17 ofertas factibles en escenarios declarados, incluido el de cero cobros, y permite conservar caja.
4. El comprador firma `order` o `decline` y, si acepta la entrega, `delivery` con la recuperación comprobada. El custodio del extracto firma `statement` con su fuente, periodo continuo, saldos y movimientos. `sale-bank` comprueba la aritmética y cada devolución contra su cobro. Un depósito pendiente de asignación mantiene abierto el margen. `sale-assign` admite una distribución firmada entre entregas y aportaciones, conservando el importe original.
5. `sale-close` registra horas, tarifa y fecha de corte. El informe deduce costos de servicio, investigación conciliada y gastos comunes. Un nuevo extracto vuelve a exigir el cierre de horas. El presupuesto descuenta trabajos liquidados y egresos bancarios comerciales posteriores a la apertura. Los pedidos aceptados comparten el disponible entre cuentas. Un extracto que lleva el presupuesto a cero retira todas las identidades del mandato, aunque después aparezca un depósito. Las conciliaciones y devoluciones siguen disponibles y se informa cualquier sobregiro observado. La firma acredita qué clave respaldó cada hecho. La comprobación de titularidad de las claves y de autenticidad de los documentos originales corresponde a las partes.
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

## Qué evidencia hace falta para calificar una venta

`node src/cli.mjs sale-scorecard` muestra los cuatro resultados con sus denominadores y los controles que vencieron o conservaron su lugar. Con `sale-scorecard libros.json` añade el resultado de tus mandatos. Un libro ausente produce una medición pendiente. Los exámenes históricos se conservan por separado de los ingresos documentados.

Una venta propia con margen requiere que la comisión aceptada coincida con el dinero recibido y que se hayan asentado las horas, los reembolsos y los costos directos y comunes. La comparación entre métodos exige además que coincidan las referencias, fechas e importes de cada movimiento del ensayo con el banco. Una prueba de aleatorización por pares contrasta la suma de las diferencias de margen en centavos con las asignaciones posibles. Con importes muy grandes calcula cotas para la probabilidad y exige que la superior respete el nivel fijado. Un resultado se puede replicar entre dos mandatos, con compradores independientes y documentos examinados.

`sale-design` calcula cuántos pares caben en el presupuesto y la probabilidad de superar el examen de signos bajo tasas de empate y victoria **supuestas**. Por ejemplo, un archivo de diseño puede contener:

```json
{"alphaDenominator":20,"eligibleIndependentBuyers":80,"winBps":7500,"tieBps":1000,"powerBps":8000,"costPerPairCents":500,"minutesPerPair":20,"budgetCents":20000,"minutes":800}
```

Para cotejar un extracto original se conservan localmente los archivos con su huella SHA-256 como nombre. El perfil relaciona las columnas del banco con la referencia, hora ISO UTC con milisegundos, importe firmado, moneda y cuenta. Se admiten centavos enteros o decimales explícitos con dos dígitos. Para un expediente JSON de herramienta aprendida se comprueba su huella canónica. Una fuente ausente o contradictoria deja el resultado pendiente y el informe devuelve su huella.

```json
{"directory":"./comprobantes","bank":{"cuenta":{"delimiter":",","amountFormat":"minor","columns":{"reference":"folio","at":"fecha","amount":"importe","currency":"moneda","account":"cuenta"}}}}
```

```sh
SEMAR_DB=operacion.sqlite node src/cli.mjs sale-proof LIVE perfil.json
node src/cli.mjs sale-design diseno.json
node src/cli.mjs sale-scorecard libros.json
```

En `libros.json`, `originals` relaciona cada ruta de base con su perfil de comprobantes. Se puede probar todo el recorrido con firmas y archivos temporales usando `node scripts/sale/field-acceptance.mjs`. Ese examen cubre dos mandatos, doce pares aleatorizados y los veinticuatro cierres de comprador. [Cálculo de potencia y contraste de margen](../src/sale/experiment.mjs) · [Examen de integración](../scripts/sale/field-acceptance.mjs)

La comprobación de réplica contrasta todos los grupos empresariales y todos los firmantes inscritos en ambos ensayos, incluidos los compradores del grupo de control. Un mismo extracto con movimientos o una misma prueba de recuperación en dos semanas impide sumar los cierres. Las distribuciones internas de un abono se conservan ligadas al movimiento original.

## Priorizar prospectos autorizados

El entrenamiento usa cuatro periodos sucesivos del archivo de UCI Bank Marketing. El primero ajusta modelos, el segundo elige entre 37 tablas sencillas y tres conjuntos de árboles, el tercero calibra las probabilidades y el cuarto queda reservado para la calificación. Se usan atributos del contexto de contacto disponibles antes de conocer el desenlace. El producto admite una lista proporcionada por su titular y un cupo de revisión.

```sh
python3 scripts/sale/prospects.py bank-marketing.zip ensayo-prospectos
node scripts/sale/prospect-exam.mjs freeze ensayo-prospectos > compromiso.json
node scripts/sale/prospect-exam.mjs grade ensayo-prospectos evidence/sale-prospect-seal.json
node src/cli.mjs sale-prospects ensayo-prospectos/frozen.json autorizados.json HUELLA_RECETA 20
```

El último comando recibe filas con `id` y `x` en el orden de la receta. La predicción refiere a un resultado histórico condicional al contacto. Entre las 1,837 plazas reservadas, la tabla de día de la semana y la política seleccionada incluyeron los mismos 527 contratos. Como análisis secundario se calculó la distribución de una lista uniforme con el mismo cupo por bloque, con esperanza de 517.49 y un intervalo central del 95 % de 487 a 548. El archivo carece de grupo sin contacto y de identificadores estables de personas. El efecto sobre ventas propias requiere observación prospectiva. [Datos y licencia de UCI](https://doi.org/10.24432/C5K306) · [Compromiso anterior al examen](https://github.com/josuechavando350-png/Agentes-2M/blob/65b7d75ddf25e9ba60fc4881c04411f33895744b/evidence/sale-prospect-seal.json) · [Resultados](../evidence/sale-prospects.json)

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

Un segundo programa en JavaScript recorrió el padrón publicado y reconstruyó los diez sellos de las contribuciones calculadas en C++. Una revisión posterior del transporte binario obtuvo una mediana de 323 ms en diez hilos emitiendo recibos individuales, 59 ms en diez hilos calculando solo puntajes y 33 ms con la agregación exacta de un trabajador. El examen de cada configuración incluye 31 mediciones. [Comprobación por sector](../evidence/sale-participation.json) · [Medición con transporte binario](../evidence/sale-throughput-packed.json)

Para atender consultas locales repetidas, `sale-compile` prepara una tabla para una receta sellada y `sale-stream` lee un comprador en JSON por línea de entrada estándar. Cada respuesta incluye el sello y el alcance del soporte. Una combinación nueva requiere más evidencia cuando escasean ejemplos de los que dependen las decisiones. La referencia y la candidata pueden agrupar observaciones que siempre conducen a la misma decisión por construcción. El modo `observed-cell` exige soporte en la combinación completa de atributos. Una característica fuera del rango del ajuste produce abstención. Proponer la misma oferta del examen histórico a una persona nueva requiere todavía validar su pertinencia en ese negocio. [Prueba con 24,000 entradas y tiempos por consulta](../evidence/sale-serving.json)

```sh
node src/cli.mjs sale-compile poblacion.json paquete.json HUELLA_RECETA 8 policy-inputs > modelo-local.json
node src/cli.mjs sale-stream modelo-local.json SELLO_MODELO < nuevos-clientes.jsonl
node scripts/sale/participants.mjs DIRECTORIO_ENSAYO DIRECTORIO_PADRON evidence/sale-hillstrom.json 100000000
```

## Fuentes y compromisos anteriores al examen

Hillstrom es un ensayo histórico con tres tratamientos de correo equiprobables. SEMAR usó los atributos previos al contacto. Los costos de contacto declarados en este examen son cero; el margen del comercio depende de costos ausentes en la fuente. Las diferencias por cliente usan la probabilidad conocida de asignación, ajuste de respuesta entrenado en otros clientes y contrastes pareados. Los límites de selección entre escalas usan un multiplicador 2.74. [Descripción del autor](https://blog.minethatdata.com/2008/03/minethatdata-e-mail-analytics-and-data.html) · [Decisiones selladas](https://github.com/josuechavando350-png/Agentes-2M/blob/667e737175d07cd90ce0d1ca6624be60bf9203d8/evidence/sale-seal.json)

Los datos de Iowa proceden de la revisión fijada del espejo público de Iowa Liquor Sales. Para cada factura se toman referencias del mismo producto, de fechas estrictamente anteriores y a lo sumo 21 días atrás. Se excluye el indicador derivado del importe objetivo. [Repositorio de datos](https://github.com/gatewaycat/iowa-liquor-sales2/tree/1ee2a06e0d9d0f470607f89417acaaec6bd43607) · [Compromiso de los dos periodos](https://github.com/josuechavando350-png/Agentes-2M/blob/50ba99e3f8070dfea321817e63e6aa3622db649d/evidence/sale-diagnostic-seal.json)

Daqing Chen publicó Online Retail bajo CC BY 4.0. La adaptación convierte ventas y cancelaciones a cantidades, precios en peniques y grupos de conciliación. El informe de admisión cuenta las exclusiones y cada partida conserva su fila original. [Datos y licencia de UCI](https://doi.org/10.24432/C5BW33)
