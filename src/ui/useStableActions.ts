// Handlers for memoized rows (track headers, lanes): the object returned
// stays the same for the component's life, so passing it doesn't make a
// memoized row redraw - while each call still goes to the latest version
// of the handler passed in. Call them from events, not while rendering.

import { useLayoutEffect, useRef, useState } from "react";

export function useStableActions<T extends { [K in keyof T]: (...args: never[]) => unknown }>(actions: T): T {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  // Reading a handler off it gives a function that calls the latest one.
  const [stable] = useState(
    () =>
      new Proxy(actions, {
        get: (_first, key) => (typeof key === "string" ? (...args: never[]) => latest.current[key as keyof T](...args) : undefined),
      })
  );
  return stable;
}
