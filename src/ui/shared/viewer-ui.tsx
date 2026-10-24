/**
 * Shared viewer chrome (UX v1, syson-ux-design.md §1): one header with the
 * AI-context basket at its end, one selectable element row, one kind marker
 * and one technical-details disclosure, so the seven viewers read alike.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Disclosure } from "@mcpview/components/preact/components";
import { kindInfo } from "./sysml-kind.ts";
import type { SelectionController, SelectionItem } from "./selection.ts";
import { createSelectionGesture } from "./selection-gesture.ts";

/** Kind pill: short marker, tone by family, outlined for definitions. */
export function KindMark({ kind }: { readonly kind: string }) {
  const info = kindInfo(kind);
  return (
    <span
      className="syson-kind-mark"
      data-kind-tone={info.tone}
      data-kind-definition={info.definition ? "true" : undefined}
      title={info.name}
      aria-hidden="true"
    >
      {info.marker}
    </span>
  );
}

/**
 * Viewer header: eyebrow, explicit title and meta on the start side; viewer
 * actions then the AI-context basket on the end side. `below` holds the
 * PathBar so location always sits right under the title.
 */
export function ViewerHeader(
  { eyebrow, title, meta, actions, basket, below }: {
    readonly eyebrow?: ComponentChildren;
    readonly title: ComponentChildren;
    readonly meta?: ComponentChildren;
    readonly actions?: ComponentChildren;
    readonly basket?: ComponentChildren;
    readonly below?: ComponentChildren;
  },
) {
  return (
    <header className="syson-viewer-header">
      <div className="syson-viewer-header-main">
        <div className="syson-viewer-titles">
          {eyebrow && <span className="syson-viewer-eyebrow">{eyebrow}</span>}
          <h2 className="syson-viewer-title">{title}</h2>
          {meta && <span className="syson-viewer-meta">{meta}</span>}
        </div>
        {(actions || basket) && (
          <div className="syson-viewer-actions">
            {actions}
            {basket}
          </div>
        )}
      </div>
      {below && <div className="syson-viewer-header-below">{below}</div>}
    </header>
  );
}

/** Tree placement of a row (role="treeitem"); omit it for flat lists. */
export interface ElementRowTree {
  readonly depth: number;
  /** Unknown children count as expandable until a load proves the node empty. */
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly loading?: boolean;
  readonly onToggle: () => void;
  readonly toggleLabel: string;
}

/**
 * One selectable element. Click (or Space) toggles it in AI context through
 * the kit's click arbiter, with the intent visible at once; double-click (or
 * Enter) opens it without any intermediate context write. `onOpen` also gets
 * an explicit trailing control so opening never depends on a double-click.
 */
export function ElementRow(
  {
    controller,
    item,
    kind,
    label,
    meta,
    trailing,
    onOpen,
    openLabel,
    selectLabel,
    tree,
    rowKey,
  }: {
    readonly controller: SelectionController;
    readonly item: SelectionItem;
    readonly kind: string;
    readonly label: ComponentChildren;
    readonly meta?: ComponentChildren;
    readonly trailing?: ComponentChildren;
    readonly onOpen?: () => void | Promise<unknown>;
    readonly openLabel?: string;
    readonly selectLabel: string;
    readonly tree?: ElementRowTree;
    /** Stable id for keyboard tree navigation (data-row-key). */
    readonly rowKey?: string;
  },
) {
  const gesture = createSelectionGesture(controller, item, onOpen);
  const state = controller.selectionState(item);
  const pressed = state === "selected" || state === "adding";
  return (
    <div
      className="syson-row mcp-view-context-selection"
      data-context-state={state}
      data-row-key={rowKey}
      data-tree={tree ? "true" : undefined}
      style={tree ? `--syson-depth: ${tree.depth}` : undefined}
      role={tree ? "treeitem" : "button"}
      tabIndex={0}
      aria-pressed={tree ? undefined : pressed}
      aria-selected={tree ? pressed : undefined}
      aria-level={tree ? tree.depth + 1 : undefined}
      aria-expanded={tree?.expandable ? tree.expanded : undefined}
      aria-busy={tree?.loading || undefined}
      aria-label={selectLabel}
      onClick={gesture.onClick}
      onDblClick={gesture.onDoubleClick}
      onKeyDown={gesture.onKeyDown}
    >
      {tree && (
        tree.expandable
          ? (
            <button
              type="button"
              className="syson-row-toggle"
              data-expanded={tree.expanded ? "true" : "false"}
              aria-label={tree.toggleLabel}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                tree.onToggle();
              }}
              onDblClick={(event) => event.stopPropagation()}
            >
              {tree.loading
                ? <span className="syson-row-spinner" aria-hidden="true" />
                : <span aria-hidden="true">›</span>}
            </button>
          )
          : <span className="syson-row-toggle-spacer" aria-hidden="true" />
      )}
      <KindMark kind={kind} />
      <span className="syson-row-main">
        <span className="syson-row-label">{label}</span>
        {meta && <span className="syson-row-meta">{meta}</span>}
      </span>
      {trailing && <span className="syson-row-trailing">{trailing}</span>}
      {onOpen && (
        <button
          type="button"
          className="syson-row-open"
          aria-label={openLabel}
          title={openLabel}
          onClick={(event) => {
            event.stopPropagation();
            void onOpen();
          }}
          onDblClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <span aria-hidden="true">›</span>
        </button>
      )}
    </div>
  );
}

/** Element identifiers live here, never in rows: a closed disclosure with copy. */
export function TechnicalDetails(
  { label, idLabel, id, copyLabel, copiedLabel }: {
    readonly label: string;
    readonly idLabel: string;
    readonly id: string;
    readonly copyLabel: string;
    readonly copiedLabel: string;
  },
) {
  const [copied, setCopied] = useState(false);
  return (
    <Disclosure label={label}>
      <div className="syson-technical">
        <span className="syson-technical-label">{idLabel}</span>
        <code className="syson-technical-value">{id}</code>
        <button
          type="button"
          className="syson-technical-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(id).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {},
            );
          }}
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </Disclosure>
  );
}
