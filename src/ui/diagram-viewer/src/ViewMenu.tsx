/**
 * Header overflow menu ("⋯"), WAI-ARIA menu button pattern: the trigger
 * declares `aria-haspopup`, arrows move between items, Escape closes and
 * returns focus to the trigger, an outside press closes without moving it.
 */
import type { RefObject } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";

export interface ViewMenuItem {
  readonly id: string;
  readonly label: string;
}

export function ViewMenu(
  { label, items, onSelect, triggerRef }: {
    readonly label: string;
    readonly items: readonly ViewMenuItem[];
    readonly onSelect: (id: string) => void;
    readonly triggerRef?: RefObject<HTMLButtonElement>;
  },
) {
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ownTrigger = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? ownTrigger;
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const entries = () => [
    ...(listRef.current?.querySelectorAll<HTMLButtonElement>(
      "[role='menuitem']",
    ) ?? []),
  ];
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const all = entries();
    (open === "last" ? all[all.length - 1] : all[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  return (
    <div className="syson-menu" ref={rootRef}>
      <button
        ref={trigger}
        type="button"
        className="mcp-view-button syson-menu-button"
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen(open ? false : "first")}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen("first");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen("last");
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close(true);
          }
        }}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
        >
          <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={menuId}
          className="syson-menu-list"
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            const all = entries();
            const index = all.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const move = (next: number) => {
              event.preventDefault();
              all[(next + all.length) % all.length]?.focus();
            };
            if (event.key === "ArrowDown") move(index + 1);
            else if (event.key === "ArrowUp") move(index - 1);
            else if (event.key === "Home") move(0);
            else if (event.key === "End") move(all.length - 1);
            else if (event.key === "Escape") {
              event.preventDefault();
              close(true);
            } else if (event.key === "Tab") setOpen(false);
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="syson-menu-item"
              onClick={() => {
                setOpen(false);
                onSelect(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
