/**
 * C1 execution errors, each carrying an existing AuditFailureCode and whether it
 * is a retryable job failure or a terminal run failure (ADR maps in §24 of the
 * frozen design). No new enum values are introduced.
 */
export type FailureCode =
  | "INFRA" | "TRANSIENT" | "LEASE_LOST" | "VALIDATION" | "CONFIG" | "DETERMINISM" | "UNPINNED_DEPENDENCY";

export class ExecutionError extends Error {
  constructor(public readonly failureCode: FailureCode, public readonly terminalRun: boolean, message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

/** Fence assertion failed — this attempt lost ownership. Retryable (a new attempt may claim). */
export class LeaseLostError extends ExecutionError {
  constructor(message = "lease lost / not owner") { super("LEASE_LOST", false, message); this.name = "LeaseLostError"; }
}

/** Run was cancelled and observed through the fence. Not a failure of the run. */
export class RunCancelledError extends ExecutionError {
  constructor(message = "run cancelled") { super("CONFIG", false, message); this.name = "RunCancelledError"; }
}

/** Frozen configuration is invalid (missing freezeGeneration / build / pins). Terminal. */
export class ConfigError extends ExecutionError {
  constructor(message: string) { super("CONFIG", true, message); this.name = "ConfigError"; }
}

/** Engine build differs from the frozen run's build. Fail-closed, terminal. */
export class DeterminismError extends ExecutionError {
  constructor(message: string) { super("DETERMINISM", true, message); this.name = "DeterminismError"; }
}

/** Evidence would fall outside the frozen population. Fail-closed, terminal. */
export class EvidenceOutOfPopulationError extends ExecutionError {
  constructor(datasetId: string, sourceRowNo: number) {
    super("VALIDATION", true, `evidence (dataset=${datasetId}, row=${sourceRowNo}) is not a frozen population member`);
    this.name = "EvidenceOutOfPopulationError";
  }
}

/** A consumed AccountMappingVersion is not pinned in the authoritative generation. Terminal. */
export class UnpinnedDependencyError extends ExecutionError {
  constructor(datasetAccountId: string) {
    super("UNPINNED_DEPENDENCY", true, `account mapping for datasetAccount ${datasetAccountId} is not pinned in the authoritative generation`);
    this.name = "UnpinnedDependencyError";
  }
}
