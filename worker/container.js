import { execSync, spawn } from 'child_process';

/**
 * Spawn a Docker container for agent execution.
 * Uses `docker run` CLI (simpler than Unix socket API for the worker).
 *
 * @param {string} image - Docker image to run
 * @param {string[]} env - Environment variables as KEY=VALUE strings
 * @param {Object} limits - { maxTimeMs, maxMemory }
 * @returns {{ containerId: string, exitPromise: Promise<number> }}
 */
export async function spawnContainer(image, env, limits) {
  const args = ['run', '--rm', '-d'];

  // Resource limits
  if (limits.maxMemory) {
    args.push('--memory', limits.maxMemory);
  }

  // Environment variables
  for (const e of env) {
    args.push('-e', e);
  }

  // Docker socket access (for skills that need it)
  args.push('-v', '/var/run/docker.sock:/var/run/docker.sock');

  args.push(image);

  // Start container and capture ID
  const containerId = execSync(`docker ${args.join(' ')}`, { encoding: 'utf-8' }).trim();
  console.log(`[container] Started ${containerId.slice(0, 12)} (image: ${image})`);

  // Wait for container to exit
  const exitPromise = new Promise((resolve) => {
    const proc = spawn('docker', ['wait', containerId], { stdio: 'pipe' });
    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.on('close', () => {
      const code = parseInt(output.trim(), 10);
      console.log(`[container] ${containerId.slice(0, 12)} exited with code ${code}`);
      resolve(isNaN(code) ? 1 : code);
    });
    proc.on('error', () => resolve(1));
  });

  return { containerId, exitPromise };
}

/**
 * Kill a running container.
 * @param {string} containerId
 * @param {string} reason
 */
export async function killContainer(containerId, reason) {
  console.log(`[container] Killing ${containerId.slice(0, 12)}: ${reason}`);
  try {
    execSync(`docker kill ${containerId}`, { stdio: 'pipe' });
  } catch {
    // Container may have already exited
  }
}
