// Mouse drags for the component tests, sent straight to the element that
// would have the pointer: down, a few moves, up, as pointer events and the
// mouse events that follow them. Playwright's own drags scroll the page and
// scrolling boxes as they go (to keep the pointer's target in view), which
// moves what's being dragged on mid-drag.

export interface Point {
  x: number;
  y: number;
}

/** A point given from an element's top-left, in the window's coordinates. */
export function pointIn(element: Element, x: number, y: number): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + x, y: box.top + y };
}

export function drag(target: Element, from: Point, to: Point, { steps = 5, shiftKey = false, altKey = false } = {}): void {
  const send = (type: "down" | "move" | "up", at: Point) => {
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: at.x,
      clientY: at.y,
      button: type === "move" ? -1 : 0,
      buttons: type === "up" ? 0 : 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      shiftKey,
      altKey,
    };
    target.dispatchEvent(new PointerEvent(`pointer${type}`, init));
    target.dispatchEvent(new MouseEvent(`mouse${type}`, { ...init, button: Math.max(0, init.button ?? 0) }));
  };
  send("down", from);
  for (let i = 1; i <= steps; i++) {
    send("move", { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  }
  send("up", to);
}
