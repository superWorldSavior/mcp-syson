/**
 * Requirements-trace wording, layered over the shared SysON messages. The
 * trace states (`TRACE GAP`, `unknown`, `linked`, `unresolved`) are domain
 * literals and stay untranslated in the markup.
 */
import { createTranslator } from "@mcpview/components";
import { SYSON_MESSAGES_EN, SYSON_MESSAGES_FR } from "../../shared/messages.ts";

const TRACE_MESSAGES_EN = {
  traceEyebrow: "Requirements trace",
  traceTitleFallback: "Satisfaction and verification",
  requirementCountOne: "1 requirement",
  requirementCount: "{count} requirements",
  gapCountOne: "1 gap",
  gapCount: "{count} gaps",
  unresolvedCountOne: "1 unresolved",
  unresolvedCount: "{count} unresolved",
  gapsOnly: "Gaps only",
  noGaps: "No trace gaps",
  satisfiedBy: "Satisfied by",
  verifiedBy: "Verified by",
  traceLinks: "Trace links of {label}",
  tracePath: "Trace path",
  backToTrace: "Back to the trace",
  satisfaction: "Satisfaction",
  unresolvedLinks: "Unresolved satisfaction links",
  verificationUnknownDetail:
    "Verification links are not established by this result.",
  verificationGapDetail: "No verification link was found.",
  satisfactionGapDetail: "No satisfaction link was found.",
  satisfactionUnresolvedDetail: "No satisfying element could be resolved.",
} as const;

const TRACE_MESSAGES_FR = {
  traceEyebrow: "Traçabilité des exigences",
  traceTitleFallback: "Satisfaction et vérification",
  requirementCountOne: "1 exigence",
  requirementCount: "{count} exigences",
  gapCountOne: "1 écart",
  gapCount: "{count} écarts",
  unresolvedCountOne: "1 non résolue",
  unresolvedCount: "{count} non résolues",
  gapsOnly: "Écarts seulement",
  noGaps: "Aucun écart de traçabilité",
  satisfiedBy: "Satisfaite par",
  verifiedBy: "Vérifiée par",
  traceLinks: "Liens de traçabilité de {label}",
  tracePath: "Chemin de traçabilité",
  backToTrace: "Revenir à la traçabilité",
  satisfaction: "Satisfaction",
  unresolvedLinks: "Liens de satisfaction non résolus",
  verificationUnknownDetail:
    "Ce résultat n’établit pas les liens de vérification.",
  verificationGapDetail: "Aucun lien de vérification n’a été trouvé.",
  satisfactionGapDetail: "Aucun lien de satisfaction n’a été trouvé.",
  satisfactionUnresolvedDetail:
    "Aucun élément satisfaisant n’a pu être résolu.",
} as const satisfies {
  readonly [K in keyof typeof TRACE_MESSAGES_EN]: string;
};

export const traceMessages = createTranslator({
  defaultLocale: "en",
  messages: { ...SYSON_MESSAGES_EN, ...TRACE_MESSAGES_EN },
  translations: { fr: { ...SYSON_MESSAGES_FR, ...TRACE_MESSAGES_FR } },
});
