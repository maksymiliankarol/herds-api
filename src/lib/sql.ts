// Escape LIKE wildcards so a search for "100%" or "a_b" is treated literally
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");