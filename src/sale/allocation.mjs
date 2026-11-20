import { strict } from "../policy.mjs";
import { hash, num, check, unique, list, key } from "../factory/reader.mjs";
import { cost, fee } from "./pricing.mjs";

function prepare(s, input, at) {
  strict(input, [
    "offers",
    "work",
    "worlds",
    "maxOutlayCents",
    "minutes",
    "maxLossCents",
  ]);
  unique(list(input.offers, 1, 17).map(key));
  strict(input.work, input.offers);
  num(input.maxOutlayCents, 0, 1e10);
  num(input.maxLossCents, 0, 1e10);
  num(input.minutes, 0, 10080);
  const offers = input.offers.map((id) => {
    const o = s.sales.offers.get(id);
    check(
      o && !o.delivery && !o.close && !o.decline && (o.order || at < o.expires),
      "Oferta ajena, vencida o terminada",
    );
    const w = input.work[id];
    strict(w, ["minutes", "preparationCents"]);
    num(w.minutes, 1, 10080);
    num(w.preparationCents, 0, 1e10);
    return { ...o, work: w, exclusive: hash([o.buyer, o.inputHash]) };
  });
  check(
    new Set(offers.map((o) => o.mode)).size === 1 &&
      new Set(offers.map((o) => o.account)).size === 1,
    "Se requiere una sola caja y modo para optimizar",
  );
  const account = s.sales.accounts.get(offers[0].account);
  const outsideHold = [...s.sales.offers.values()]
    .filter(
      (o) =>
        o.account === account.id &&
        o.order &&
        !o.close &&
        !input.offers.includes(o.id),
    )
    .reduce((n, o) => n + o.order.maxCost, 0);
  const cash = Math.max(
    0,
    Math.min(
      input.maxOutlayCents,
      account.balance - outsideHold,
      s.open.budgetCents - s.spent - s.held,
    ),
  );
  unique(
    list(input.worlds, 1, 8).map((w) => {
      strict(w, ["id", "source", "recovery"]);
      key(w.id);
      check(/^[a-f0-9]{64}$/.test(w.source), "Escenario sin referencia");
      strict(w.recovery, input.offers);
      for (const o of offers) {
        const x = w.recovery[o.id];
        if (x === null)
          check(
            !o.order,
            "Un pedido ya firmado requiere modelar su posible recuperación",
          );
        else num(x, 0, o.terms.ceilingCents);
      }
      return w.id;
    }),
  );
  check(
    !input.worlds.some((w) => w.id === "sin-captura"),
    "Nombre de escenario reservado",
  );
  const worlds = [
    ...input.worlds,
    {
      id: "sin-captura",
      source: "Escenario de estrés incluido por el motor",
      recovery: Object.fromEntries(
        offers.map((o) => [o.id, o.order ? 0 : null]),
      ),
    },
  ];
  const rows = offers.map((o) => {
    const outcomes = worlds.map((w) => {
      const x = w.recovery[o.id],
        spent =
          o.work.preparationCents +
          (x === null ? 0 : cost(x, o.choice.selected));
      return {
        spent,
        net: (x === null ? 0 : fee(x, o.choice.selected)) - spent,
      };
    });
    return {
      id: o.id,
      exclusive: o.exclusive,
      minutes: o.work.minutes,
      outcomes,
    };
  });
  return {
    rows,
    worlds: worlds.map((w) => w.id),
    cash,
    minutes: input.minutes,
    maxLoss: input.maxLossCents,
  };
}
// Enumerate feasible plans in deterministic order. A universal zero-capture scenario constrains the downside.
function enumerate(p, visit) {
  const nets = p.worlds.map(() => 0),
    expense = p.worlds.map(() => 0),
    exclusive = new Set();
  function walk(start, mask, minutes) {
    visit(mask, nets, expense, minutes);
    for (let i = start; i < p.rows.length; i++) {
      const r = p.rows[i];
      if (
        minutes + r.minutes > p.minutes ||
        exclusive.has(r.exclusive) ||
        r.outcomes.some((v, j) => v.spent + expense[j] > p.cash)
      )
        continue;
      r.outcomes.forEach((v, j) => {
        nets[j] += v.net;
        expense[j] += v.spent;
      });
      exclusive.add(r.exclusive);
      // Losses may be offset by another profitable order, so the downside is checked only in the objective.
      walk(i + 1, mask | (1 << i), minutes + r.minutes);
      exclusive.delete(r.exclusive);
      r.outcomes.forEach((v, j) => {
        nets[j] -= v.net;
        expense[j] -= v.spent;
      });
    }
  }
  walk(0, 0, 0);
}
export function allocateSales(s, input, at) {
  if (!s.open || at >= s.open.until || s.spent >= s.open.budgetCents)
    return { status: "BUDGET_OR_WINDOW_CLOSED", selected: [] };
  const p = prepare(s, input, at),
    best = p.worlds.map(() => 0);
  let feasible = 0;
  enumerate(p, (mask, nets) => {
    if (Math.min(...nets) < -p.maxLoss) return;
    feasible++;
    nets.forEach((n, i) => (best[i] = Math.max(best[i], n)));
  });
  let winner = null;
  const singles = new Map();
  enumerate(p, (mask, nets, expense, minutes) => {
    const floor = Math.min(...nets);
    if (floor < -p.maxLoss) return;
    const regret = Math.max(...best.map((v, i) => v - nets[i])),
      cash = Math.max(...expense);
    const score = [regret, -floor, cash, minutes, mask];
    const first = winner
      ? score.findIndex((v, i) => v !== winner.score[i])
      : -1;
    if (!winner || (first >= 0 && score[first] < winner.score[first]))
      winner = { mask, score, nets: [...nets] };
    if (mask && !(mask & (mask - 1)))
      singles.set(p.rows[Math.log2(mask)].id, {
        netFloor: floor,
        worstRegret: regret,
      });
  });
  return {
    status: winner.mask ? "PROPOSE_ALLOCATION" : "HOLD",
    selected: p.rows.filter((_, i) => winner.mask & (1 << i)).map((r) => r.id),
    mode: s.sales.offers.get(input.offers[0]).mode,
    netByScenario: Object.fromEntries(
      p.worlds.map((k, i) => [k, winner.nets[i]]),
    ),
    assumedBestByScenario: Object.fromEntries(
      p.worlds.map((k, i) => [k, best[i]]),
    ),
    worstRegretCents: winner.score[0],
    worstNetCents: -winner.score[1],
    cashAtRiskCents: winner.score[2],
    minutes: winner.score[3],
    singleOffers: Object.fromEntries(singles),
    cashLimitCents: p.cash,
    feasiblePlans: feasible,
    certificate: hash([input, p, winner, best, feasible]),
    interpretation:
      "Óptimo para los escenarios, límite de pérdida, caja y tiempos declarados. Los importes proyectados se excluyen de las ventas registradas.",
  };
}
