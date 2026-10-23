// Names nobody can pick. Keep in sync with herds-web (src/lib/profile.ts).
const RESERVED = [
  "admin", "administrator", "moderator", "mod", "staff", "support",
  "system", "owner", "official", "root", "bot", "herds", "metalogrom",
];

// NFKC folds look-alikes like full-width "ａｄｍｉｎ" into plain letters; _ and - are ignored
export const isReservedName = (name: string) =>
  RESERVED.includes(name.normalize("NFKC").toLowerCase().replace(/[_-]/g, ""));