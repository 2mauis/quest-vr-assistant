import { startTestApp } from "../helpers.js";

export default async function globalSetup() {
  const started = await startTestApp({ ACK_WAIT_MS: "2000" });
  process.env.VR_MCP_E2E_STATE = JSON.stringify({
    port: started.port,
    tunnelPort: started.tunnelPort,
    bearer: started.env.MCP_BEARER_SECRET,
    pairing: started.env.DEVICE_PAIRING_TOKEN,
  });

  return async () => {
    delete process.env.VR_MCP_E2E_STATE;
    await started.app.close();
  };
}
