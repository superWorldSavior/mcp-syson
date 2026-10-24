/** Query-results wording (UX v1). Shared SysON keys stay in `shared/messages.ts`. */

import { createTranslator } from "@mcpview/components";
import { SYSON_MESSAGES_EN, SYSON_MESSAGES_FR } from "../../shared/messages";

const QUERY_MESSAGES_EN = {
  searchResults: "Search results",
  searchKind: "Search",
  aqlKind: "AQL",
  queryText: "Query",
  showFullQuery: "Show the full query",
  collapseQuery: "Collapse the query",
  selectedScopeOne: "on 1 selected element",
  selectedScopeMany: "on {count} selected elements",
  filterResultsPlaceholder: "Filter results…",
  sortResults: "Sort results",
  sortBy: "Sort",
  sortAscending: "{key}, ascending",
  sortDescending: "{key}, descending",
  kindsInResults: "Results by kind",
  noMatchingResults: "No result matches this filter.",
  emptyQuery: "This query returned no elements.",
  returnedValue: "Returned value",
} as const;

type QueryMessageKey = keyof typeof QUERY_MESSAGES_EN;

const QUERY_MESSAGES_FR = {
  searchResults: "Résultats de recherche",
  searchKind: "Recherche",
  aqlKind: "AQL",
  queryText: "Requête",
  showFullQuery: "Afficher la requête complète",
  collapseQuery: "Replier la requête",
  selectedScopeOne: "sur 1 élément sélectionné",
  selectedScopeMany: "sur {count} éléments sélectionnés",
  filterResultsPlaceholder: "Filtrer les résultats…",
  sortResults: "Trier les résultats",
  sortBy: "Tri",
  sortAscending: "{key}, croissant",
  sortDescending: "{key}, décroissant",
  kindsInResults: "Résultats par genre",
  noMatchingResults: "Aucun résultat ne correspond à ce filtre.",
  emptyQuery: "Cette requête n’a renvoyé aucun élément.",
  returnedValue: "Valeur renvoyée",
} as const satisfies { readonly [K in QueryMessageKey]: string };

/** Shared SysON dictionary extended with this viewer's keys, English and French. */
export const queryMessages = createTranslator({
  defaultLocale: "en",
  messages: { ...SYSON_MESSAGES_EN, ...QUERY_MESSAGES_EN },
  translations: { fr: { ...SYSON_MESSAGES_FR, ...QUERY_MESSAGES_FR } },
});
