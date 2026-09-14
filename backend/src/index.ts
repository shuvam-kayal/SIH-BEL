// Process entrypoint. Keep this file boring — everything interesting
// lives in app.ts (routing) and container.ts (wiring), both of which
// are importable by tests without opening a socket.

import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4000);

createApp().listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`);
  console.log("[backend] chain adapter: MockBlockchainAdapter (see src/container.ts)");
  console.log("[backend] authentication: bearer sessions; development credentials are accepted only through /auth/login");
});
