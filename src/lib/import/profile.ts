import { profileHash, type ProfileFingerprintInput } from "./canonical";
import { PARSER_VERSION, NORMALIZER_VERSION } from "./vocab";
import type { DateInterpretation } from "./validate";

/**
 * Effective import profile (Closure C: declared ∪ detected, then frozen). The
 * effective values actually used during ingestion are frozen on the ImportBatch
 * with their hash, so ingestion is reproducible.
 */
export interface EffectiveProfile extends ProfileFingerprintInput {
  dateInterpretationEnum: DateInterpretation;
  hash: string;
}

export interface ProfileInput {
  format: "CSV" | "XLSX";
  encoding?: string;
  delimiter?: string | null;
  sheet?: string | null;
  headerRow?: number;
  locale?: string;
  dateInterpretation?: DateInterpretation;
  numberInterpretation?: string;
}

export function buildEffectiveProfile(input: ProfileInput): EffectiveProfile {
  const dateInterp = input.dateInterpretation ?? "ISO";
  const core: ProfileFingerprintInput = {
    format: input.format,
    encoding: input.encoding ?? "utf-8",
    delimiter: input.format === "CSV" ? (input.delimiter ?? ",") : null,
    sheet: input.format === "XLSX" ? (input.sheet ?? "0") : null,
    headerRow: input.headerRow ?? 1,
    locale: input.locale ?? "ar-SA",
    dateInterpretation: dateInterp,
    numberInterpretation: input.numberInterpretation ?? "decimal-point",
    parserVersion: PARSER_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
  };
  return { ...core, dateInterpretationEnum: dateInterp, hash: profileHash(core) };
}
