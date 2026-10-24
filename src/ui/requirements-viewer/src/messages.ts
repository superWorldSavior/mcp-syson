/** Authored-requirements wording, layered over the shared SysON messages. */
import { createTranslator } from "@mcpview/components";
import { SYSON_MESSAGES_EN, SYSON_MESSAGES_FR } from "../../shared/messages.ts";

const REQUIREMENTS_MESSAGES_EN = {
  requirementCountOne: "1 requirement",
  requirementCount: "{count} requirements",
  filterRequirements: "Filter requirements",
  filterRequirementsPlaceholder: "Filter requirements…",
  noMatchingRequirements: "No matching requirements",
  requirementKinds: "Requirements by kind",
  requirementPath: "Requirement path",
  backToList: "Back to the list",
  requirementText: "Text",
  textUnavailable: "No documentation text was found for this requirement.",
  textNotCaptured: "This result does not include requirement text.",
  coverage: "Coverage",
  coverageUnknownDetail:
    "Satisfaction and verification are not established by this result.",
  projectId: "Project ID",
  constraintErrorCountOne: "1 constraint error",
  constraintErrorCount: "{count} constraint errors",
} as const;

const REQUIREMENTS_MESSAGES_FR = {
  requirementCountOne: "1 exigence",
  requirementCount: "{count} exigences",
  filterRequirements: "Filtrer les exigences",
  filterRequirementsPlaceholder: "Filtrer les exigences…",
  noMatchingRequirements: "Aucune exigence correspondante",
  requirementKinds: "Exigences par genre",
  requirementPath: "Chemin de l’exigence",
  backToList: "Revenir à la liste",
  requirementText: "Texte",
  textUnavailable:
    "Aucun texte de documentation n’a été trouvé pour cette exigence.",
  textNotCaptured: "Ce résultat n’inclut pas le texte de l’exigence.",
  coverage: "Couverture",
  coverageUnknownDetail:
    "Ce résultat n’établit ni la satisfaction ni la vérification.",
  projectId: "Identifiant du projet",
  constraintErrorCountOne: "1 erreur de contrainte",
  constraintErrorCount: "{count} erreurs de contrainte",
} as const satisfies {
  readonly [K in keyof typeof REQUIREMENTS_MESSAGES_EN]: string;
};

export const requirementsMessages = createTranslator({
  defaultLocale: "en",
  messages: { ...SYSON_MESSAGES_EN, ...REQUIREMENTS_MESSAGES_EN },
  translations: {
    fr: { ...SYSON_MESSAGES_FR, ...REQUIREMENTS_MESSAGES_FR },
  },
});
