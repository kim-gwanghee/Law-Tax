export async function register() {
  const url = process.env.MCP_SERVER_URL ?? "https://korean-law-mcp.fly.dev/mcp";

  const ping = () =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .catch(() => {});

  // Initial warmup on server start
  ping();

  // Keep fly.dev alive with pings every 4 minutes (fly.dev sleeps after 5 min idle)
  setInterval(ping, 4 * 60 * 1000);
}
