export async function register() {
  // Sentry initialization for server/edge runtimes
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }

  // Korean Law MCP keep-alive (Node runtime only)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const url = process.env.MCP_SERVER_URL ?? "https://korean-law-mcp.fly.dev/mcp";
    const ping = () =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .catch(() => {});
    ping();
    setInterval(ping, 4 * 60 * 1000);
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
