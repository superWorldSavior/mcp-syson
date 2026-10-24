/** Presentation of SysML kinds: a short marker, a tone and a readable name. */
import { shortSysmlKind } from "./component-catalog.ts";

export type KindTone =
  | "structure"
  | "behavior"
  | "requirement"
  | "interface"
  | "neutral";

export interface KindInfo {
  /** Short uppercase marker shown in the kind pill (PART, PORT, REQ…). */
  readonly marker: string;
  readonly tone: KindTone;
  /** Definitions are drawn outlined, usages filled. */
  readonly definition: boolean;
  /** Readable kind name, e.g. "Part definition". Literal SysML wording. */
  readonly name: string;
}

const MARKERS: Record<string, readonly [string, KindTone]> = {
  Part: ["PART", "structure"],
  Item: ["ITEM", "structure"],
  Occurrence: ["OCC", "structure"],
  Individual: ["INDV", "structure"],
  Enumeration: ["ENUM", "structure"],
  Attribute: ["ATTR", "structure"],
  Port: ["PORT", "interface"],
  Interface: ["IF", "interface"],
  Connection: ["CONN", "interface"],
  Flow: ["FLOW", "interface"],
  Allocation: ["ALLOC", "interface"],
  Binding: ["BIND", "interface"],
  Action: ["ACT", "behavior"],
  PerformAction: ["ACT", "behavior"],
  AcceptAction: ["ACT", "behavior"],
  SendAction: ["ACT", "behavior"],
  AssignmentAction: ["ACT", "behavior"],
  Succession: ["SUCC", "behavior"],
  ExhibitState: ["STATE", "behavior"],
  IncludeUseCase: ["UC", "behavior"],
  EventOccurrence: ["OCC", "structure"],
  Reference: ["REF", "neutral"],
  Subject: ["SUBJ", "requirement"],
  Actor: ["ACTR", "behavior"],
  State: ["STATE", "behavior"],
  Calculation: ["CALC", "behavior"],
  Transition: ["TRANS", "behavior"],
  UseCase: ["UC", "behavior"],
  Analysis: ["ANLS", "behavior"],
  AnalysisCase: ["ANLS", "behavior"],
  Requirement: ["REQ", "requirement"],
  Constraint: ["CSTR", "requirement"],
  Concern: ["CNCR", "requirement"],
  SatisfyRequirement: ["SAT", "requirement"],
  Satisfy: ["SAT", "requirement"],
  Stakeholder: ["STKH", "requirement"],
  Verification: ["VER", "requirement"],
  VerificationCase: ["VER", "requirement"],
  Package: ["PKG", "neutral"],
  LibraryPackage: ["LIB", "neutral"],
  Namespace: ["NS", "neutral"],
  Documentation: ["DOC", "neutral"],
  Comment: ["NOTE", "neutral"],
  View: ["VIEW", "neutral"],
  Viewpoint: ["VPT", "neutral"],
  Rendering: ["REND", "neutral"],
  Metadata: ["META", "neutral"],
};

/** Relationship kinds (memberships, typings…) read as one quiet family. */
const RELATIONSHIPS: readonly (readonly [
  RegExp,
  readonly [string, KindTone],
])[] = [
  [/Membership$/, ["MEMB", "neutral"]],
  [/^FeatureTyping$/, ["TYPE", "neutral"]],
  [/^(Subclassification|Specialization)$/, ["SPEC", "neutral"]],
  [/^Redefinition$/, ["REDEF", "neutral"]],
  [/^(Subsetting|ReferenceSubsetting)$/, ["SUBS", "neutral"]],
  [/Import$/, ["IMP", "neutral"]],
  [/^Dependency$/, ["DEP", "neutral"]],
];

function readableName(kind: string): string {
  const words = kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return words
    .map((word, index) => (index === 0 ? word : word.toLowerCase()))
    .join(" ");
}

export function kindInfo(rawKind: string): KindInfo {
  const kind = shortSysmlKind(rawKind) || rawKind || "Element";
  const definition = kind.endsWith("Definition");
  const base = kind.replace(/(Definition|Usage)$/, "") || kind;
  const [marker, tone] = MARKERS[base] ??
    RELATIONSHIPS.find(([pattern]) => pattern.test(base))?.[1] ??
    [
      base.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || "ELEM",
      "neutral",
    ];
  return { marker, tone, definition, name: readableName(kind) };
}
