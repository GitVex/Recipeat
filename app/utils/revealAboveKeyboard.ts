// On a phone the keyboard takes the lower half of the screen, and a field
// tapped near the bottom ends up behind it. Once the keyboard is up — the
// visual viewport has shrunk — the field is brought to the middle of what is
// left.
export function revealAboveKeyboard(element: HTMLElement) {
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  const reveal = () => element.scrollIntoView({ block: "center", behavior: "smooth" });
  const viewport = window.visualViewport;
  if (!viewport) return void setTimeout(reveal, 300);
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    viewport.removeEventListener("resize", once);
    reveal();
  };
  viewport.addEventListener("resize", once);
  // A keyboard that was already up, or one that does not resize the viewport.
  setTimeout(once, 400);
}
