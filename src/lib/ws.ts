// Finish the upgrade, send an event, close with a code: a browser can't read the
// status of a failed handshake, but it can read a close code.
export function rejectUpgrade(code: number, reason: string): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.send(JSON.stringify({ type: "rejected", code, error: reason }));
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}