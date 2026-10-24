/**
 * Validation viewer wording (UX v1). Extends the shared SysON dictionaries;
 * contract states (error, unresolved, unavailable…) stay literal elsewhere.
 */
import { createTranslator } from "@mcpview/components";
import { SYSON_MESSAGES_EN, SYSON_MESSAGES_FR } from "../../shared/messages.ts";

export const VALIDATION_MESSAGES_EN = {
  diagnostics: "Diagnostics",
  diagnosticsBySeverity: "Diagnostics by severity",
  noDiagnostics: "No diagnostics were reported for this validation.",
  severityError: "Errors",
  severityWarning: "Warnings",
  severityInfo: "Info",
  errorCountOne: "{count} error",
  errorCountMany: "{count} errors",
  warningCountOne: "{count} warning",
  warningCountMany: "{count} warnings",
  infoCountOne: "{count} info",
  infoCountMany: "{count} info",
  selectDiagnostic:
    "Select diagnostic: {message}, constraint {constraint}, in {element}",
} as const;

export type ValidationMessageKey = keyof typeof VALIDATION_MESSAGES_EN;

export const VALIDATION_MESSAGES_FR = {
  diagnostics: "Diagnostics",
  diagnosticsBySeverity: "Diagnostics par sévérité",
  noDiagnostics: "Aucun diagnostic n’a été signalé pour cette validation.",
  severityError: "Erreurs",
  severityWarning: "Avertissements",
  severityInfo: "Informations",
  errorCountOne: "{count} erreur",
  errorCountMany: "{count} erreurs",
  warningCountOne: "{count} avertissement",
  warningCountMany: "{count} avertissements",
  infoCountOne: "{count} information",
  infoCountMany: "{count} informations",
  selectDiagnostic:
    "Sélectionner le diagnostic : {message}, contrainte {constraint}, dans {element}",
} as const satisfies { readonly [K in ValidationMessageKey]: string };

/** Shared SysON keys plus the validation keys, in English and French. */
export const validationMessages = createTranslator({
  defaultLocale: "en",
  messages: { ...SYSON_MESSAGES_EN, ...VALIDATION_MESSAGES_EN },
  translations: { fr: { ...SYSON_MESSAGES_FR, ...VALIDATION_MESSAGES_FR } },
});
