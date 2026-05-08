/** Set before `router.replace("/")` from auth pages so the homepage manual can fade in. */
export const MANUAL_HOME_FADE_IN_KEY = "immeManualHomeFade";

export function markManualShouldFadeInOnHome(): void {
  try {
    sessionStorage.setItem(MANUAL_HOME_FADE_IN_KEY, "1");
  } catch {
    /* private mode / quota */
  }
}
