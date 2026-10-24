/**
 * Pieces shared by the two requirement viewers (authored list and trace):
 * the in-place detail sheet, documentary constraint sections, doc-comment
 * text display and per-App view state that survives a locale remount. The
 * sheet styles live next door in `requirement-ui.css` (kit tokens only).
 */
import { createTranslator } from "@mcpview/components";
import {
  ElementSection,
  InlineCode,
  KeyValueList,
  NoticeGroup,
  StateMessage,
} from "@mcpview/components/preact/components";
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { SYSON_MESSAGES_EN, SYSON_MESSAGES_FR } from "../../shared/messages.ts";
import type { AuthoredRequirement } from "../../shared/recorded-content.ts";
import { requirementExpressionText } from "./requirement-expression.ts";
import "./requirement-ui.css";

type AuthoredConstraints = NonNullable<
  AuthoredRequirement["authoredConstraints"]
>;

const CONSTRAINT_MESSAGES_EN = {
  noAuthoredConstraints: "No authored constraints",
  constraintErrors: "Constraint errors",
} as const;
const CONSTRAINT_MESSAGES_FR = {
  noAuthoredConstraints: "Aucune contrainte rédigée",
  constraintErrors: "Erreurs de contrainte",
} as const satisfies {
  readonly [K in keyof typeof CONSTRAINT_MESSAGES_EN]: string;
};
const constraintMessages = createTranslator({
  defaultLocale: "en",
  messages: { ...SYSON_MESSAGES_EN, ...CONSTRAINT_MESSAGES_EN },
  translations: { fr: { ...SYSON_MESSAGES_FR, ...CONSTRAINT_MESSAGES_FR } },
});

/** Literal comparison glyphs; the authored operator is never re-evaluated. */
export function operatorGlyph(operator: string): string {
  const glyphs: Record<string, string> = {
    "<=": "≤",
    ">=": "≥",
    "==": "=",
    "!=": "≠",
  };
  return glyphs[operator] ?? operator;
}

/**
 * Authored documentation lines without SysML doc-comment margins. The leading
 * `*` is stripped only when every line carries it (comment continuation), so
 * an authored bullet list inside prose is kept as written.
 */
export function documentationLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const commented = lines.length > 0 &&
    lines.every((line) => line.startsWith("*"));
  return commented
    ? lines.map((line) => line.replace(/^\*+\s?/, "").trim()).filter(Boolean)
    : lines;
}

/** One-line preview of authored documentation, for row meta. */
export function documentationPreview(text: string | undefined) {
  return text ? documentationLines(text).join(" ") || undefined : undefined;
}

const retainedViews = new WeakMap<
  object,
  { scope: string; state: Record<string, unknown> }
>();

/**
 * View state kept per App instance and data scope: a locale change remounts
 * the surface, and the filter, open detail and scroll must survive it. New
 * data (another scope) starts empty. Writes here never rerender.
 */
export function retainedView(
  app: object,
  scope: string,
): Record<string, unknown> {
  let entry = retainedViews.get(app);
  if (!entry || entry.scope !== scope) {
    entry = { scope, state: {} };
    retainedViews.set(app, entry);
  }
  return entry.state;
}

/**
 * List ⇄ detail sheet opened in place. Opening keeps the list scroll and the
 * opened row; returning (PathBar or Escape) restores both and refocuses the
 * row. Focus moves only on a user transition, never on a locale remount.
 */
export function useListDetail(app: object, scope: string) {
  const view = retainedView(app, scope);
  const [openId, setOpenId] = useRetainedState<string | undefined>(
    app,
    scope,
    "open",
    undefined,
  );
  const scroller = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const focusNext = useRef<"sheet" | "list">();
  useEffect(() => {
    const focus = focusNext.current;
    focusNext.current = undefined;
    if (sheet.current) {
      if (focus === "sheet") sheet.current.focus();
      return;
    }
    const list = scroller.current;
    if (!list) return;
    list.scrollTop = typeof view.scrollTop === "number" ? view.scrollTop : 0;
    if (focus === "list" && typeof view.returnFocus === "string") {
      list.querySelector<HTMLElement>(
        `[data-open-id="${CSS.escape(view.returnFocus)}"] .syson-row`,
      )?.focus();
    }
  }, [openId]);
  return {
    openId,
    scroller,
    sheet,
    onScroll: () => {
      view.scrollTop = scroller.current?.scrollTop ?? 0;
    },
    open: (id: string) => {
      view.scrollTop = scroller.current?.scrollTop ?? 0;
      view.returnFocus = id;
      focusNext.current = "sheet";
      setOpenId(id);
    },
    close: () => {
      focusNext.current = "list";
      setOpenId(undefined);
    },
  };
}

/** Focus target of an opened detail sheet; Escape returns to the list. */
export function DetailSheet(
  { sheetRef, onClose, children }: {
    readonly sheetRef: RefObject<HTMLDivElement>;
    readonly onClose: () => void;
    readonly children?: ComponentChildren;
  },
) {
  return (
    <div
      ref={sheetRef}
      className="syson-sheet"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </div>
  );
}

/** Rendered view state backed by `retainedView`. */
export function useRetainedState<T>(
  app: object,
  scope: string,
  key: string,
  initial: T,
): readonly [T, (next: T) => void] {
  const state = retainedView(app, scope);
  const [, rerender] = useState(0);
  const value = (key in state ? state[key] : initial) as T;
  const set = (next: T) => {
    const current = retainedViews.get(app);
    if (!current || current.scope !== scope) return;
    current.state[key] = next;
    rerender((count) => count + 1);
  };
  return [value, set] as const;
}

/**
 * Declared constraint expressions of one requirement, exactly as extracted.
 * Measurements and validation are never resolved here, and missing details
 * stay stated as missing.
 */
export function AuthoredConstraintsSection(
  { status, constraints, error, locale }: {
    readonly status?: "available" | "unavailable" | "not-requested";
    readonly constraints?: AuthoredConstraints;
    readonly error?: string;
    readonly locale?: string;
  },
) {
  if (status === undefined && constraints === undefined && !error) {
    return null;
  }
  const t = constraintMessages(locale);
  const declared = constraints?.constraints ?? [];
  const errors = constraints?.errors ?? [];
  return (
    <ElementSection title={t("authoredConstraintsOnly")}>
      {declared.length > 0 && (
        <>
          <KeyValueList
            layout="facts"
            items={declared.map((constraint) => ({
              id: constraint.id,
              label: constraint.name || t("unnamed"),
              value: (
                <InlineCode>
                  {requirementExpressionText(constraint.expression)}
                </InlineCode>
              ),
            }))}
          />
          <p className="syson-status">
            {t("authoredConstraintsNotValidated")}
          </p>
        </>
      )}
      <NoticeGroup
        label={t("constraintErrors")}
        tone="warning"
        items={errors.map((item) =>
          `${item.name || t("unnamed")}: ${item.error}`
        )}
      />
      {status !== undefined && status !== "available" && !errors.length && (
        <StateMessage
          tone="warning"
          title={t("authoredConstraintsUnavailable")}
        >
          {error ||
            t(
              status === "not-requested"
                ? "authoredConstraintsBounded"
                : "authoredConstraintsNotCaptured",
            )}
        </StateMessage>
      )}
      {(status === "available" || (status === undefined && constraints)) &&
        !declared.length && !errors.length && (
        <p className="syson-status">{t("noAuthoredConstraints")}</p>
      )}
    </ElementSection>
  );
}
