# Fábrica local de herramientas de SEMAR

La fábrica parte de ejemplos resueltos por un especialista y produce un programa que puede ejecutarse en otro equipo. Incluye un conciliador de movimientos por cuenta, un sintetizador de herramientas de cálculo y un optimizador de procesos con dependencias. Todo el examen y el producto exportado pueden ejecutarse con los sockets de Internet bloqueados.

## Probar la entrega

Desde la raíz del repositorio, después de la preparación habitual de SEMAR con Node 24, ejecuta esta orden. El directorio de salida debe ser nuevo.

```sh
npm run factory:exam -- entrega
node entrega/producto/product-cli.mjs check
node entrega/producto/product-cli.mjs run entrega/expediente.json
node entrega/producto/product-cli.mjs tool reposicion entrega/inventario.json
node entrega/producto/product-cli.mjs plan entrega/proceso.json
```

La primera orden crea un libro de demostración temporal, reserva presupuesto, entrena, sella predicciones, abre respuestas, liquida un gasto de demostración, audita el historial y exporta el producto. Genera expedientes con una semilla nueva. Se puede especificar una semilla como segundo argumento. El examen también compila C++17 en el equipo y exige paridad de resultados. Cada ejecución de «Auditoría SEMAR» publica un archivo descargable llamado `fabrica-semar` con el producto, ejemplos y dictamen. El directorio `producto` es portátil con Node 24. La recalificación nativa requiere un compilador local.

## Las 16 capacidades y sus pruebas

| Capacidad | Comportamiento observable |
|---|---|
| 1. Lectura especializada | Aprende de ejemplos anotados de encabezados y movimientos. Rechaza una asignación ambigua o incompatible. |
| 2. Conciliación entre documentos | Agrupa por cuenta y folio, conserva citas hasta archivo y fila, deduplica copias y señala importes contradictorios. |
| 3. Aprendizaje del criterio de un experto | Infiere condiciones de autorización a partir de secuencias de inspección y decisión. Puede exigir firma y conciliación simultáneas. |
| 4. Preguntas discriminantes | Si dos explicaciones producen los mismos resultados observados, busca un expediente en que difieran y muestra sus dos predicciones. |
| 5. Descubrimiento de reglas | Busca cómo agrupar, aplicar tasas, abonar y ajustar importes. Cada intento registra el primer ejemplo que lo descarta. |
| 6. Cálculo de oportunidades | Devuelve el importe, la cuenta y los movimientos que lo sustentan cuando el expediente permite resolverlo. El cobro requiere su propio comprobante. |
| 7. Razonamiento con faltantes | Calcula extremos alcanzables de registros abiertos. Si cambian la conclusión, identifica qué registro cerrar y muestra dos terminaciones posibles. |
| 8. Refutación independiente | Contrasta la implementación de producción con un intérprete entero independiente y reduce los casos discrepantes. |
| 9. Pruebas de propiedades | Verifica las cotas de representación y la dirección de cada variable para todo el lenguaje de conciliación admitido. |
| 10. Comparación de originalidad | Busca un caso que distinga la propuesta de cada regla registrada. Exige superar al mejor control en los expedientes reservados. |
| 11. Transferencia entre sectores | Fija al menos dos sectores distintos al de entrenamiento. Admite un glosario nuevo por sector y periodo, separado de las respuestas. |
| 12. Examen con custodia de resultados | Compromete entradas y claves al reservar. Sella predicciones antes de admitir la clave con sal. Rechaza reutilizaciones en el mismo libro. |
| 13. Diagnóstico y optimización de procesos | Reconstruye dependencias, identifica el cuello de botella y demuestra el menor tiempo total alcanzable bajo el presupuesto y las duraciones declaradas. |
| 14. Programación de herramientas nuevas | Sintetiza expresiones con unidades a partir de ejemplos y genera un módulo JavaScript ejecutable. La entrega aprende a calcular la reposición de inventario. |
| 15. Especialización local en C++ | Genera y compila el núcleo numérico. Comprueba exactitud y mide el costo completo del lote, incluida la comunicación con el proceso nativo. Solo lo selecciona si gana en ese equipo. |
| 16. Entrega, migración y reversión | Exporta fuentes y manifiesto, conserva entradas originales en SQLite, acepta dos formatos de expediente y puede cambiar de versión con operaciones concurrentes. |

## Operar sobre un nicho propio

El operador aporta expedientes autorizados, resultados resueltos, señales observadas del experto, glosarios y antecedentes que la candidata debe superar. Quien evalúa conserva las claves hasta recibir las predicciones. Las respuestas pueden ser un importe entero en la unidad declarada, cero o `null` para «falta evidencia». Los documentos del mismo expediente comparten unidades. Las monedas se declaran en unidades mínimas, por ejemplo centavos de MXN.

| Orden en el libro firmado | Datos | Efecto |
|---|---|---|
| `factory-reserve` | `project, cap` | Comprueba permisos, presupuesto, vigencia, ejemplos, procedencia y compromisos de examen. |
| `global-work ID` | Identificador de la reserva | Genera una candidata, pide un caso discriminante o documenta el motivo para detenerse. |
| `factory-predict` | `job, groups` | Corre con las entradas reservadas y congela las predicciones antes de conocer las respuestas. |
| `factory-score` | `job, answers` | Dictamina aciertos, errores graves, abstenciones esperadas y controles, con desglose por sector y herramienta. |
| `settle` | `job, cents, reference` | Liquida el costo autorizado. Un presupuesto agotado cierra el libro para nuevas operaciones. |
| `factory-export ID DIR` | Reserva y ruta nueva | Reproduce el historial y requiere el mismo ejecutor certificado y una calificación aprobatoria. |

Las órdenes firmadas se envían usando `global-command`; `global-run` también ejecuta el trabajo al recibir una reserva. El conjunto completo de campos y un ejemplo con varias tablas, ambigüedades, tres sectores y sus claves están en [el generador de expedientes](../scripts/factory/fixtures.mjs). El formato de firma y la tesorería se describen en [operación global](operacion-global.md).

En el producto, `run` recibe `{"format":2,"dossier":...}` y `batch` una lista de estos objetos. El formato anterior usa `{"format":1,"case":...}` con libros y tablas. Cada registro indica qué tipo de movimiento contiene y si su dueño lo dio por cerrado. Si está abierto, requiere cuenta y cota máxima de los movimientos adicionales. Un tipo de registro ausente genera una solicitud de evidencia. Un registro cerrado sin movimientos es una declaración expresa del proveedor. Las citas verifican el contenido recibido. La autoridad que suministra el expediente responde por su integridad de origen.

Para conservar datos operativos, `install BASE` registra la versión, `append BASE alta.json` agrega un expediente y `history BASE` muestra los resultados. Una corrección indica la huella de la versión previa del expediente. Con otro producto ya calificado, `install BASE` reconstruye las vistas con la nueva versión y `switch BASE HUELLA_ANTERIOR` vuelve a la anterior, incluidos los movimientos recibidos después de actualizar. Las fuentes se cotejan con el manifiesto local. La referencia de confianza de una entrega es su huella obtenida del libro auditado.

## Alcance de las garantías

La búsqueda numérica acepta de dos a cuatro tipos de movimientos, importes no negativos y un máximo de 4,096 movimientos distintos y ocho registros abiertos por expediente. Las herramientas generales usan hasta cinco campos, aritmética entera, mínimo, máximo y parte positiva, con dimensiones compatibles y un presupuesto de búsqueda. El optimizador admite hasta diez etapas y evalúa todas las combinaciones asequibles en su dominio. Sus minutos dependen de las duraciones y de los tiempos posteriores a la mejora que el operador haya documentado. La inspección de experto se registra como datos estructurados.

Cada decisión de la fábrica pasa por las cinco capacidades de Nexus y conserva los dictámenes de los revisores. Cuando se vuelve a trabajar en el mismo proyecto, la última regla aprobada se incorpora automáticamente a los controles.

El conciliador solo se exporta si resuelve todos los casos reservados, incluidos positivos, ceros y faltantes, y supera al mejor control. Cada herramienta adicional también debe acertar todos sus casos y superar sus controles. La novedad se mide respecto del catálogo declarado. Un 100 % observado vale para ese examen y las pruebas matemáticas cubren las propiedades enumeradas. Este flujo asigna recursos a un equipo autorizado y ejecuta búsquedas acotadas; el padrón puede tener cien millones de identidades lógicas.

El código de la entrega se genera o copia del repositorio. El manifiesto registra fuentes propias, procedencia de ejemplos, Node, SQLite y compilador C++ opcional. La primera preparación del repositorio completo instala sus dependencias de construcción. El producto portátil funciona con archivos, Node y SQLite locales y sin servicios de terceros.

## Evidencia reproducible

El examen controlado cubre construcción, logística y servicios con documentos generados. Evalúa recuperación, abstención y trazabilidad. El examen histórico usa otra tarea, reconstruir el importe de líneas reales de Iowa. Entrena con 20 líneas de abril de 2018. La búsqueda exacta falló en esa muestra. Una fórmula exploratoria que tolera hasta cuatro discrepancias se evaluó separadamente en 120 líneas de abril de 2019 y 120 de abril de 2020. Los importes históricos son públicos. La huella de la predicción se publicó antes de calificar esos dos periodos. El resultado conserva los dieciséis identificadores donde difirió del importe documentado.

```sh
python3 scripts/factory/offline.py node scripts/factory/exam.mjs
node scripts/factory/public.mjs freeze /tmp/iowa-predicciones.json
node scripts/factory/public.mjs grade /tmp/iowa-predicciones.json
```

El bloqueo de red para el examen usa Linux y libseccomp. El producto exportado requiere Node 24. La extracción reproducible del conjunto histórico usa el Parquet y la revisión indicados en el muestreador. Los importes son observaciones históricas de terceros. El caso de uso comercial, el margen y los cobros propios siguen pendientes de un piloto con un cliente.

[Examen controlado](../evidence/factory-exam.json) · [Resultados históricos y discrepancias](../evidence/factory-iowa-result.json) · [Compromiso publicado](https://github.com/josuechavando350-png/Agentes-2M/commit/a872c2cbe6b00d8d33bed61cf801a7f83714b9d4) · [Muestreador](../scripts/factory/iowa.py) · [Procedencia del Parquet](https://github.com/gatewaycat/iowa-liquor-sales2/tree/1ee2a06e0d9d0f470607f89417acaaec6bd43607)
