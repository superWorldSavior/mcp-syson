/** Value-change wording (UX v1). Shared SysON keys stay in `shared/messages.ts`. */

import { createTranslator } from "@mcpview/components";
import { SYSON_MESSAGES_EN, SYSON_MESSAGES_FR } from "../../shared/messages";

const VALUE_MESSAGES_EN = {
  before: "Before",
  after: "After",
  changeDetail: "Change {delta}",
  negatedLiteral: "{kind}, negated",
  elementFallback: "Model element",
  identityLoading: "Resolving the element…",
  identityUnavailable: "Name not available in this result",
  source: "Source",
  recordedSource: "Recorded session · project revision {revision}",
} as const;

type ValueMessageKey = keyof typeof VALUE_MESSAGES_EN;

const VALUE_MESSAGES_FR = {
  before: "Avant",
  after: "Après",
  changeDetail: "Variation {delta}",
  negatedLiteral: "{kind}, négatif",
  elementFallback: "Élément du modèle",
  identityLoading: "Résolution de l’élément…",
  identityUnavailable: "Nom indisponible dans ce résultat",
  source: "Source",
  recordedSource: "Session enregistrée · révision {revision} du projet",
} as const satisfies { readonly [K in ValueMessageKey]: string };

/** Shared SysON dictionary extended with this viewer's keys, English and French. */
export const valueMessages = createTranslator({
  defaultLocale: "en",
  messages: { ...SYSON_MESSAGES_EN, ...VALUE_MESSAGES_EN },
  translations: { fr: { ...SYSON_MESSAGES_FR, ...VALUE_MESSAGES_FR } },
});
