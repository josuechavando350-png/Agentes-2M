import {
  InMemoryOntologyPersistence,
  KnowledgeGraphPlanner,
  KnowledgeGraphReader,
  createDefaultGuardrailPolicy,
  LongTermMemoryPlanner,
  LongTermMemoryReader,
  MemoryAwareGuardrailCoordinator,
  createDefaultLongTermMemoryPolicy,
  ContextualBanditEngine,
  BanditAwareGuardrailCoordinator,
  createDefaultContextualBanditPolicy,
  BoundedMultiAgentReasoningEngine,
  createDefaultReasoningPolicy,
  DeliberativeBanditCoordinator,
  BANDIT_STATE_TYPE,
} from "../.cache/nexus.mjs";
import { digest } from "./policy.mjs";

function apply(read, plan) {
  for (const action of plan.operations) {
    switch (action.kind) {
      case "CREATE_OBJECT": {
        if (read.getObject(plan.scope, action.record.id))
          throw Error("Objeto duplicado");
        read.upsertObject({ ...action.record, revision: 1 });
        break;
      }
      case "CREATE_RELATIONSHIP": {
        if (read.getRelationship(plan.scope, action.record.id))
          throw Error("Enlace duplicado");
        read.upsertRelationship({ ...action.record, revision: 1 });
        break;
      }
      case "UPDATE_OBJECT": {
        const old = read.getObject(plan.scope, action.id);
        if (old?.revision !== action.expectedRevision)
          throw Error("Conflicto de revisión");
        read.upsertObject({
          ...old,
          properties: action.properties,
          revision: old.revision + 1,
        });
        break;
      }
      default:
        throw Error("Operación no admitida: " + action.kind);
    }
  }
}

export async function deliberate({
  sector,
  key,
  op,
  data,
  value,
  peer,
  states,
  now,
}) {
  const scope = {
    tenantId: "semar",
    organizationId: "sector-" + sector,
    brandId: "academia",
  };
  const graph = new InMemoryOntologyPersistence();
  for (const record of states) graph.upsertObject(record);
  const planner = new KnowledgeGraphPlanner(graph, scope);
  const observedAt = new Date(now).toISOString();
  const business = "sector:" + sector,
    subject = "equipo:" + sector;
  const q = "Informe " + op + " resultado";
  for (const [id, name] of [
    [business, "Informe " + op],
    [subject, "Equipo de aprendizaje"],
  ]) {
    apply(
      graph,
      planner.planEntityUpsert({ id, name, kind: "ORGANIZATION", observedAt }),
    );
  }
  const evidenceDigest = digest({ op, data });
  apply(
    graph,
    planner.planEvidenceAdd({
      id: "evidence:input",
      kind: "FIRST_PARTY",
      source: "entrada:" + key,
      sourceDigest: evidenceDigest,
      excerpt: JSON.stringify(data).slice(0, 600),
      observedAt,
    }),
  );
  apply(
    graph,
    await planner.planFactUpsert({
      id: "fact:result",
      subjectId: business,
      predicate: "resultado",
      object: { kind: "LITERAL", value },
      confidence: 1,
      claimClass: "GENERAL",
      evidenceIds: ["evidence:input"],
      observedAt,
    }),
  );
  const clock = () => now;
  const memoryPolicy = createDefaultLongTermMemoryPolicy();
  if (peer && now - peer.at < 30 * 86400_000 && peer.at <= now) {
    const memories = new LongTermMemoryPlanner(
      graph,
      scope,
      memoryPolicy,
      clock,
    );
    apply(
      graph,
      memories.planUpsert({
        subjectId: subject,
        memoryKey: "metodo-" + op,
        category: "INTERACTION_SUMMARY",
        value: "Informe " + op + " resultado verificado por otro agente",
        sourceKind: "SYSTEM_SUMMARY",
        sourceRef: "auditoria:" + peer.key,
        sourceDigest: peer.hash,
        retentionBasis: "SERVICE_CONTEXT",
        sensitivity: "STANDARD",
        confidence: 0.9,
        observedAt: new Date(peer.at).toISOString(),
        expiresAt: new Date(peer.at + 30 * 86400_000).toISOString(),
      }),
    );
  }
  const memory = new MemoryAwareGuardrailCoordinator(
    new KnowledgeGraphReader(graph, scope),
    createDefaultGuardrailPolicy(),
    new LongTermMemoryReader(graph, scope, memoryPolicy, clock),
    clock,
  );
  const fact = {
    kind: "FACT",
    factId: "fact:result",
    templateId: "es.general",
  };
  const arms = [
    { armId: "breve", plan: { planId: "plan:breve", segments: [fact] } },
    {
      armId: "con-cierre",
      plan: {
        planId: "plan:con-cierre",
        segments: [fact, { kind: "COPY", copyId: "es.offer-help" }],
      },
    },
  ];
  const bandit = new ContextualBanditEngine(
    graph,
    scope,
    createDefaultContextualBanditPolicy(),
    arms,
    clock,
  );
  const coordinator = new DeliberativeBanditCoordinator(
    new BanditAwareGuardrailCoordinator(memory, bandit),
    new BoundedMultiAgentReasoningEngine(
      scope,
      createDefaultReasoningPolicy(),
      arms.map((a) => ({
        armId: a.armId,
        intentTags: ["informe", "resultado"],
      })),
    ),
    clock,
  );
  const context = await coordinator.prepare({
    reasoningId: "razon:" + key,
    interactionId: "turno:" + key,
    banditId: "informe",
    businessEntityId: business,
    customerEntityId: subject,
    userMessage: q,
    eligibleArmIds: arms.map((a) => a.armId),
    banditContext: { intent: op.toLowerCase(), channel: "local" },
  });
  const answer = coordinator.renderSelected(context);
  coordinator.verifyOutbound(answer, context);
  if (
    context.bandit.base.guardrails.grounding.status !== "SUPPORTED" ||
    !answer.usedFactIds.includes("fact:result")
  )
    throw Error("Entrega sin evidencia suficiente");
  apply(graph, context.bandit.exposurePlan);
  // The task contract rewards verified, concise numeric reports. This is not revenue.
  const reward = answer.usedCopyIds.length === 0 ? 1 : 0.75;
  apply(
    graph,
    bandit.planReward({
      decisionId: context.bandit.decision.decisionId,
      reward,
      outcomeAt: observedAt,
    }),
  );
  return {
    answer: answer.text,
    arm: context.deliberation.selectedArmId,
    reward,
    memory: context.bandit.base.memory.status,
    grounding: context.bandit.base.guardrails.grounding.status,
    verdicts: context.deliberation.attempts
      .at(-1)
      .assessments.map((a) => ({ role: a.role, verdict: a.verdict })),
    deliberation: context.deliberation.digest,
    evidenceDigest,
    states: graph.queryObjects(scope, {
      typeId: BANDIT_STATE_TYPE,
      limit: 1000,
    }).items,
  };
}
