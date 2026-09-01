import { PROFESSIONAL_RULES } from "./rules/library";
import type { RuleDTO } from "./ui-types";

/**
 * Demo rules list = the professional starter library, presented as firm-wide
 * rules. Used as the API fallback when no database is provisioned so the Rules
 * page renders out of the box.
 */
export const DEMO_RULES: RuleDTO[] = PROFESSIONAL_RULES.map((r) => ({
  id: r.code,
  code: r.code,
  nameAr: r.nameAr,
  category: r.category,
  severity: r.severity,
  enabled: true,
  scope: "FIRM",
  descriptionAr: r.descriptionAr,
  definition: r.definition as unknown as Record<string, unknown>,
}));
