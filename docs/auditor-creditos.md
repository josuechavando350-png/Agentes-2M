# Auditor local de notas de crédito

Esta herramienta concilia cantidades de una nota de crédito con unidades vendidas anteriormente al mismo comprador, del mismo producto y al mismo precio. Entrega una asignación concreta y una prueba independiente del máximo que permite respaldar el archivo. Cuando varias cancelaciones compiten por las mismas unidades, se puede consultar cuánto es posible y cuánto está garantizado para una partida concreta.

## Ejecutar con Node 24

```sh
node credit-cli.mjs audit ejemplo.json nuevo-certificado.json
node credit-cli.mjs check ejemplo.json nuevo-certificado.json
node credit-cli.mjs explain ejemplo.json credito-b
```

El ejemplo contiene ocho unidades vendidas y diez canceladas. Las dos unidades restantes requieren más documentación. Para la última cancelación de seis unidades, diferentes asignaciones igualmente válidas permiten respaldar entre cuatro y seis.

## Importar el archivo del comprador

`ejemplo.csv` y `columnas.json` muestran el formato. En la configuración se indican los nombres de las ocho columnas, la moneda, el periodo, el separador y el signo decimal. La importación exige fechas UTC, precios con hasta dos decimales y una sola moneda. Si una fila contiene un error, corrígela en el origen y vuelve a importar. La huella SHA-256 identifica los bytes exactos del CSV recibido.

```sh
node credit-cli.mjs import mi-exportacion.csv columnas.json expediente-nuevo.json
node credit-cli.mjs audit expediente-nuevo.json prueba-nueva.json
node credit-cli.mjs check expediente-nuevo.json prueba-nueva.json
node credit-cli.mjs register expediente-nuevo.json revision-nueva.csv
```

La hoja de revisión ordena las notas por el importe que queda sin respaldo aun bajo su asignación más favorable. `minBacked` y `maxBacked` delimitan qué puede atribuirse a cada nota entre todas las asignaciones óptimas. `leftCensored` indica que parte del plazo de búsqueda precede al comienzo del archivo. Una diferencia compartida por varias notas puede quedar indeterminada por partida. El informe global conserva esa diferencia y la hoja permite solicitar el documento original. Los importes se expresan en centavos de la moneda declarada.

## Elegir las facturas de un turno

`queue` calcula qué facturas conviene pedir con el tiempo del comprador. Se declara el tiempo inicial por cuenta, el de abrir cada factura, el costo por fila, el total de minutos, los plazos de conciliación y si hace falta historial completo. Los valores son supuestos de trabajo que el comprador debe ajustar. El programa agrupa las filas del mismo documento y evita cobrar dos veces el tiempo inicial de una cuenta. Elige el mayor importe individual por documentar que se mantiene en todas las ventanas declaradas. Dos cálculos independientes comprueban la selección y su costo mínimo.

```sh
node credit-cli.mjs queue expediente-nuevo.json turno.json plan-nuevo.json
node credit-cli.mjs queue-check expediente-nuevo.json turno.json plan-nuevo.json
```

La entrega incluye un segundo ejemplo, `ejemplo-turno.csv`. Una segunda empresa canceló tres unidades de MXN 50 sin una venta observable. Con el turno incluido, la factura NOTA-C permite revisar MXN 150 en nueve minutos. El resultado se reproduce con `node credit-cli.mjs queue-check expediente-turno.json turno.json cola.json`.

El plan muestra las facturas, las filas originales, los minutos y el volumen documental. Con datos históricos y un turno hipotético de una hora, seis facturas concentraban GBP 27,038.58 por revisar. Solicitar primero las facturas de mayor valor nominal cubría GBP 26,167.90 con los mismos límites. La recuperación requiere originales y confirmación del comprador.

## Formato de entrada

Un expediente JSON contiene `source` (SHA-256 del archivo fuente), `currency` (código de tres letras), `from` y `until` (instantes UTC en milisegundos, final excluido), `maxAgeDays` y `lines`. Cada partida lleva `id`, `party`, `sku`, `price` en unidades monetarias mínimas, `qty` entera positiva para ventas o negativa para cancelaciones, `time`, `invoice` y `row` en el original. Deben ser únicos el identificador y la fila. La huella y las filas sirven para localizar la evidencia. El operador prepara los datos a partir del original autorizado.

El algoritmo consume primero las unidades elegibles más antiguas. Solo relaciona ventas estrictamente anteriores a la cancelación, incluida la fecha inicial de la ventana. El verificador comprueba que ninguna unidad se utilizó dos veces. Para demostrar que la asignación es máxima, comprueba una cobertura de ventas y cancelaciones cuya capacidad total coincide exactamente con el flujo asignado.

El archivo puede empezar después de algunas ventas y una operación real puede admitir descuentos, otros plazos o cambios de referencia. Una diferencia identifica una partida que necesita revisión documental. Un ingreso propio exige contrato y cobro conciliado. El producto se ejecuta localmente con Node, con los archivos de la entrega y sin servicios externos.
