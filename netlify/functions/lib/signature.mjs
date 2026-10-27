import { getRoster } from "./store.mjs";
import { useRoster } from "./letters.mjs";

/** Load the board roster for letters signed by a member (see attendeeSignOf). Called once per request or run. */
export async function primeRoster() {
  useRoster((await getRoster().catch(() => null)) ?? []);
}
