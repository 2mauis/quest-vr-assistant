import { startTestApp } from "../helpers.ts";

export interface E2eState {
  port: number;
  tunnelPort: number;
  bearer: string;
  pairing: string;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const started = await startTestApp({ ACK_WAIT_MS: "2000" });
  const state: E2eState = {
    port: started.port,
    tunnelPort: started.tunnelPort,
    bearer: started.env.MCP_BEARER_SECRET,
    pairing: started.env.DEVICE_PAIRING_TOKEN,
  };
  process.env.VR_MCP_E2E_STATE = JSON.stringify(state);
  return async () => {
    delete process.env.VR_MCP_E2E_STATE;
    await started.app.close();
  };
}
