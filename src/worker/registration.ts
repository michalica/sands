import type { SandboxManager } from "../sandbox/manager.js";

interface FastifyLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

interface RegistrationOptions {
  controlPlaneUrl: string;
  workerId: string;
  workerPublicUrl: string;
  workerToken: string;
  manager: SandboxManager;
  logger: FastifyLogger;
  heartbeatIntervalMs?: number;
}

/**
 * Register this worker with the control plane on boot, then heartbeat
 * forever. Heartbeat carries current capacity so the control plane can
 * route new sandboxes intelligently.
 *
 * Both register and heartbeat retry on transient failures — the control
 * plane may not be up yet at worker boot, or it may be restarting.
 */
export function startRegistration(opts: RegistrationOptions): void {
  const interval = opts.heartbeatIntervalMs ?? 5000;

  const register = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${opts.controlPlaneUrl}/workers/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.workerToken}`,
        },
        body: JSON.stringify({
          workerId: opts.workerId,
          url: opts.workerPublicUrl,
          activeSandboxes: opts.manager.activeSandboxCount,
          maxSandboxes: opts.manager.maxSandboxCount,
        }),
      });
      if (!res.ok) {
        opts.logger.warn(`register: control plane returned ${res.status}`);
        return false;
      }
      opts.logger.info(`registered with control plane as ${opts.workerId}`);
      return true;
    } catch (err) {
      opts.logger.warn(`register failed: ${(err as Error).message}`);
      return false;
    }
  };

  const heartbeat = async (): Promise<void> => {
    try {
      const res = await fetch(
        `${opts.controlPlaneUrl}/workers/${encodeURIComponent(opts.workerId)}/heartbeat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.workerToken}`,
          },
          body: JSON.stringify({
            activeSandboxes: opts.manager.activeSandboxCount,
            maxSandboxes: opts.manager.maxSandboxCount,
          }),
        },
      );
      // Control plane responds 410 Gone if it doesn't know this worker —
      // means it restarted and we should re-register.
      if (res.status === 410 || res.status === 404) {
        opts.logger.warn(`heartbeat: control plane forgot us, re-registering`);
        await register();
      } else if (!res.ok) {
        opts.logger.warn(`heartbeat: control plane returned ${res.status}`);
      }
    } catch (err) {
      opts.logger.warn(`heartbeat failed: ${(err as Error).message}`);
    }
  };

  // Register-on-boot. Retry until success.
  (async () => {
    while (!(await register())) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    setInterval(heartbeat, interval);
  })();
}
