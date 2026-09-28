// Something on its way out stays on the page while it fades, but it is gone
// already as far as anyone using it is concerned: nothing in it can be
// reached, it is not read out, and its ids are free for what replaces it.
export function retire(element: Element) {
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
  for (const node of [element, ...element.querySelectorAll("[id]")]) node.removeAttribute("id");
}
