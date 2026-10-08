import {
  PREFERENCE_KEYS,
  PREFERENCES,
  isPreferenceValue,
  type PreferenceSpec,
} from "#shared/utils/preferences";

type Theme = (typeof PREFERENCES.theme.options)[number]["value"];

// Each theme's own fonts, loaded only while it is the one shown.
const FONTS: Partial<Record<Theme, string>> = {
  "crate-label": "https://fonts.googleapis.com/css2?family=Rokkitt:wght@700&family=Rye&display=swap",
};

// The look (#87): the account's theme, or signed out a cookie, as the unit
// system does. A cookie so the server renders <html data-theme> itself and the
// default never flashes first. One shared copy, since two useCookie refs only
// keep in step in browsers with cookieStore.
export function useTheme() {
  const { preferences: account } = usePreferences();
  const cookie = useCookie<string | null>("recipeat-theme", {
    default: () => null,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  const chosen = useState("recipeat-theme", () => cookie.value);
  const theme = computed(() => {
    const value = account.value ? account.value.theme : chosen.value;
    return value && isPreferenceValue(PREFERENCES.theme, value) ? (value as Theme) : null;
  });
  function choose(value: Theme | null) {
    chosen.value = value;
    cookie.value = value;
  }
  // The theme's effects the account has switched off, as <html data-plain="grain
  // halftone">: its stylesheet draws each only while it is not listed. Signed
  // out there are no switches, and every effect is on.
  const plain = computed(() => {
    const set = account.value;
    if (!set || !theme.value) return null;
    const off = PREFERENCE_KEYS.filter(
      (key) => (PREFERENCES[key] as PreferenceSpec).theme === theme.value && set[key] === "off",
    ).map((key) => key.replace(/Effect$/, ""));
    return off.length ? off.join(" ") : null;
  });
  return {
    theme,
    plain,
    font: computed(() => (theme.value ? (FONTS[theme.value] ?? null) : null)),
    choose,
  };
}
