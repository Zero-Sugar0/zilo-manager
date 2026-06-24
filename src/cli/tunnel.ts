// ZilMate handles cloudflared as an external dependency; it is not automatically downloaded.
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

export type TunnelResult = {
  url: string;
  provider: 'cloudflare';
  detail: string;
};

async function commandExists(command: string) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    await execFileAsync(probe, [command], { windowsHide: true, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function extractCloudflareUrl(output: string) {
  const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match?.[0] ?? '';
}

export async function startCloudflareQuickTunnel(localUrl: string, timeoutMs = 45_000): Promise<TunnelResult> {
  if (!(await commandExists('cloudflared'))) {
    throw new Error('cloudflared is not installed. Run `zilmate setup` to install it, or install manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', ['tunnel', '--url', localUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    let output = '';
    const onData = (chunk: Buffer | string) => {
      output += String(chunk);
      const url = extractCloudflareUrl(output);
      if (url) {
        clearTimeout(timer);
        resolve({ url, provider: 'cloudflare', detail: output.slice(-400) });
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Timed out waiting for Cloudflare tunnel URL. Output: ${output.slice(-300)}`));
    }, timeoutMs);

    child.on('close', (code) => {
      if (!extractCloudflareUrl(output)) {
        reject(new Error(code === 0
          ? 'Cloudflare tunnel closed before returning a public URL.'
          : `cloudflared exited ${code}: ${output.slice(-300)}`));
      }
    });
  });
}

export async function cloudflareTunnelDoctor() {
  const hasCloudflared = await commandExists('cloudflared');
  return {
    name: 'Cloudflare tunnel',
    ok: hasCloudflared,
    detail: hasCloudflared
      ? 'cloudflared is available for optional QStash webhook tunnels'
      : 'Install cloudflared to auto-create a public webhook URL during setup',
  };
}
