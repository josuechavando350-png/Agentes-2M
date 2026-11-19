# Agentes-2M · SEMAR

Motor local de agentes lógicos con presupuesto individual, aprendizaje entre sectores y auditoría de cada entrega. El padrón inicial contiene 10,000,000 identidades, un millón por líder. Una identidad adquiere tiempo de CPU al recibir trabajo. El censo recorre cada ID y calcula una huella de su estado. El límite de registro es un billón en español, 1,000,000,000,000.

## Estado de la primera escuela

Diez rondas ejecutadas, 30 entregas aprobadas y 6,660 certificados de réplica. El padrón resultante tiene 10,006,660 identidades lógicas. Se puede restaurar ese estado, con las lecciones y los saldos de la escuela, y continuar por la ronda 11. [Censo inicial](evidence/censo-inicial.json) · [Resultados de las diez rondas](evidence/escuela-inicial.json) · [Bitácora transportable](evidence/escuela-inicial.json.gz)

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
npm run semar -- agent 10000001
```

El primer argumento de `academy` es la ronda inicial y el segundo es el número de rondas. Cada ronda coordina al docente, al alumno, a una réplica cuando hubo promoción y a los diez líderes. Las claves de ronda permiten reanudar un intento interrumpido. Una reserva insuficiente detiene las nuevas admisiones. El censo admite rangos inclusivos, por ejemplo `census 9999900 10000000`. La demo usa una base en memoria.

## Autoridad y economía

| Autoridad           | Función ejecutada                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agente              | Trabaja con identidad, generación, versión, capacidades y saldo.                                                                                                                                                                      |
| Infantería de SEMAR | Comprueba la autoría de las entregas externas mediante Ed25519. Ante un resultado firmado incorrecto revoca la generación y su clave. El sustituto conserva el saldo restante y recibe una generación nueva.                          |
| Salud               | Antes de promover a un agente compara la versión candidata con la anterior y comprueba que conserva sus habilidades y gana una nueva. Examina individualmente a las 666 réplicas. Los propios agentes de Salud pasan por ese proceso. |
| Oráculo de SEMAR    | Autoridad técnica final. Recalcula las respuestas con una implementación independiente y verifica identidad, saldos, linaje, certificados y bitácora antes de confirmar la transacción.                                               |
| Consejo             | L1 dirige el consejo y pertenece a los diez líderes. Cada evento queda en su buzón y en el de los otros nueve. Una consulta del consejo genera diez respuestas sobre habilidades y lecciones disponibles.                             |

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
