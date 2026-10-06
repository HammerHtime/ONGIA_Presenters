/**
 * Some things belong to one kind of training only: the RBH ITP week has its own
 * welcome letter and its own VIA Rail job. They carry the words that name those
 * events ("RBH ITP") and fit any event whose title has them. Case and extra
 * spaces do not matter; no words means it fits every event.
 */
const squash = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
export const fitsTitle = (onlyFor, title) => !squash(onlyFor) || squash(title).includes(squash(onlyFor));
