import type { DragEvent, MutableRefObject } from "react";

/**
 * Suppresses the browser's native (translucent, softened) HTML5 drag image and replaces it
 * with a full-opacity clone of the dragged element that tracks the cursor via `position: fixed`.
 * Shared by folder and file drag-to-reorder so both surfaces get the same crisp drag preview.
 */
export function beginCardDragPreview(
  event: DragEvent<HTMLElement>,
  cardEl: HTMLElement,
  ghostRef: MutableRefObject<HTMLDivElement | null>,
  pointerOffsetRef: MutableRefObject<{ x: number; y: number }>
) {
  ghostRef.current?.remove();
  ghostRef.current = null;
  const rect = cardEl.getBoundingClientRect();
  pointerOffsetRef.current = {
    x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
  };
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  event.dataTransfer.setDragImage(canvas, 0, 0);

  const ghost = cardEl.cloneNode(true) as HTMLDivElement;
  ghost.removeAttribute("id");
  ghost.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  Object.assign(ghost.style, {
    position: "fixed",
    boxSizing: "border-box",
    margin: "0",
    left: `${event.clientX - pointerOffsetRef.current.x}px`,
    top: `${event.clientY - pointerOffsetRef.current.y}px`,
    width: `${rect.width}px`,
    pointerEvents: "none",
    zIndex: "2147483647",
    opacity: "1",
  });
  ghost.style.setProperty("box-shadow", "0 28px 55px rgba(15,23,42,0.28),0 0 0 1px rgba(15,23,42,0.08)");
  document.body.appendChild(ghost);
  ghostRef.current = ghost;
}

/** Moves an in-progress drag ghost (from `beginCardDragPreview`) to follow the cursor. */
export function moveCardDragPreview(
  event: DragEvent<HTMLElement>,
  ghostRef: MutableRefObject<HTMLDivElement | null>,
  pointerOffsetRef: MutableRefObject<{ x: number; y: number }>
) {
  const ghost = ghostRef.current;
  if (!ghost || (event.clientX === 0 && event.clientY === 0)) return;
  const { x, y } = pointerOffsetRef.current;
  ghost.style.left = `${event.clientX - x}px`;
  ghost.style.top = `${event.clientY - y}px`;
}

/** Removes an in-progress drag ghost (from `beginCardDragPreview`), if any. */
export function endCardDragPreview(ghostRef: MutableRefObject<HTMLDivElement | null>) {
  ghostRef.current?.remove();
  ghostRef.current = null;
}
