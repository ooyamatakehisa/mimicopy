// @vitest-environment node

import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { installGlobalHttpDispatcher } from "./httpDispatcher.js";

describe("installGlobalHttpDispatcher", () => {
  it("finishes a response that closes while its body is under backpressure", async () => {
    installGlobalHttpDispatcher();

    const body = Buffer.alloc(64 * 1024, 0x61);
    const server = createServer((socket) => {
      socket.once("data", () => {
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`
        );
        socket.write(body);
        socket.end();
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();

      if (!address || typeof address === "string") {
        throw new Error("Test server did not expose a port.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/`);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const responseBody = await response.arrayBuffer();

      expect(responseBody.byteLength).toBe(body.length);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });
});
