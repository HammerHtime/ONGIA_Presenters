/**
 * Some things belong to one kind of training only: RBH events have their own
 * jobs (SOW, limos, VIA Rail, dinner reservations), the RBH ITP week its own
 * welcome letter. They carry the words that name those events ("RBH", "RBH ITP")
 * and fit any event whose title has them as whole words. Case and extra spaces
 * do not matter; no words means it fits every event.
 */
const squash = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const fitsTitle = (onlyFor, title) => {
  const words = squash(onlyFor);
  if (!words) return true;
  return new RegExp(`(^|[^a-z0-9])${escape(words)}($|[^a-z0-9])`).test(squash(title));
};
