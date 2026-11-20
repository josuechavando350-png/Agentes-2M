# Operación global de SEMAR

Diablo puede recibir una pregunta comercial en español sobre expedientes autorizados, convertirla en trabajo documental, elegir especialistas, contrastar su respuesta y entregar una decisión con fuentes. El operador define el alcance y los permisos. Una petición abierta puede terminar con una solicitud precisa de evidencia o de definición del objetivo. El vocabulario inicial cubre margen, utilidad, consulta numérica y producto. Para otro significado se puede especificar una consulta, una diferencia o un producto por sus campos.

## Ejecutar y verificar

Con Node 24 y el padrón instalado, estas órdenes ejecutan una demostración aislada y un examen nuevo.

```sh
npm ci
npm run setup
npm run global:demo
npm run global:exam
npm test
```

Para operar, fija `SEMAR_DB` al archivo SQLite del padrón y registra la clave pública Ed25519 de tesorería con el mandato existente `settlement_key`. La clave privada permanece en tu entorno. Cada orden de escritura contiene `{protocol:"SEMAR-GLOBAL-1",book,id,kind,data}`. Firma el registro exacto con la herramienta local. El identificador es la clave para reintentar la misma orden tras una interrupción. El expediente, su procedencia y las autorizaciones los aporta el titular del libro.

```sh
node scripts/global/sign.mjs /ruta/tesoreria.pem mandato.json > firmado.json
node src/cli.mjs global-command firmado.json
node src/cli.mjs global-run solicitud-firmada.json
node src/cli.mjs global-work investigacion
node src/cli.mjs global-report investigacion
node src/cli.mjs global-aware 1
node src/cli.mjs global-feed diablo-666
node src/cli.mjs global-replay investigacion
node src/cli.mjs global-audit
node src/cli.mjs global-regressions
```

Primero se firma `open` con presupuesto en centavos, moneda, límite por trabajo, fecha de vencimiento UTC en milisegundos dentro de las siguientes 168 horas, operaciones autorizadas y agentes con límites individuales. Con `source` se registra cada documento, su esquema de unidades y etapas, origen primario, método, supuestos, vigencia y versión anterior. Las marcas `from` y `until` delimitan un intervalo que incluye el comienzo y excluye el final. La primera versión lleva `previous: null`. Las siguientes requieren la huella de la anterior. `withdraw` retira una fuente y conserva la razón. [Ejemplos ejecutables de dotación, fuentes y firmas](../scripts/global/demo.mjs)

Esta petición permite a Diablo elegir el sujeto de mayor margen respaldado entre las cuentas disponibles. Si el origen admite varias columnas con el mismo significado, devuelve las opciones que hay que aclarar.

```json
{
  "protocol": "SEMAR-GLOBAL-1",
  "book": "operacion",
  "id": "investigacion",
  "kind": "reserve-brief",
  "data": {
    "cap": 10,
    "brief": {
      "scope": "mi-operacion",
      "question": "Encuentra una oportunidad de margen",
      "subject": null,
      "unit": "centavos",
      "stage": "conciliado",
      "threshold": 40,
      "minFamilies": 2,
      "probes": []
    }
  }
}
```

`reserve` acepta el objetivo estructurado con `subject, op, operands, threshold` y los demás campos del ejemplo de código. `global-run` verifica, reserva, ejecuta y confirma la entrega. `global-work` reanuda la reserva por ID. Una reconsulta de una entrega con evidencia caducada devuelve `REVIEW_REQUIRED` y la acción necesaria para actualizarla. El tablero permite ver el dato pendiente, puestos responsables, fuentes y criterio de cierre. Una firma de `settle` con `{job,cents,reference}` concilia el costo efectivamente atestiguado. Una reserva ejecutada conserva su techo hasta la conciliación. Se puede cancelar una reserva pendiente. La aplicación no contacta a clientes ni gira dinero.

## Cobertura funcional de las veinte capacidades

| N.º | Capacidad | Comportamiento comprobable |
|---:|---|---|
| 1 | Supervivencia y tesorería | Reserva el techo del gasto en SQLite antes de ejecutar. Dos procesos compiten por el mismo saldo. El comprobante firmado descuenta el importe y libera el excedente. A cero se retira la identidad o todo el padrón operativo si se agotó el presupuesto global. El cierre económico y la consulta histórica siguen disponibles. |
| 2 | Elegir el experimento | Calcula el margen esperado de decidir tras conocer el resultado de una prueba frente al de actuar con la información actual. Resta el costo de la prueba, considera presupuesto y plazo, y permite esperar. Los dos márgenes condicionales y la probabilidad son supuestos del mandato. |
| 3 | Aprender el efecto de intervenir | El laboratorio de campo compara acciones asignadas al azar por parejas, admite esperar como control y exige resultados conciliados. La respuesta global recupera el método calificado del mismo segmento y su margen incremental comprobado. Correcciones posteriores marcan la decisión para revisión. |
| 4 | Crear y desplegar métodos | `propose` infiere un programa acotado a partir de ejemplos. Sella su predicción y la del control por cliente nuevo antes de abrir las etiquetas. `examine` exige acertar al menos un caso adicional, conservar los aciertos y evitar errores graves. `reserve-method` ejecuta la versión en otro sujeto compatible. `deploy` instala 666 copias sobre una cohorte emitida por la escuela, con presupuesto transferido del patrocinador. |
| 5 | Elegir escala | El C++ ejecuta 1, 10 o 100 reglas por sector. En el lote de examen equivalen a 1, 10 y 100 millones de comparaciones. Se verifican sus votos contra el cálculo completo y se contrastan con una regla de recencia. `global-rank` elige dentro del techo computacional y del alcance ya medido. |
| 6 | Traducir una misión | `reserve-brief` transforma las preguntas admitidas en una medida, hipótesis, umbral, responsables y condiciones de cierre. Puede explorar varios sujetos de un expediente y explicar por qué eligió uno. |
| 7 | Rastrear afirmaciones | Cada operando conserva versiones, documentos y filas. Una revisión, revocación o vencimiento marca las entregas afectadas. `refresh` vuelve a decidir y, en una cartera, considera también sujetos nuevos. |
| 8 | Hipótesis rivales | Investiga los dos lados del umbral, conserva la postura de cada revisor y usa el Oráculo para arbitrar la aritmética y los desacuerdos entre documentos. |
| 9 | Herramientas verificables | Consulta tablas autorizadas, ejecuta programas declarativos de cálculo y somete cada resultado al cálculo de referencia. La reproducción archivada corre en un proceso de Node con permisos de lectura acotados. |
| 10 | Conocimiento con vigencia | Las fuentes y métodos tienen alcance y fecha de caducidad. La memoria de Nexus se reutiliza con contexto, evidencia vigente y vencimiento. Las observaciones vencidas salen de la selección de especialistas. |
| 11 | Capacidades demostradas | Los trabajadores resuelven una prueba por operación al ser habilitados. Los cinco componentes de Nexus existentes participan en la emisión. El recibo conserva evidencia, decisión del optimizador y dictámenes de planificador, crítico y verificador. |
| 12 | Trabajo entre sectores | `global-feed L1` hasta `L10` y `global-feed diablo-666` comparten tareas y decisiones. Las solicitudes equivalentes con la misma evidencia pueden usar la decisión o reserva original. Cada revisor designado lee el expediente sin recibir las respuestas de sus pares. |
| 13 | Consenso falso | Se agrupan documentos conectados por origen, método declarado, fuente o supuesto compartido, incluso transitivamente. La decisión exige el mínimo de familias por operando. La procedencia desconocida queda fuera de ese mínimo. |
| 14 | Especialización observada | `feedback` fija una observación externa firmada que incluye la huella de la decisión. Diablo selecciona por aciertos y errores del trabajador en la operación, unidad, etapa y alcance correspondientes. |
| 15 | Una salida accionable | El resultado incluye avanzar, detenerse o buscar evidencia, el valor, las alternativas consideradas, el umbral, la siguiente pregunta y las referencias. La recomendación comercial muestra si ya hay un ensayo de intervención conciliado. |
| 16 | Datos dañados o contexto distinto | Detecta duplicados en una medida, información no numérica, unidades y etapas incompatibles, fuentes vencidas y valores contradictorios. Al corregir la fuente se conserva el resultado previo para auditoría. |
| 17 | Reproducir una decisión | Se conservan expediente, política, respuestas anteriores usadas, versión de Node y un archivo comprimido del ejecutor. `global-replay` corre el código archivado y compara la huella completa. |
| 18 | Recuperación y latencia | Reservas, entregas y comprobantes tienen claves idempotentes. El trabajo documental se puede repetir después de un fallo sin duplicar el cargo. El examen mide p50, p95 y p99 desde la petición firmada hasta el commit de la decisión bajo concurrencia. |
| 19 | Permisos en ejecución | Tesorería firma el mandato. El ejecutor distingue lectura y cálculo, rechaza operaciones desconocidas y comprueba presupuesto y vigencia al concluir. Los balances reales atestiguados y los créditos históricos de escuela se presentan por separado. |
| 20 | Examen y regresiones | El examen genera casos nuevos y compara contra respuestas reservadas. Informa aciertos, cobertura, abstenciones correctas, errores graves, referencias, filas leídas y latencia. Cada observación de campo queda disponible para volver a probar la versión vigente, incluidas las decisiones que fallaron. |

## Contratos adicionales

- `feedback` recibe `{job,resultHash,action,reference,until}`. El informe de regresiones vuelve a ejecutar la decisión con la evidencia original y contrasta la observación. Las rectificaciones del libro comercial siguen el procedimiento firmado del laboratorio de campo.
- `propose` recibe `scope,fields,incumbent,examples,testSubjects,labelsHash,until`. El examinador conserva las etiquetas y una sal privada. Entrega `labelsHash = digest({salt,labels})` antes de la síntesis y posteriormente firma `examine` con `{proposal,salt,labels}`. Los sujetos de prueba son distintos de los de entrenamiento. Las regresiones documentadas del mismo método y alcance bloquean su admisión y despliegue mientras sigan presentes. Las tres operaciones de la gramática son lectura, diferencia y producto.
- `deploy` recibe `{proposal,birth,sponsor,generation,perAgentCents}`. El recibo de nacimiento identifica exactamente 666 agentes vivos ya creados bajo las reglas de Salud. Cada copia recibe la misma receta calificada y su propio límite. Para ejecutar una hija específica usa `reserve-method` con `{proposal,goal,cap,replica}`. [Pruebas de despliegue, retiro y reproducción](../test/global.test.mjs)
- `global-scale paquete.json desenlaces.json [hilos] [centavos_por_hora_de_maquina]` compara el mismo lote en las cuatro escalas. El costo calculado por tarifa es una estimación. `global-rank paquete.json max_comparaciones` usa el examen archivado para escoger una escala de investigación análoga. El orden prioriza aciertos en las plazas y desempata por número de comparaciones. Se requiere el mismo nicho, tamaño de lote y tamaño histórico con ventanas ya maduras.
- Conserva una copia consistente de la base SQLite completa, incluyendo el libro monetario y los ejecutores archivados. Para una copia en caliente se puede usar el comando de respaldo de SQLite. El histórico de la escuela se puede importar mediante el procedimiento original.

## Evidencia

Las cuatro cohortes históricas de Iowa ya se habían abierto. Esta comparación de escala usa esos mismos casos y mide solo los votos por analogía y la regla sencilla. La lista comercial compuesta tiene su propio examen. El examen documental usa casos generados al ejecutar el programa. El origen de cada documento de una misión real, su independencia y los gastos requieren constancias del operador. Para ingresos incrementales, la evidencia corresponde a las intervenciones aleatorizadas que lleguen a conciliarse. [Comparación de escalas](../evidence/global-scale.json) · [Ficha de examen](../evidence/global-exam.json) · [Laboratorio comercial](../README.md#laboratorio-de-métodos-y-pilotos)
