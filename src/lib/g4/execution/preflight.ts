import type { ExecutionContext } from "./context";
import { resolveExecutor } from "./registry";
import { pinKind } from "./contracts";
import { ConfigError } from "./errors";

/**
 * All-or-nothing preflight (C2-IC1). Validates EVERY frozen AuditRunTestVersion of
 * the authoritative generation BEFORE any result unit runs. Read-only, so it is
 * deterministic across attempts. If ANY selected test is unsupported or its frozen
 * config is invalid, it throws ConfigError → the run fails CONFIG with zero
 * authoritative results. No supported test executes until every test passed.
 */
export function preflight(ctx: ExecutionContext): void {
  if (ctx.testPins.length === 0) throw new ConfigError("no test versions pinned in the authoritative generation");
  for (const pin of ctx.testPins) {
    const kind = pinKind(pin);
    const exec = resolveExecutor(pin);
    if (!exec) throw new ConfigError(`unsupported test (type=${pin.testType}, kind=${kind ?? "none"})`);

    // Grain / dataset-kind compatibility: at least one pinned dataset must be a
    // supported kind for this executor's grain (else the frozen selection is
    // structurally unexecutable and must fail closed rather than emit nothing).
    const compatible = ctx.datasetPins.some((d) => exec.supportedDatasetKinds.includes(d.datasetKind));
    if (!compatible) {
      throw new ConfigError(`test ${pin.testKey} (${kind}) has no pinned dataset of a supported kind [${exec.supportedDatasetKinds.join(",")}]`);
    }

    // Executor-specific frozen-config validation (dependency class, canonical params).
    exec.validateFrozenConfig(ctx, pin);
  }
}
