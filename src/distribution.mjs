import { performance } from "node:perf_hooks";
import { NativeWorker } from "./native.mjs";
import { digest, integer, strict } from "./policy.mjs";

function checkJobs(jobs) {
  if (!Array.isArray(jobs) || !jobs.length || jobs.length > 8192)
    throw Error("Lote inválido (1 a 8192 solicitudes)");
  const keys = new Set();
  for (const job of jobs) {
    strict(job, ["key", "command"]);
    if (
      typeof job?.key !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(job.key) ||
      job.command?.type !== "dispatch_inquiry" ||
      keys.has(job.key)
    )
      throw Error("Solicitud inválida o clave repetida en el lote");
    keys.add(job.key);
  }
}

// Only row keys travel. Source values, balances and write access stay with the coordinator.
export function packBatch(system, jobs) {
  checkJobs(jobs);
  const tickets = jobs.map(({ key, command }) => {
    const { packet } = system.prepareDossier(key, command);
    return { key, binding: digest({ key, command }), packet: packet ?? null };
  });
  return { id: digest(tickets), tickets };
}

async function scanWithRetry(worker, backup, packet) {
  try {
    return { seal: await worker.scan(packet), attempts: 1, host: worker.host };
  } catch {
    worker.close();
    const second = backup();
    try {
      return {
        seal: await second.scan(packet),
        attempts: 2,
        host: second.host,
      };
    } finally {
      second.close();
    }
  }
}

export async function scanShard(batch, index, count) {
  integer(count, 1, 64, "particiones");
  integer(index, 0, count - 1, "partición");
  if (digest(batch.tickets) !== batch.id)
    throw Error("Lote de trabajo alterado");
  const worker = new NativeWorker(),
    results = [];
  const start = performance.now(),
    wallStart = Date.now();
  try {
    for (let i = index; i < batch.tickets.length; i += count) {
      const { key, binding, packet } = batch.tickets[i];
      const queueMs = performance.now() - start;
      const result = packet
        ? await scanWithRetry(worker, () => new NativeWorker(), packet)
        : { seal: null, attempts: 0 };
      results.push({
        key,
        binding,
        seal: result.seal,
        attempts: result.attempts,
        queueMs,
        elapsedMs: performance.now() - start,
      });
    }
  } finally {
    worker.close();
  }
  return {
    batch: batch.id,
    index,
    count,
    startedAt: wallStart,
    endedAt: Date.now(),
    results,
  };
}

// Artifacts may arrive out of order. Verify exactly one result per scheduled key
// before any new write. The ledger subsequently verifies each proof against source.
export async function mergeShards(system, jobs, batch, parts, onCommit) {
  checkJobs(jobs);
  if (
    digest(batch.tickets) !== batch.id ||
    batch.tickets.length !== jobs.length ||
    !parts.length
  )
    throw Error("Lote incompatible");
  const count = parts[0].count;
  integer(count, 1, 64, "particiones");
  if (
    parts.length !== count ||
    new Set(parts.map((p) => p.index)).size !== count
  )
    throw Error("Partición incompleta o duplicada");
  const rows = new Map();
  for (const p of parts) {
    integer(p.index, 0, count - 1, "partición");
    if (p.batch !== batch.id || p.count !== count || !Array.isArray(p.results))
      throw Error("Partición incompatible");
    let n = 0;
    for (let i = p.index; i < jobs.length; i += count) {
      const ticket = batch.tickets[i],
        row = p.results[n++],
        job = jobs[i];
      if (
        ticket.key !== job.key ||
        ticket.binding !== digest(job) ||
        row?.key !== job.key ||
        row.binding !== ticket.binding
      )
        throw Error("Resultado mal atribuido");
      rows.set(job.key, row);
    }
    if (n !== p.results.length) throw Error("Resultado sobrante");
  }
  const output = [];
  for (const job of jobs) {
    const start = performance.now(),
      r = await system.confirmDossier(
        job.key,
        job.command,
        rows.get(job.key).seal,
      );
    const item = {
      key: job.key,
      receipt: r,
      commitMs: performance.now() - start,
      committedAt: Date.now(),
    };
    output.push(item);
    onCommit?.(item);
  }
  return output;
}

// Keep remote scans outside SQLite's writer lock. A rerun of the same input file
// resumes after the last committed key. Failures in one slot do not discard its peers.
export async function runBatch(
  system,
  jobs,
  hosts = ["local"],
  { workerFor = (h) => new NativeWorker(h) } = {},
) {
  checkJobs(jobs);
  integer(hosts.length, 1, 64, "trabajadores");
  const workers = [];
  const output = Array(jobs.length);
  let next = 0;
  const start = performance.now();
  try {
    for (const host of hosts.slice(0, jobs.length))
      workers.push(workerFor(host));
    async function drain(worker, slot) {
      while (next < jobs.length) {
        const i = next++,
          { key, command } = jobs[i],
          queueMs = performance.now() - start;
        try {
          const plan = system.prepareDossier(key, command);
          let receipt = plan.receipt,
            scan = { seal: null, attempts: 0, host: null },
            commitMs = 0;
          if (!receipt) {
            if (plan.packet)
              scan = await scanWithRetry(
                worker,
                () => workerFor(hosts[(slot + 1) % hosts.length]),
                plan.packet,
              );
            const before = performance.now();
            receipt = await system.confirmDossier(key, command, scan.seal);
            commitMs = performance.now() - before;
          }
          output[i] = {
            key,
            receipt,
            cached: !!plan.receipt,
            attempts: scan.attempts,
            host: scan.host,
            queueMs,
            commitMs,
            elapsedMs: performance.now() - start,
          };
        } catch (error) {
          output[i] = {
            key,
            error: String(error.message),
            queueMs,
            elapsedMs: performance.now() - start,
          };
        }
      }
    }
    await Promise.all(workers.map(drain));
    return { elapsedMs: performance.now() - start, results: output };
  } finally {
    for (const worker of workers) worker.close();
  }
}
