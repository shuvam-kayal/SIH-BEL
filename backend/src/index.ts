// Process entrypoint. Keep this file boring — everything interesting
// lives in app.ts (routing) and container.ts (wiring), both of which
// are importable by tests without opening a socket.

import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

createApp().listen(port, host, () => {
  console.log(`[backend] listening on http://${host}:${port}`);
  const chain = (process.env.BEL_BLOCKCHAIN ?? "mock").trim().toLowerCase() || "mock";
  console.log(`[backend] chain adapter: ${chain === "evm" ? "EvmBlockchainAdapter" : "MockBlockchainAdapter"}`);
  console.log("[backend] authentication: bearer sessions; development credentials are accepted only through /auth/login");
});
