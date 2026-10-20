// Cloudflare sets this header, so clients can't spoof it. Locally it may be missing,
// which just means all dev requests share one key.
export const clientKey = (req: Request) => req.headers.get("CF-Connecting-IP") ?? "unknown";