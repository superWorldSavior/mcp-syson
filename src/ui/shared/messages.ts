/** Provider-owned interface wording. Domain states and source values stay literal. */

export const SYSON_MESSAGES_EN = {
  loadingDiagram: "Waiting for diagram data…",
  loadingModel: "Waiting for model elements…",
  loadingQuery: "Waiting for query results…",
  loadingRequirements: "Waiting for authored requirements…",
  loadingTrace: "Waiting for requirements trace data…",
  loadingValidation: "Validating constraints…",
  loadingValue: "Waiting for value data…",
  emptyDiagram: "No diagram data received",
  sessionRejected: "Recorded {view} session rejected.",
  toolErrorTitle: "Operation failed",
  invalidToolDataTitle: "Result unavailable",
  invalidToolDataMessage:
    "The returned data does not match this viewer's expected format.",
  modelPath: "Model path",
  modelRoot: "Model",
  back: "Back to parent",
  retainedLevels: "Previous levels",
  navigationUnavailable:
    "Browsing is unavailable in this host or recorded result.",
  loadingChildren: "Loading children…",
  navigationFailed: "Could not open this element.",
  openChildren: "Open {label}",
  selectionPending: "Waiting for the host to accept the selection…",
  selectionFailed: "The host did not accept the selection.",
  authoredConstraintsOnly: "Authored constraints",
  authoredConstraintsNotValidated:
    "Declared expressions; measurements and validation have not been resolved.",
  authoredConstraintsUnavailable: "Authored constraints unavailable",
  authoredConstraintsBounded:
    "Constraint details are loaded for the first 10 requirements.",
  authoredConstraintsNotCaptured:
    "This result does not contain authored constraint details.",

  unnamed: "(unnamed)",
  unnamedRequirement: "(unnamed requirement)",
  selectItem: "Select {label}",
  root: "root",
  unknown: "unknown",
  technicalDetails: "Technical details",
  rowIdentities: "Row identities",

  diagramFallback: "Diagram",
  nodes: "Nodes",
  edges: "Edges",
  renderer: "Renderer",
  localSvg: "Local SVG",
  krokiSvg: "Kroki SVG",
  noDiagram: "No diagram",
  noDiagramContent: "Diagram has no SVG content",
  diagramUnavailable: "Diagram unavailable",
  recordedSvgRejected: "Recorded SVG rejected: {reason}",
  rendererWarning: "Renderer warning",
  zoomControls: "Diagram zoom controls",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Fit",
  fitRecordedSvg: "Fit recorded SVG",
  diagramCanvasAria:
    "Recorded SysON diagram. Drag to pan; use plus, minus, or zero to zoom and fit.",
  diagramHelp: "Drag to pan · wheel or +/− to zoom · 0 or F to fit",
  diagramElements: "Diagram elements",
  noElements: "No elements",
  noSemanticElements: "The diagram contains no semantic elements.",
  diagramIdentity: "Diagram identity",

  modelChildren: "Model children",
  elements: "Elements",
  children: "Children",
  filterModelElements: "Filter model elements",
  filterElementsPlaceholder: "Filter elements…",
  modelElements: "Model elements",
  noMatchingChildren: "No matching children",
  kinds: "Kinds",
  kindCounts: "Element kind counts",
  noKinds: "No kinds",
  parent: "Parent",

  queryResult: "Query result",
  objectCount: "Objects",
  value: "Value",
  expression: "Expression",
  queryExpression: "Query expression",
  noExpression: "No expression supplied",
  objectResults: "Object results",
  queryResultControls: "Query result controls",
  filterQueryResults: "Filter query results",
  filterQueryPlaceholder: "Filter query results…",
  labelSort: "Label",
  kindSort: "Kind",
  queryResults: "Query results",
  noResults: "No results",

  authoredRequirements: "Authored requirements",
  limitCountOne: "{count} limit",
  limitCountMany: "{count} limits",
  authoredLimit: "Authored limit",
  noAuthoredRequirements: "No authored requirements",

  coverageLabel: "Satisfaction-link coverage",
  linkCoverage: "Link coverage",
  coverageUnavailable:
    "No requirements were returned, so link coverage cannot be assessed.",
  traceFailedWithoutDetail:
    "The requirements trace failed without an error detail.",
  rootIdentity: "Root identity",
  requirements: "Requirements",
  coverageFilter: "Requirement coverage filter",
  filterAll: "all",
  requirementTraces: "Requirement traces",
  noModeRequirements: "No {mode} requirements",
  noRequirements: "No requirements",
  noSatisfactionLinks: "No satisfaction links",
  noTraceEvidence: "No trace evidence was returned.",
  satisfactionLinks: "Satisfaction links",
  satisfiedByElements: "Satisfied-by elements",
  traceInspection: "Trace and link inspection",

  validation: "Validation",
  constraints: "Constraints",
  validated: "Validated",
  cannotClaimPass:
    "No constraints were returned, so this surface cannot claim a pass.",
  resolvedModelValues: "Resolved model values",
  noResolvedValues: "No resolved model values",
  constraintResults: "Constraint validation results",
  missingRefs: "Missing: {refs}",
  thresholdDetail: "threshold {value}",
  noConstraints: "No constraints found on this element",

  currentValue: "Current value",
  numericLiteral: "Numeric literal",
  numericLiteralLower: "numeric literal",
  valueChange: "Value change",
  previous: "Previous",
  requested: "Requested",
  readBack: "Read-back",
  change: "Change",
  elementIdentity: "Element identity",
  literal: "Literal",
  evidenceStatus: "Evidence status",
  documentaryUnverifiedMessage:
    "The literal was read and displayed. No independent verification, constraint evaluation, or engineering proof is attached.",
  readBackEvidence: "Read-back evidence",
  noReadBack: "No read-back value was returned.",
  readBackMatches: "Read-back {observed} matches requested {requested}.",
  readBackDoesNotMatch:
    "Read-back {observed} does not match requested {requested}.",
  evidenceDisclaimer:
    "This confirms only the returned literal value, not model semantics or engineering verification.",
  readBackWarning: "Read-back warning",
  readBackMatched: "Read-back matched",
  writeNotConfirmed: "Write not confirmed",
  immediateReadBackMatched: "Immediate read-back matched",
} as const;

export type SysonMessageKey = keyof typeof SYSON_MESSAGES_EN;

export const SYSON_MESSAGES_FR = {
  loadingDiagram: "En attente des données de diagramme…",
  loadingModel: "En attente des éléments de modèle…",
  loadingQuery: "En attente des résultats de requête…",
  loadingRequirements: "En attente des exigences rédigées…",
  loadingTrace: "En attente des données de traçabilité…",
  loadingValidation: "Validation des contraintes…",
  loadingValue: "En attente des données de valeur…",
  emptyDiagram: "Aucune donnée de diagramme reçue",
  sessionRejected: "Session enregistrée {view} rejetée.",
  toolErrorTitle: "Échec de l’opération",
  invalidToolDataTitle: "Résultat indisponible",
  invalidToolDataMessage:
    "Les données renvoyées ne correspondent pas au format attendu par cette vue.",
  modelPath: "Chemin du modèle",
  modelRoot: "Modèle",
  back: "Revenir au parent",
  retainedLevels: "Niveaux précédents",
  navigationUnavailable:
    "La navigation est indisponible dans cet hôte ou cette capture enregistrée.",
  loadingChildren: "Chargement des enfants…",
  navigationFailed: "Impossible d’ouvrir cet élément.",
  openChildren: "Ouvrir {label}",
  selectionPending: "En attente de l’acceptation de la sélection par l’hôte…",
  selectionFailed: "L’hôte n’a pas accepté la sélection.",
  authoredConstraintsOnly: "Contraintes déclarées",
  authoredConstraintsNotValidated:
    "Expressions déclarées ; mesures et validation non résolues.",
  authoredConstraintsUnavailable: "Contraintes déclarées indisponibles",
  authoredConstraintsBounded:
    "Le détail des contraintes est chargé pour les 10 premières exigences.",
  authoredConstraintsNotCaptured:
    "Ce résultat ne contient pas le détail des contraintes déclarées.",

  unnamed: "(sans nom)",
  unnamedRequirement: "(exigence sans nom)",
  selectItem: "Sélectionner {label}",
  root: "racine",
  unknown: "inconnu",
  technicalDetails: "Détails techniques",
  rowIdentities: "Identifiants des lignes",

  diagramFallback: "Diagramme",
  nodes: "Nœuds",
  edges: "Arêtes",
  renderer: "Moteur de rendu",
  localSvg: "SVG local",
  krokiSvg: "SVG Kroki",
  noDiagram: "Pas de diagramme",
  noDiagramContent: "Le diagramme n’a pas de contenu SVG",
  diagramUnavailable: "Diagramme indisponible",
  recordedSvgRejected: "SVG enregistré rejeté : {reason}",
  rendererWarning: "Avertissement du moteur de rendu",
  zoomControls: "Commandes de zoom du diagramme",
  zoomIn: "Zoom avant",
  zoomOut: "Zoom arrière",
  fit: "Ajuster",
  fitRecordedSvg: "Ajuster le SVG enregistré",
  diagramCanvasAria:
    "Diagramme SysON enregistré. Glisser pour déplacer ; plus, moins ou zéro pour zoomer et ajuster.",
  diagramHelp:
    "Glisser pour déplacer · molette ou +/− pour zoomer · 0 ou F pour ajuster",
  diagramElements: "Éléments du diagramme",
  noElements: "Aucun élément",
  noSemanticElements: "Le diagramme ne contient aucun élément sémantique.",
  diagramIdentity: "Identité du diagramme",

  modelChildren: "Enfants du modèle",
  elements: "Éléments",
  children: "Enfants",
  filterModelElements: "Filtrer les éléments du modèle",
  filterElementsPlaceholder: "Filtrer les éléments…",
  modelElements: "Éléments du modèle",
  noMatchingChildren: "Aucun enfant correspondant",
  kinds: "Natures",
  kindCounts: "Comptes par nature d’élément",
  noKinds: "Aucune nature",
  parent: "Parent",

  queryResult: "Résultat de requête",
  objectCount: "Objets",
  value: "Valeur",
  expression: "Expression",
  queryExpression: "Expression de requête",
  noExpression: "Aucune expression fournie",
  objectResults: "Résultats objets",
  queryResultControls: "Commandes des résultats de requête",
  filterQueryResults: "Filtrer les résultats de requête",
  filterQueryPlaceholder: "Filtrer les résultats de requête…",
  labelSort: "Libellé",
  kindSort: "Nature",
  queryResults: "Résultats de requête",
  noResults: "Aucun résultat",

  authoredRequirements: "Exigences rédigées",
  limitCountOne: "{count} limite",
  limitCountMany: "{count} limites",
  authoredLimit: "Limite rédigée",
  noAuthoredRequirements: "Aucune exigence rédigée",

  coverageLabel: "Couverture des liens de satisfaction",
  linkCoverage: "Couverture des liens",
  coverageUnavailable:
    "Aucune exigence n’a été renvoyée, la couverture des liens ne peut pas être évaluée.",
  traceFailedWithoutDetail:
    "La traçabilité des exigences a échoué sans détail d’erreur.",
  rootIdentity: "Identité de la racine",
  requirements: "Exigences",
  coverageFilter: "Filtre de couverture des exigences",
  filterAll: "tous",
  requirementTraces: "Traces d’exigences",
  noModeRequirements: "Aucune exigence {mode}",
  noRequirements: "Aucune exigence",
  noSatisfactionLinks: "Aucun lien de satisfaction",
  noTraceEvidence: "Aucune preuve de traçabilité n’a été renvoyée.",
  satisfactionLinks: "Liens de satisfaction",
  satisfiedByElements: "Éléments satisfaisants",
  traceInspection: "Inspection des traces et liens",

  validation: "Validation",
  constraints: "Contraintes",
  validated: "Validé",
  cannotClaimPass:
    "Aucune contrainte n’a été renvoyée, cette surface ne peut pas revendiquer un succès.",
  resolvedModelValues: "Valeurs de modèle résolues",
  noResolvedValues: "Aucune valeur de modèle résolue",
  constraintResults: "Résultats de validation des contraintes",
  missingRefs: "Manquant : {refs}",
  thresholdDetail: "seuil {value}",
  noConstraints: "Aucune contrainte trouvée sur cet élément",

  currentValue: "Valeur actuelle",
  numericLiteral: "Littéral numérique",
  numericLiteralLower: "littéral numérique",
  valueChange: "Changement de valeur",
  previous: "Précédente",
  requested: "Demandée",
  readBack: "Relecture",
  change: "Variation",
  elementIdentity: "Identité de l’élément",
  literal: "Littéral",
  evidenceStatus: "État de la preuve",
  documentaryUnverifiedMessage:
    "Le littéral a été lu et affiché. Aucune vérification indépendante, évaluation de contrainte ou preuve d’ingénierie n’est jointe.",
  readBackEvidence: "Preuve de relecture",
  noReadBack: "Aucune valeur de relecture n’a été renvoyée.",
  readBackMatches:
    "La relecture {observed} correspond à la demande {requested}.",
  readBackDoesNotMatch:
    "La relecture {observed} ne correspond pas à la demande {requested}.",
  evidenceDisclaimer:
    "Cela confirme uniquement la valeur littérale renvoyée, pas la sémantique du modèle ni une vérification d’ingénierie.",
  readBackWarning: "Avertissement de relecture",
  readBackMatched: "Relecture concordante",
  writeNotConfirmed: "Écriture non confirmée",
  immediateReadBackMatched: "Relecture immédiate concordante",
} as const satisfies { readonly [K in SysonMessageKey]: string };

/** Host locale for Intl. Missing or invalid values use English and never throw. */
export function presentationLocale(locale?: string): string {
  if (!locale?.trim()) return "en";
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? "en";
  } catch {
    return "en";
  }
}

export function formatHostNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(presentationLocale(locale), options).format(
      value,
    );
  } catch {
    return new Intl.NumberFormat("en", options).format(value);
  }
}

export function formatHostDateTime(
  value: string | Date,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  try {
    return new Intl.DateTimeFormat(presentationLocale(locale), options).format(
      date,
    );
  } catch {
    return new Intl.DateTimeFormat("en", options).format(date);
  }
}

export function compareText(
  left: string,
  right: string,
  locale?: string,
): number {
  try {
    return left.localeCompare(right, presentationLocale(locale));
  } catch {
    return left.localeCompare(right, "en");
  }
}
