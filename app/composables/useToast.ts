// One toast for the whole app, so a page and a dialog can both say something
// without either owning where it appears.
let timer: ReturnType<typeof setTimeout> | undefined;

export function useToast() {
  const message = useState("toast", () => "");
  function notify(text: string) {
    message.value = text;
    clearTimeout(timer);
    timer = setTimeout(() => (message.value = ""), 3500);
  }
  return { message, notify };
}
