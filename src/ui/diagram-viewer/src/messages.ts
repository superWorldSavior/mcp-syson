/** Diagram-viewer chrome wording (UX v1). Source labels stay literal. */
import { createTranslator } from "@mcpview/components";

export const DIAGRAM_MESSAGES_EN = {
  moreOptions: "More view options",
  browseViews: "Browse existing views",
  renderingDetails: "Rendering details",
  closePanel: "Close",
  currentView: "Current view: {view}",
  retry: "Retry",
  representation: "Representation",
  zoomToSelection: "Zoom to selection",
  selectedInDiagram: "{count} selected in this diagram",
  selectedOne: "1 selected in this diagram",
  overviewMap: "Overview map",
  overviewRegion: "Diagram overview: click or drag to move the view",
  shortcuts: "Shortcuts",
  shortcutsTitle: "Mouse and keyboard",
  helpClick: "Click an element: add or remove it from AI context",
  helpOpen: "Double-click or Enter: open its details",
  helpRectangle: "Drag on the background: add the blocks inside",
  helpPan: "Pan mode, or hold Space and drag: move the view",
  helpZoom: "Wheel or + / −: zoom",
  helpFit: "0 or F: fit the whole diagram",
  elementDetails: "Element details",
  diagramView: "Diagram view",
  elementKind: "Kind",
  openedFrom: "In {view}",
} as const;

export type DiagramMessageKey = keyof typeof DIAGRAM_MESSAGES_EN;

export const DIAGRAM_MESSAGES_FR: Readonly<Record<DiagramMessageKey, string>> =
  {
    moreOptions: "Plus d’options de vue",
    browseViews: "Parcourir les vues existantes",
    renderingDetails: "Détails du rendu",
    closePanel: "Fermer",
    currentView: "Vue actuelle : {view}",
    retry: "Réessayer",
    representation: "Représentation",
    zoomToSelection: "Zoomer sur la sélection",
    selectedInDiagram: "{count} sélectionnés dans ce diagramme",
    selectedOne: "1 sélectionné dans ce diagramme",
    overviewMap: "Mini-carte",
    overviewRegion:
      "Vue d’ensemble du diagramme : cliquer ou glisser pour déplacer la vue",
    shortcuts: "Raccourcis",
    shortcutsTitle: "Souris et clavier",
    helpClick:
      "Clic sur un élément : l’ajouter au contexte de l’IA ou l’en retirer",
    helpOpen: "Double-clic ou Entrée : ouvrir son détail",
    helpRectangle: "Glisser sur le fond : ajouter les blocs inclus",
    helpPan: "Mode Déplacer, ou Espace maintenu + glisser : déplacer la vue",
    helpZoom: "Molette ou + / − : zoomer",
    helpFit: "0 ou F : ajuster tout le diagramme",
    elementDetails: "Détail de l’élément",
    diagramView: "Vue du diagramme",
    elementKind: "Genre",
    openedFrom: "Dans {view}",
  };

export const diagramViewerMessages = createTranslator({
  defaultLocale: "en",
  messages: DIAGRAM_MESSAGES_EN,
  translations: { fr: DIAGRAM_MESSAGES_FR },
});
