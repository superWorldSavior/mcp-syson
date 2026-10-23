/** Viewer commands and help; source labels and authored element states stay literal. */
const fr: Record<string, string> = {
  "Views": "Vues",
  "Diagram": "Diagramme",
  "Diagram path": "Parcours du diagramme",
  "Context selection": "Sélection de contexte",
  "Element details": "Détails de l’élément",
  "SysML element": "Élément SysML",
  "Recorded element identity; live details are unavailable.":
    "Identité enregistrée ; les détails en direct sont indisponibles.",
  "Live element details are unavailable in this host.":
    "Les détails en direct sont indisponibles dans cet hôte.",
  "Loading element details…": "Chargement des détails…",
  "Browse existing views": "Parcourir les vues existantes",
  "Loading…": "Chargement…",
  "Recorded view: live navigation is unavailable.":
    "Vue enregistrée : la navigation en direct est indisponible.",
  "Live view navigation is unavailable in this host.":
    "La navigation entre vues est indisponible dans cet hôte.",
  "Existing view": "Vue existante",
  "Representation": "Représentation",
  "Available native types (no view created):":
    "Types natifs disponibles (aucune vue créée) :",
  "(table viewer required)": "(vue de tableau requise)",
  "View navigation": "Navigation entre vues",
  "This representation needs a table or dedicated viewer; no SVG snapshot was requested.":
    "Cette représentation nécessite une vue de tableau ou dédiée ; aucun SVG n’a été demandé.",
  "Select": "Sélectionner",
  "Pan": "Déplacer",
  "This snapshot has no semantic element identities. Graphical IDs cannot be added to context.":
    "Cet instantané ne contient aucune identité sémantique. Les identifiants graphiques ne peuvent pas être ajoutés au contexte.",
  "Click or Space: add/remove context. Double-click or Enter: inspect.":
    "Clic ou Espace : ajouter/retirer du contexte. Double-clic ou Entrée : examiner.",
  "Updating context…": "Mise à jour du contexte…",
  "Drag background to add fully enclosed elements. Switch to Pan to move the diagram.":
    "Tracez un rectangle sur le fond pour ajouter les éléments entièrement inclus. Passez à Déplacer pour déplacer le diagramme.",
};
export function diagramMessages(locale?: string) {
  return (source: string): string =>
    locale?.toLowerCase().startsWith("fr") ? fr[source] || source : source;
}
