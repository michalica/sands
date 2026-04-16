import http from "node:http";

/**
 * HTTP client for the Firecracker API over a Unix socket.
 */
export class FirecrackerApi {
  constructor(private socketPath: string) {}

  put(path: string, body: object): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);

      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method: "PUT",
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
              reject(new Error(`Firecracker API ${path}: ${res.statusCode} ${responseBody}`));
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
