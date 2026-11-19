# Agentes-2M · SEMAR

Motor local de agentes lógicos con presupuesto individual, aprendizaje entre sectores y auditoría de cada entrega. El padrón base contiene 100,000,000 de fundadores lógicos, diez millones por líder. Las réplicas certificadas se cuentan aparte. Una identidad adquiere tiempo de CPU al recibir trabajo. El censo recorre cada ID y calcula una huella de su estado. El límite de registro es un billón en español, 1,000,000,000,000.

## Ampliación a cien millones

La escuela existente añadió 90,000,000 de fundadores en un rango posterior a las identidades ya emitidas. Cada fundador recibe diez créditos simulados de la reserva de incubación. El libro conserva los IDs, saldos, exámenes, generaciones retiradas y reglas aprendidas en las rondas anteriores.

El informe recorre cada ID y ejecuta una prueba de su especialidad por cada identidad viva. Usa un banco reproducible de 4,096 casos y compara el resultado con el de una implementación independiente. Además, un nuevo fundador de cada sector abre un expediente del maestro original y pasa por las cinco capacidades de Nexus. El informe contiene su dictamen y los datos de las nuevas cohortes. [Censo y examen del padrón ampliado](https://github.com/josuechavando350-png/Agentes-2M/blob/estado-semar/escuela/censo-100m.json) · [Último ciclo](https://github.com/josuechavando350-png/Agentes-2M/blob/estado-semar/escuela/avance.json)

## Diablo 666 y la misión de siete días

Diablo 666 ocupa el mando absoluto. Salud selecciona la estrategia de lectura con casos nuevos generados después de fijar las candidaturas. Los candidatos trabajan en procesos de ejecución independientes sobre los mismos documentos. El Oráculo verifica los aciertos por caso, las afirmaciones graves sin evidencia, el costo en filas leídas y el límite de latencia. Dos políticas que empatan en aciertos pueden diferenciarse en costo. El cargo pasa a la siguiente identidad viva y acreditada cuando el titular agota su saldo o pierde su generación. El nombre identifica al cargo durante la sucesión. [Estado público de la misión](https://github.com/josuechavando350-png/Agentes-2M/blob/estado-semar/escuela/mando.json)

Las nuevas mutaciones de habilidades y los árboles de decisión se comparan con su versión anterior antes de registrar las 666 réplicas. Salud usa una semilla aleatoria nueva, resuelve casos reservados con respuestas independientes, vuelve a probar las habilidades y programas anteriores y conserva los resultados individuales. El tiempo se registra en microsegundos. La auditoría reproduce los resultados y el costo determinista y comprueba el límite de tiempo observado al admitir la mutación.

El reloj de cada misión corre durante 168 horas. La exploración ocupa las primeras 24, la validación llega hasta la hora 96 y el último tramo busca evidencia comercial. La primera misión dispone de 168 créditos simulados. Se reserva presupuesto para las fases posteriores. Diablo puede modificar el presupuesto y detener la misión. Al vencer el plazo se bloquean nuevas entregas, aunque GitHub retrase el siguiente pulso horario que archiva el cierre. El informe incluye diez balances sectoriales, cobros y egresos documentados, hipótesis pendientes y error de las probabilidades declaradas. Los agentes con saldo sobreviven al cierre.

El piloto consulta hasta cinco convocatorias vigentes por lectura en la API pública de Postor Abierto y conserva la ficha, la referencia al campo y el enlace al procedimiento de origen. Postor Abierto distribuye estos datos bajo CC BY 4.0. Una convocatoria documenta una necesidad del comprador. Para decidir sobre un margen hacen falta precios, costos y cantidades acreditados. [Postor y condiciones de atribución](https://postor.com.mx/api-docs)

Diablo puede convocar fundadores de cualquiera de los diez millones de su sector y descendientes de las cohortes certificadas. Para cada pregunta compara una muestra nueva con especialistas que conservan un historial comprobado en esa función. Un equipo investiga una oportunidad por pulso mientras haya evidencia y presupuesto. Un agente propone, otro examina todas las fuentes y un tercero contrasta el cálculo y vuelve a ejecutarlo retirando cada documento citado. Se registran el comprador, el problema, la alternativa, la evidencia faltante y el dato que llevaría a abandonar. Con dos oportunidades y presupuesto para ambos ensayos, Diablo asigna cuatro créditos a cada una. Tras observar los resultados prioriza la viable. La escuela aprende de los pronósticos de misiones cerradas y conserva el desempeño de cada investigador por generación. Tres revisiones con al menos 90 % de aciertos confieren rango de élite al especialista mientras mantenga ese nivel.

### Usar expedientes autorizados

La interfaz local de administración es de confianza. Cada misión admite documentos expresamente seleccionados por el operador. El manifiesto acepta archivos bajo su directorio o URLs HTTPS exactas. El importador solo consulta esas fuentes. Un documento de texto usa una afirmación por línea y admite comentarios con `#`. Por ejemplo:

```text
taller.buyer = Taller del Sur
taller.problem = Tiempo de mantenimiento
taller.alternative = Personal interno
taller.price = 10000
taller.cost = 6000
taller.units = 5
```

Los precios y costos de la misión comercial se expresan en centavos MXN. Guarda las líneas en `taller.txt` y el manifiesto en su mismo directorio con el contenido `[{"id":"taller","format":"text","source":"taller.txt"}]`. Para archivos JSON, el formato `rows` admite una lista de registros con `subject`, `field` y `value`. Los expedientes privados se ejecutan en una base local. La rama de estado de GitHub es pública.

```sh
npm run semar -- init 66600
echo '{"type":"open_mission","mission":"semana","budget":168}' | npm run semar -- request abrir
npm run semar -- sources ./manifiesto.json
echo '{"type":"research"}' | npm run semar -- request ronda-uno
npm run semar -- aware 666
npm run semar -- mission
```

El comando `inquire` recibe identidad, generación, versión, IDs de documentos autorizados y una consulta con `subject`, `op` y `fields`. Admite lectura, diferencia y producto con el identificador de operación `lookup`, `difference` y `product`. Devuelve referencias exactas y el efecto de retirar cada fuente. Un crédito agotado causa la baja antes de emitir respuesta. Las conclusiones distinguen contradicción, información insuficiente y resultado respaldado.

Tesorería registra una vez su clave pública Ed25519 mediante `settlement_key`. Para `commerce` firma los bytes UTF-8 de `canonical(record)` con el esquema `{mission,subject,sale,stage,reference,currency,cents,contributors}` y entrega la firma en base64. Los identificadores de fuente contable son únicos por etapa. Las revisiones de estimación, cotización y pedido ocupan columnas propias. Los pagos y gastos firmados se concilian por referencia y una venta conserva su atribución a los participantes. El operador de tesorería debe verificar el comprobante contra su sistema de cobros. La misión pública consulta información y utiliza créditos simulados. La prueba de integración recorre pagos, duplicados, cierre y calibración con una clave efímera.

### Comparar con otro sistema

`node scripts/comparar.mjs crear /tmp/examen-semar-nuevo` genera 64 problemas reservados de evidencia documental. Comparte `casos.json` con cada participante y conserva `clave-privada.json` en el examinador. El formato de respuesta se ilustra con `semar.json`. Ejecuta `node scripts/comparar.mjs evaluar /tmp/examen-semar-nuevo /tmp/examen-semar-nuevo/semar.json` para obtener aciertos con citas exactas, errores graves, tiempo y costo externo declarado. Las comparaciones entre proveedores requieren ejecuciones reales sobre el mismo examen y presupuesto. Esta medición cubre el dominio documental implementado.

## Estado histórico de la primera escuela

Diez rondas ejecutadas, 30 entregas aprobadas y 6,660 certificados de réplica. Ese checkpoint contiene 10,006,660 identidades lógicas. El comando `resume` restaura sus lecciones y saldos y después amplía el padrón. [Censo inicial](evidence/censo-inicial.json) · [Resultados de las diez rondas](evidence/escuela-inicial.json) · [Bitácora transportable](evidence/escuela-inicial.json.gz)

## Ejecutar

Se necesitan Linux o macOS, Node 24.12 o posterior de la serie 24, npm, Git y tar. La instalación obtiene una revisión fija de Nexus y construye los módulos localmente. La ejecución posterior funciona sin red. Desde la raíz del repositorio:

```sh
npm ci
npm run setup
npm test
npm run demo
```

Para continuar la escuela publicada en una base nueva:

```sh
npm run semar -- resume
npm run semar -- academy 11 1
npm run semar -- feed L1 40 10
npm run semar -- audit
```

Para empezar un padrón independiente, usa otro archivo:

```sh
export SEMAR_DB=mi-escuela.sqlite
npm run semar -- init 66600
npm run semar -- census
npm run semar -- academy 1 3
npm run semar -- agent 100000001
```

El primer argumento de `academy` es la ronda inicial y el segundo es el número de rondas. Cada ronda coordina al docente, al alumno, a una réplica cuando hubo promoción y a los diez líderes. Las claves de ronda permiten reanudar un intento interrumpido. Una reserva insuficiente detiene las nuevas admisiones. El censo admite rangos inclusivos, por ejemplo `census 9999900 10000000`. Con `census 9999900 10000000 --examine` también se verifica una tarea por identidad viva. Para ampliar una base local existente, usa `npm run semar -- upgrade`. El comando `node scripts/verify-census.mjs RUTA_A_ESCUELA` reproduce el censo publicado desde los archivos de la rama de estado y comprueba la huella. La demo usa una base en memoria.

## Autoridad y economía

| Autoridad           | Función ejecutada                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agente              | Trabaja con identidad, generación, versión, capacidades y saldo.                                                                                                                                                                      |
| Infantería de SEMAR | Comprueba la autoría de las entregas externas mediante Ed25519. Ante un resultado firmado incorrecto revoca la generación y su clave. El sustituto conserva el saldo restante y recibe una generación nueva.                          |
| Salud               | Antes de promover a un agente compara la versión candidata con la anterior y comprueba que conserva sus habilidades y gana una nueva. Examina individualmente a las 666 réplicas. Los propios agentes de Salud pasan por ese proceso. |
| Oráculo de SEMAR    | Autoridad técnica final. Recalcula las respuestas con una implementación independiente y verifica identidad, saldos, linaje, certificados y bitácora antes de confirmar la transacción.                                               |
| Consejo             | Los diez líderes de sector tienen rango supremo. Diablo 666 dirige el consejo y recibe los eventos junto con los diez líderes. Los asientos históricos previos a la carta conservan el enrutamiento original hacia L1. Una consulta del consejo genera diez respuestas sobre habilidades y lecciones disponibles.                             |

Los diez sectores iniciales son Coordinación, Salud, Educación, Ciencia, Industria, Energía, Logística, Finanzas, Infraestructura y Tecnología. Salud se ocupa de la aptitud del software. SEMAR y sus rangos son nombres internos del proyecto.

Cada agente comienza con diez créditos simulados. Un intento de trabajo o formación consume un crédito. **Al llegar a cero muere antes de emitir otra entrega.** La generación agotada continúa muerta después de reiniciar. Los errores firmados generan reemplazos sin crear saldo. Los intentos sin firma válida quedan registrados y conservan el saldo del agente suplantado. El programa local de administración es de confianza y puede registrar una clave pública por generación.

Una mutación aprobada crea 666 candidatos verificados. Las réplicas activadas reciben diez créditos cada una de la reserva asignada en el origen del padrón. Si queda espacio para menos de 666 al acercarse al billón, Salud certifica el lote completo y registra el excedente en espera, fuera del padrón activo. El saldo usa enteros y la auditoría concilia la reserva, los saldos y el gasto. Todo el dinero de la escuela es simulado.

## Conocimiento y evolución

Las cinco capacidades originales se importan de `packages/ontology` del repositorio [Nexus Engine](https://github.com/josuechavando350-png/nexus-engine/tree/71b4a10c31a67b6bde852ede1d998081df165798/packages/ontology). La instalación usa los objetos Git de ese commit. Cada entrega aprobada pasa por el grafo con evidencia, reglas formales, memoria de lecciones, optimizador contextual y deliberación con planificador, crítico y verificador. Los tres deben aceptar. Los agentes aprenden estrategias de presentación a partir de una recompensa por brevedad verificada. La memoria conserva el contexto de otros agentes y la bitácora conserva la evidencia original.

El repertorio inicial incluye ocho operaciones numéricas, entre ellas la mejor subsecuencia contigua y la selección óptima sin posiciones adyacentes. El noveno método razona con hechos, negaciones explícitas y reglas encadenadas. Un evaluador obtiene la derivación hacia delante y otro comprueba la conclusión buscando hacia atrás. El resultado distingue respaldado, refutado, contradictorio y desconocido. Otro agente puede reabrir el expediente y formular una pregunta diferente conservando las fuentes. Una conclusión se refiere a las premisas declaradas. La veracidad externa de la fuente requiere verificación en el dominio correspondiente.

Ejemplo de solicitud en un padrón nuevo:

```sh
npm run semar -- request expediente-1 <<'JSON'
{"type":"work","id":6000001,"generation":1,"version":1,"op":"inference","data":{"facts":[{"literal":"inspeccionado","source":"acta A"}],"rules":[{"if":["inspeccionado"],"then":"revisado","source":"criterio B"}],"query":"revisado"}}
JSON

npm run semar -- request consulta-2 <<'JSON'
{"type":"recall","id":1000001,"generation":1,"version":1,"from":"expediente-1","query":"inspeccionado"}
JSON
```

La segunda operación puede generar una mutación automática cuando el alumno requiere una habilidad demostrada por otro agente y hay reserva suficiente. La escuela mide mejoras por desempeño en casos reproducibles. En esta versión, evolucionar agrega métodos del repertorio implementado. El sistema de aprendizaje queda separado de las reglas de auditoría, las firmas y el saldo.

## Comprobación y alcance

`audit` vuelve a ejecutar los controles de linaje, las referencias independientes y la certificación de cada lote. Cada comando que escribe debe superar esos controles antes del commit. SQLite serializa escritores y conserva resultados idempotentes por clave. El libro usa SHA-256 encadenado. Una huella conservada fuera del host permite detectar un historial sustituido. El dueño del host conserva control sobre el ejecutable y la base. Las autoridades técnicas de esta edición se ejecutan en un mismo proceso de confianza.

`resume` solo importa el checkpoint publicado a una base vacía, comprueba la huella y revierte la operación completa si falla la validación. `scripts/school-evidence.mjs` genera una escuela nueva de diez rondas con marcas de tiempo nuevas. El censo inicial tiene una huella reproducible independiente del reloj.

La evidencia publicada cubre el padrón completo y las ejecuciones indicadas. La concurrencia distribuida, el razonamiento abierto con modelos externos, la calidad en una profesión concreta y el rendimiento a un billón quedan sin medir. El proceso se activa al ejecutar la academia o presentar tareas. El repositorio incluye auditoría de CI al cambiar el código.

## Síntesis de reglas y escuela continua

Un agente con capacidad de inferencia puede solicitar `synthesize` indicando un expediente de otro agente y de dos a cuatro variables booleanas. El aprendiz recibe únicamente las filas de entrenamiento y construye un árbol de decisión. Salud reserva una cuarta parte de las combinaciones. El Oráculo contrasta el árbol con todas las combinaciones del dominio y exige superar la predicción constante mayoritaria. Una candidata rechazada consume su crédito de trabajo y genera cero réplicas. Una aceptada se hereda con su código de decisión, fuente y examen. El comando `predict` permite que una hija aplique la regla; la salida también pasa por las cinco capacidades de Nexus.

La escuela continúa a diario a las 10:17 UTC. Cada ejecución restaura el último estado, audita el historial y propone una mutación. El código vive en `main`; el historial comprimido y el avance viven en [estado-semar](https://github.com/josuechavando350-png/Agentes-2M/tree/estado-semar/escuela). Después de ocho ejercicios iniciales, el currículo recorre las 254 tablas no constantes de tres variables activas y una variable auxiliar. Los sectores se turnan para recibir formación y sus descendientes pueden conservar varias reglas. También se pueden usar expedientes propios mediante la interfaz local. El horario admite retrasos de GitHub Actions. En la escuela persistente, una dotación única de créditos simulados cubre los nacimientos posibles hasta el tope del padrón. El valor de la dotación se calcula con el espacio restante y queda en la bitácora. Los agentes conservan sus saldos, incluida la baja definitiva a cero. Los padrones de prueba iniciados con una reserva menor conservan su presupuesto hasta que su operador constituya esa dotación. Para reproducir dos ciclos locales consecutivos, ejecuta dos veces `node scripts/cycle.mjs .cache/escuela`.
