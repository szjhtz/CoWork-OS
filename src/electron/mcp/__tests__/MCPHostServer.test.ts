import { afterEach, describe, expect, it } from "vitest";
import { MCP_METHODS } from "../types";
import { MCPHostServer } from "../host/MCPHostServer";

describe("MCPHostServer resources", () => {
  afterEach(async () => {
    const server = MCPHostServer.getInstance();
    await server.stop();
  });

  it("lists and reads resources from the host provider", async () => {
    const server = MCPHostServer.getInstance();
    server.setToolProvider({
      getTools() {
        return [];
      },
      async executeTool() {
        return {};
      },
      getResources() {
        return [
          {
            uri: "cowork://tasks",
            name: "Tasks",
            mimeType: "application/json",
          },
        ];
      },
      async readResource(uri: string) {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({ ok: true }),
            },
          ],
        };
      },
    });

    const initializeResponse = await (server as Any).processMessage({
      jsonrpc: "2.0",
      id: 1,
      method: MCP_METHODS.INITIALIZE,
      params: { clientInfo: { name: "test" } },
    });
    expect(initializeResponse?.result?.capabilities?.resources?.subscribe).toBe(false);

    await (server as Any).processMessage({
      jsonrpc: "2.0",
      method: MCP_METHODS.INITIALIZED,
    });

    const listResponse = await (server as Any).processMessage({
      jsonrpc: "2.0",
      id: 2,
      method: MCP_METHODS.RESOURCES_LIST,
    });
    expect(listResponse?.result?.resources).toEqual([
      {
        uri: "cowork://tasks",
        name: "Tasks",
        mimeType: "application/json",
      },
    ]);

    const readResponse = await (server as Any).processMessage({
      jsonrpc: "2.0",
      id: 3,
      method: MCP_METHODS.RESOURCES_READ,
      params: { uri: "cowork://tasks" },
    });
    expect(readResponse?.result?.contents?.[0]?.text).toContain('"ok":true');
  });
});
