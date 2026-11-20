import { readFileSync } from "node:fs";
import { check } from "../factory/reader.mjs";
import { portfolio } from "./portfolio.mjs";

export async function saleScorecard(books) {
  const read = (name) =>
    JSON.parse(
      readFileSync(
        new URL("../../evidence/" + name + ".json", import.meta.url),
      ),
    );
  const factory = read("factory-exam"),
    endurance = read("sale-endurance"),
    credit = read("sale-retail"),
    full = read("sale-full-file"),
    browser = read("sale-browser"),
    admission = read("sale-intake"),
    notes = read("sale-register"),
    history = read("sale-history"),
    program = read("sale-serving"),
    hill = read("sale-hillstrom"),
    prices = read("sale-iowa"),
    participation = read("sale-participation"),
    times = read("sale-throughput-packed"),
    bursts = read("sale-pressure"),
    queue = read("sale-queue"),
    prospects = read("sale-prospects"),
    prospectSeal = read("sale-prospect-seal");
  const frozen = read("sale-seal"),
    priceSeal = read("sale-diagnostic-seal");
  check(
    hill.seal === frozen.seal &&
      prices.seal === priceSeal.seal &&
      prospects.seal === prospectSeal.seal &&
      bursts.seal === program.modelSeal &&
      program.trainingRecipe === frozen.policy &&
      participation.recipe === frozen.policy,
    "Los exámenes no corresponden a los compromisos declarados",
  );
  const window = credit.runs.find((r) => r.maxAgeDays === 90),
    large = hill.workers.find((w) => w.population === participation.population);
  check(
    notes.input === window.inputHash &&
      full.source === window.source &&
      browser.rowsFromHistory === full.lines &&
      admission.submitted.fullInput === full.input &&
      admission.submitted.retainedInput === window.inputHash &&
      full.creditNotes === notes.registered &&
      full.unmatchedValueCents === window.unmatchedValueCents &&
      queue.source === notes.source &&
      history.source === notes.source &&
      notes.registered === window.credits &&
      large.sectorSeals === participation.nativeSectorCommitment &&
      large.scoresHash === times.reference &&
      times.reference === participation.scoreHash,
    "Recibos de ejecuciones diferentes",
  );
  const periodTotal = (k) => prices.periods.reduce((sum, p) => sum + p[k], 0);
  const money = books
    ? await portfolio(books.paths, "LIVE", books.originals)
    : null;
  const selection = hill.methods.find((m) => m.name === "rules-" + large.rules);
  return {
    technicalEvidence:
      "Resultados publicados del repositorio; las mediciones históricas pueden reproducirse con los flujos de examen.",
    tools: {
      status:
        factory.audit === "VERIFIED" &&
        window.mathematicalGapUnits === 0 &&
        notes.checkedWithThreeIndependentRanks === notes.registered
          ? "VERIFIED_IN_TWO_DELIVERED_TOOL_FAMILIES"
          : "REVIEW",
      factoryCases: factory.exam.total,
      factoryCorrect: factory.exam.correct,
      creditNotes: notes.registered,
      fullFileRows: full.lines,
      browserAuditMs: browser.browserAuditMs,
      signedIntakeRows: admission.submitted.retainedRows,
      signedIntakeAudit: admission.bookStatus,
      allCreditIntervalsPreserved: full.allNoteIntervalsIdentical,
      fullCertificateBytes: full.formats.legacy.certificateBytes,
      compactCertificateBytes: full.formats.compact.certificateBytes,
      creditNotesChecked: notes.checkedWithThreeIndependentRanks,
      coverageGapUnits: window.mathematicalGapUnits,
      historicalNotesReexamined: history.examinedNotes,
      enduranceSeconds: endurance.factory.elapsedSeconds,
      fullExportsDuringEndurance: endurance.factory.fullExports,
      historicalMonthsWithBothEndpointsVerified: history.periods.filter(
        (p) => p.lowerAndUpperAttainedIndependently,
      ).length,
      reviewShiftMinutes: 60,
      documentaryVolumeCents: queue.runs.find((r) => r.spec.minutes === 60)
        .reviewCents,
      currency: window.currency,
    },
    research: {
      status:
        prices.verdict === "KEEP_LISTED_PRICE" &&
        hill.relativeToSimple === "KEEP_SIMPLE" &&
        !prospects.comparisonPassed
          ? "KEEP_EXISTING_METHODS_IN_THESE_EXAMS"
          : "REVIEW_EXAMINED_SCOPE",
      iowa: {
        correct: periodTotal("exact"),
        referenceCorrect: periodTotal("baseline"),
        cases: periodTotal("cases"),
      },
      prospecting: {
        records: prospects.support.holdout,
        capacity: prospects.totals.selected.selected,
        observedSubscriptions: prospects.totals.selected.hits,
        expectedByUniformSelection: prospects.uniformSelection.expectedHits,
        incrementalVsSimple: prospects.additionalRecordedSubscriptionsVsSimple,
        causalSales: prospects.counterfactualSales,
      },
      campaign: {
        heldOut: hill.support.holdout,
        selected: hill.selected,
        estimatedCentsPerCustomerVsNoContact: hill.selectedVsNoContact.mean,
        low: hill.selectedVsNoContact.lower,
        high: hill.selectedVsNoContact.upper,
      },
    },
    ownSales: {
      status: money?.status ?? "NO_LIVE_BOOK_SUPPLIED",
      bankCollectedCents: money?.bankCollectedCents ?? null,
      netCents: money?.portfolioNetCents ?? null,
      currency: money?.currency ?? null,
      books: money?.books ?? [],
    },
    population: {
      status: participation.status,
      logicalFounders: participation.population,
      independentTrainingCustomers: participation.customers,
      distinctTrainingDecisions: large.distinctTrainingDecisions,
      sourceExperiments: large.sourceExperiments,
      replicatedAllScoresByOneWorker: large.equalsSingleWorker,
      incrementalAdvantageQualified: selection.vsSimple.lower > 0,
      lowCentsPerCustomerVsSimple: selection.vsSimple.lower,
      highCentsPerCustomerVsSimple: selection.vsSimple.upper,
      scoringP95Ms: times.timings
        .filter((t) => t.method === "tablas" || t.threads === 10)
        .map((t) => ({
          method: t.method,
          threads: t.threads,
          withIndividualReceipts: t.receipts,
          p95: t.p95Ms,
        })),
      warmSingleRequestP95Ms: program.warmStreamMilliseconds.p95,
      burstP95Ms: bursts.results.map((r) => ({
        simultaneous: r.burst,
        medianAcrossTrials: r.current.medianOfP95Ms,
      })),
      repliesVerifiedInLoadTest: bursts.repliesVerified,
      censusRoundsDuringEndurance: endurance.population.rounds,
      sectorContributionsIndependentlyChecked: endurance.population.independentlyHashedContributions,
    },
  };
}
