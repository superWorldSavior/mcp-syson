import {
  type SelectionController,
  type SelectionItem,
  selectionKey,
} from "./selection.ts";

const ledgers = new WeakMap<
  SelectionController,
  Map<string, { selected: boolean; revision: number }>
>();

/** Share these handlers between HTML rows and SVG semantic nodes. Keep one instance per identity. */
export function createSelectionGesture(
  controller: SelectionController,
  item: SelectionItem,
  openDetail?: () => void | Promise<unknown>,
  onOpenError?: (error: unknown) => void,
) {
  const root = controller.getSnapshot().rootId;
  const scope = controller.scopeVersion();
  let ledger = ledgers.get(controller);
  if (!ledger) {
    ledger = new Map();
    ledgers.set(controller, ledger);
  }
  const key = JSON.stringify([scope, selectionKey(item)]);
  const valid = () =>
    controller.getSnapshot().rootId === root &&
    controller.scopeVersion() === scope;
  const open = () => {
    if (!valid() || !openDetail) return;
    try {
      Promise.resolve(openDetail()).catch((error) => onOpenError?.(error));
    } catch (error) {
      onOpenError?.(error);
    }
  };
  return {
    onClick(event: { detail: number }) {
      if (!valid()) return;
      if (event.detail >= 2 && openDetail) return;
      const selected = controller.isDesired(item);
      void controller.toggle(item);
      ledger!.set(key, { selected, revision: controller.itemRevision(item) });
    },
    onDoubleClick() {
      if (!valid() || !openDetail) return;
      const firstClick = ledger!.get(key);
      if (firstClick && controller.itemRevision(item) === firstClick.revision) {
        void controller.setItem(item, firstClick.selected);
      }
      ledger!.delete(key);
      open();
    },
    onKeyDown(
      event: { key: string; repeat?: boolean; preventDefault(): void },
    ) {
      if (!valid() || event.repeat) return;
      if (event.key === " ") {
        event.preventDefault();
        ledger!.delete(key);
        void controller.toggle(item);
      }
      if (event.key === "Enter" && openDetail) {
        event.preventDefault();
        ledger!.delete(key);
        open();
      }
    },
  };
}
