import http from "node:http";

/**
 * HTTP client for the Firecracker API over a Unix socket.
 */
export class FirecrackerApi {
  constructor(private socketPath: string) {}

  put(path: string, body: object): Promise<void> {
    return this.request("PUT", path, body);
  }

  patch(path: string, body: object): Promise<void> {
    return this.request("PATCH", path, body);
  }

  private request(method: "PUT" | "PATCH", path: string, body: object): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);

      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        },
        (res) => {
          let responseBody = "";
          res.on("data", (chunk) => { responseBody += chunk; });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Firecracker API ${method} ${path}: ${res.statusCode} ${responseBody}`));
            } else {
              resolve();
            }
          });
        },
      );

      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }
}
