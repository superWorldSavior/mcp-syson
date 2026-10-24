/** Domain adapter for the shared MCP View context chip and its acknowledged controller. */
import type { ResultData } from "@casys/mcp-view";
import {
  ActiveContextChip,
  type ContextBasketLabels,
  MCP_VIEW_CONTEXT_BASKET_CSS,
} from "@casys/mcp-view-components/preact/context";
import { Button, Toolbar } from "@casys/mcp-view-components/preact/components";
import type { SurfaceAppContext } from "./preact-surface.tsx";
import {
  type SelectionController,
  selectionKey,
  type SelectionSnapshot,
} from "./selection.ts";

const labels = {
  en: {
    active: "AI context",
    items: "Selected elements",
    remove: (label: string) => `Remove ${label} from context`,
    clearAll: "Clear context",
    pending: "Updating context…",
    error: "Context update refused.",
    evicted: (label: string) =>
      `${label} was removed because the context is full.`,
    empty: "Click an element to add it to AI context.",
    retry: "Retry",
    unavailable: "Context selection is unavailable in this host.",
  },
  fr: {
    active: "Contexte de l’IA",
    items: "Éléments sélectionnés",
    remove: (label: string) => `Retirer ${label} du contexte`,
    clearAll: "Vider le contexte",
    pending: "Mise à jour du contexte…",
    error: "Mise à jour du contexte refusée.",
    evicted: (label: string) =>
      `${label} a été retiré car le contexte est plein.`,
    empty: "Cliquez sur un élément pour l’ajouter au contexte de l’IA.",
    retry: "Réessayer",
    unavailable: "La sélection de contexte est indisponible dans cet hôte.",
  },
} satisfies Record<
  string,
  ContextBasketLabels & {
    empty: string;
    retry: string;
    unavailable: string;
  }
>;

export function SelectionBasket<T extends ResultData>(
  { context, controller, snapshot }: {
    readonly context: SurfaceAppContext<T>;
    readonly controller: SelectionController;
    readonly snapshot: SelectionSnapshot;
  },
) {
  const t = labels[
    context.hostContext.locale?.toLowerCase().startsWith("fr") ? "fr" : "en"
  ];
  const selections = snapshot.items.map((entry) => ({
    scopeKey: snapshot.rootId,
    item: { id: selectionKey(entry), label: entry.label },
    entry,
  }));
  return (
    <>
      <style>{MCP_VIEW_CONTEXT_BASKET_CSS}</style>
      <Toolbar label={t.active}>
        {!snapshot.available ? <span role="status">{t.unavailable}</span> : (
          <>
            {!selections.length && !snapshot.pending && !snapshot.error && (
              <span role="status">{t.empty}</span>
            )}
            <ActiveContextChip
              selections={selections}
              labels={t}
              failed={Boolean(snapshot.error)}
              pending={snapshot.pending}
              popoverAlign="start"
              onRemove={async ({ entry }) => {
                const scope = controller.scopeVersion();
                await controller.remove(entry);
                const current = controller.getSnapshot();
                return scope === controller.scopeVersion() && !current.error &&
                    !controller.isSelected(entry)
                  ? "shared"
                  : undefined;
              }}
              onClear={async () => {
                const scope = controller.scopeVersion();
                await controller.clear();
                const current = controller.getSnapshot();
                return scope === controller.scopeVersion() && !current.error &&
                    current.items.length === 0
                  ? "cleared"
                  : undefined;
              }}
            />
            {snapshot.error && (
              <Button
                disabled={snapshot.pending}
                onClick={() => void controller.retry()}
              >
                {t.retry}
              </Button>
            )}
          </>
        )}
      </Toolbar>
    </>
  );
}
