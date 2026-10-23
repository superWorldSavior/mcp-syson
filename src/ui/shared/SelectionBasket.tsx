/** Host-acknowledged selection controls, composed exclusively from MCP View primitives. */
import type { ResultData } from "@casys/mcp-view";
import {
  Button,
  CollectionCard,
  ElementBody,
  ElementIdent,
  SemanticElement,
  StateMessage,
} from "@casys/mcp-view-components/preact/components";
import type { SurfaceAppContext } from "./preact-surface.tsx";
import {
  type SelectionController,
  selectionKey,
  type SelectionSnapshot,
} from "./selection.ts";

const labels = {
  en: {
    title: "AI context",
    empty: "No confirmed selections.",
    clear: "Clear context",
    remove: "Remove",
    pending: "Waiting for the host to accept the context…",
    error: "The host did not accept the context update.",
    retry: "Retry",
    unavailable: "This host does not support selection context updates.",
    confirmed: "Accepted by the host for future turns.",
  },
  fr: {
    title: "Contexte de l’IA",
    empty: "Aucune sélection confirmée.",
    clear: "Vider le contexte",
    remove: "Retirer",
    pending: "En attente de l’acceptation du contexte par l’hôte…",
    error: "L’hôte n’a pas accepté la mise à jour du contexte.",
    retry: "Réessayer",
    unavailable:
      "Cet hôte ne prend pas en charge les mises à jour du contexte de sélection.",
    confirmed: "Accepté par l’hôte pour les prochains tours.",
  },
};

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
  return (
    <CollectionCard
      title={t.title}
      label={t.title}
      scrollable
      actions={
        <Button
          disabled={!snapshot.available ||
            (!snapshot.items.length && !snapshot.desired.length)}
          onClick={() => void controller.clear()}
        >
          {t.clear}
        </Button>
      }
    >
      {!snapshot.available && <StateMessage>{t.unavailable}</StateMessage>}
      {snapshot.available && snapshot.pending && (
        <StateMessage busy>{t.pending}</StateMessage>
      )}
      {snapshot.available && snapshot.error && (
        <StateMessage tone="danger" title={t.error}>
          <Button
            disabled={snapshot.pending}
            onClick={() =>
              void controller.retry()}
          >
            {t.retry}
          </Button>
        </StateMessage>
      )}
      {!snapshot.items.length && <StateMessage>{t.empty}</StateMessage>}
      {snapshot.items.length > 0 && <StateMessage>{t.confirmed}</StateMessage>}
      {snapshot.items.map((item) => (
        <SemanticElement
          key={selectionKey(item)}
          reference={item.reference}
          density="row"
          selected
          ident={<ElementIdent label={item.label} detail={item.summary} />}
          body={
            <ElementBody>
              <Button
                disabled={!snapshot.available}
                title={`${t.remove} ${item.label}`}
                onClick={() => void controller.remove(item)}
              >
                {t.remove} {item.label}
              </Button>
            </ElementBody>
          }
        />
      ))}
    </CollectionCard>
  );
}
