import { createSelectionGesture } from "../../shared/selection-gesture.ts";
import type {
  SelectionController,
  SelectionItem,
} from "../../shared/selection.ts";

/** Pan never consumes a previous Select click's compensation ledger. */
export function createDiagramGesture(
  controller: SelectionController,
  item: SelectionItem,
  openDetail: () => void | Promise<unknown>,
  mode: "select" | "pan",
) {
  const gesture = createSelectionGesture(controller, item, openDetail);
  const onKeyDown = (event: Parameters<typeof gesture.onKeyDown>[0]) => {
    if (event.key === " ") {
      event.preventDefault();
      return;
    }
    gesture.onKeyDown(event);
  };
  if (mode === "select") return { ...gesture, onKeyDown };
  return {
    ...gesture,
    onKeyDown,
    onClick: () => {},
    onDoubleClick: () => {
      void openDetail();
    },
  };
}
