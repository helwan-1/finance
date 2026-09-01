import type { AnomalyDTO, AnomalyFilters } from "./ui-types";

/**
 * Apply the FilterBar filters to a list of anomalies. Used by the demo-data
 * fallback path; the DB path pushes equivalent predicates into the query.
 */
export function filterAnomalies(
  anomalies: readonly AnomalyDTO[],
  filters: AnomalyFilters,
): AnomalyDTO[] {
  const search = filters.search.trim().toLowerCase();
  const fromMs = filters.from ? new Date(filters.from).getTime() : null;
  const toMs = filters.to ? new Date(filters.to).getTime() : null;

  return anomalies.filter((a) => {
    if (filters.severity !== "ALL" && a.severity !== filters.severity) {
      return false;
    }
    if (filters.ruleCode !== "ALL" && a.ruleCode !== filters.ruleCode) {
      return false;
    }
    if (filters.status !== "ALL" && a.status !== filters.status) {
      return false;
    }
    if (search) {
      const haystack = [
        a.titleAr,
        a.title,
        a.descriptionAr,
        a.description,
        a.reference ?? "",
        a.counterparty ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    const detectedMs = new Date(a.detectedAt).getTime();
    if (fromMs !== null && detectedMs < fromMs) return false;
    if (toMs !== null && detectedMs > toMs) return false;
    return true;
  });
}

/** Parse raw URLSearchParams into a typed AnomalyFilters object. */
export function parseFilters(params: URLSearchParams): AnomalyFilters {
  const asEnum = <T extends string>(
    value: string | null,
    fallback: T | "ALL",
  ): T | "ALL" => (value ? (value as T) : fallback);

  return {
    search: params.get("search") ?? "",
    severity: asEnum(params.get("severity"), "ALL"),
    ruleCode: asEnum(params.get("ruleCode"), "ALL"),
    status: asEnum(params.get("status"), "ALL"),
    from: params.get("from"),
    to: params.get("to"),
  };
}
