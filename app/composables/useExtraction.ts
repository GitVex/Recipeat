import type { ExtractedRecipe } from "#shared/types/recipe";

// One call path for all three extraction routes. The dialog says what to read;
// this says how it went, in words a person can act on. The server's own
// messages are sanitized but written for whoever is testing the API, so none
// of them are shown here.

export type ExtractionSource = "website" | "text" | "photo";

export type ExtractionRequest =
  | { source: "website"; url: string }
  | { source: "text"; text: string }
  | { source: "photo"; file: File };

export type ExtractionFailure = {
  // What the dialog offers alongside the message: sign in, try the same
  // request again, change the input, or nothing in particular.
  action: "signIn" | "retry" | "edit" | "none";
  message: string;
  // Whether something actually broke. A busy service, a lapsed session and a
  // page with no recipe on it are all failures, but none of them is a fault.
  fault: boolean;
};

// Past these, the wait gets a word of explanation. Website reads no model and
// answers in seconds; text and photo go through one and take several, and the
// first request after a quiet spell is slower still.
const SLOW_AFTER_MS: Record<ExtractionSource, number> = {
  website: 10_000,
  text: 20_000,
  photo: 20_000,
};

const NOT_FOUND: Record<ExtractionSource, string> = {
  website: "We couldn’t find a recipe on that page.",
  text: "We couldn’t find a recipe in that text.",
  photo: "We couldn’t find a recipe in that photo.",
};

function failureFor(
  status: number | undefined,
  source: ExtractionSource,
): ExtractionFailure {
  switch (status) {
    case undefined:
      return {
        action: "retry",
        message:
          "We couldn’t reach Recipeat. Check your connection and try again.",
        fault: true,
      };
    case 401:
      return {
        action: "signIn",
        message:
          source === "photo"
            ? "You’ve been signed out. Sign in again to carry on, then choose the photo once more."
            : "You’ve been signed out. Sign in again to carry on. What you entered will still be here.",
        fault: false,
      };
    case 422:
      return { action: "edit", message: NOT_FOUND[source], fault: false };
    // Busy or over quota. Not a fault, and the same request will work shortly.
    case 503:
      return {
        action: "retry",
        message: "Recipeat is busy right now. Give it a moment, then try again.",
        fault: false,
      };
    case 502:
      return {
        action: "retry",
        message:
          "Something went wrong while reading that recipe. Please try again.",
        fault: true,
      };
    case 504:
      return {
        action: "retry",
        message: "That took too long to read. Please try again.",
        fault: true,
      };
    // 400, 413 and 415 are what the dialog's own checks are there to prevent,
    // so reaching one is a bug rather than anything the user can fix.
    default:
      return {
        action: "none",
        message: "Something went wrong with that import. Please try again.",
        fault: true,
      };
  }
}

function bodyOf(request: ExtractionRequest) {
  if (request.source === "website") return { url: request.url };
  if (request.source === "text") return { text: request.text };
  // No Content-Type is set for this one: the browser writes the multipart
  // boundary into it, and a header set by hand would drop it.
  const form = new FormData();
  form.append("file", request.file);
  return form;
}

export function useExtraction() {
  const pending = ref<ExtractionSource | null>(null);
  const slow = ref(false);
  const failure = ref<ExtractionFailure | null>(null);
  let controller: AbortController | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  function settle() {
    clearTimeout(slowTimer);
    controller = null;
    pending.value = null;
    slow.value = false;
  }

  // Closing the dialog or switching tabs ends the request, and whatever it
  // would have answered is ignored.
  function cancel() {
    controller?.abort();
    settle();
  }

  /**
   * The recipe, or null when there is none to show: the request failed (and
   * `failure` says why), was cancelled, or another one was already running.
   */
  async function extract(
    request: ExtractionRequest,
  ): Promise<ExtractedRecipe | null> {
    // Every call costs a model run, so a second one while the first is still
    // out is refused rather than queued.
    if (controller) return null;
    const own = (controller = new AbortController());
    failure.value = null;
    pending.value = request.source;
    slowTimer = setTimeout(
      () => (slow.value = true),
      SLOW_AFTER_MS[request.source],
    );
    try {
      const { recipe } = await $fetch<{ recipe: ExtractedRecipe }>(
        `/api/extract/${request.source}`,
        { method: "POST", body: bodyOf(request), signal: own.signal, retry: 0 },
      );
      // An answer that arrives after the request was given up on opens nothing.
      return own.signal.aborted ? null : recipe;
    } catch (error) {
      if (!own.signal.aborted) {
        failure.value = failureFor(
          (error as { statusCode?: number }).statusCode,
          request.source,
        );
      }
      return null;
    } finally {
      if (controller === own) settle();
    }
  }

  onScopeDispose(cancel);

  return { pending, slow, failure, extract, cancel };
}
