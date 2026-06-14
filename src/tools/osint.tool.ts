import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { requestConfirmation } from '../runtime/confirm.js';
import { emitProgress } from '../runtime/progress.js';
import { runCliTool } from './cli-runner.js';

const osintOutputDir = path.resolve('outputs', 'osint');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function confirmOsintAction(action: string, details: string[]) {
  return requestConfirmation({
    toolkitSlug: 'ZILMATE',
    toolSlug: 'OSINT',
    action,
    access: 'Read-only',
    targetTools: ['ZILMATE_OSINT'],
    details,
    summary: details.join('; '),
  });
}

async function ensureOutputDir(subdir?: string): Promise<string> {
  const dir = subdir ? path.join(osintOutputDir, subdir) : osintOutputDir;
  await mkdir(dir, { recursive: true });
  return dir;
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9_.-]/gi, '_');
}

/**
 * Run a CLI tool via the shared cross-platform runner.
 */
function runTool(command: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return runCliTool(command, args, { timeoutMs });
}

async function saveOutput(filename: string, content: string): Promise<string> {
  await ensureOutputDir();
  const p = path.join(osintOutputDir, filename);
  await writeFile(p, content, 'utf8');
  return p;
}

// ─── Username Scanners ────────────────────────────────────────────────────────

export const usernameTools = {
  /**
   * Sherlock: sherlock [--timeout N] [--print-found] [--csv] [--xlsx]
   *   --folderoutput <dir>   for multiple usernames
   *   --output <file>        for a single username
   *   Docs: https://sherlockproject.xyz/usage
   */
  runSherlock: tool({
    description:
      'Search for a username across 300+ social networks using Sherlock. Returns found profile URLs. Fast broad sweep — best starting point for any username.',
    inputSchema: z.object({
      username: z.string().min(1).describe('The handle to search for.'),
      timeout: z.number().int().min(5).max(120).optional().default(30).describe('Per-site request timeout in seconds (default 30).'),
      csv: z.boolean().optional().default(false).describe('Also export results as CSV.'),
      xlsx: z.boolean().optional().default(false).describe('Also export results as XLSX.'),
      printFoundOnly: z.boolean().optional().default(true).describe('Only output sites where account was found (cleaner output).'),
    }),
    execute: async ({ username, timeout, csv, xlsx, printFoundOnly }) => {
      const approved = await confirmOsintAction('Run Sherlock username scan', [
        `Target username: ${username}`,
        'Queries 300+ social networks for matching profiles',
        'Network requests from this machine only',
      ]);
      if (!approved) throw new Error('Blocked Sherlock scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'Sherlock scanning', detail: username });

      const dir = await ensureOutputDir('sherlock');
      const outFile = path.join(dir, `${sanitize(username)}-${ts()}.txt`);

      const args: string[] = ['--timeout', String(timeout), '--output', outFile, '--no-color'];
      if (printFoundOnly) args.push('--print-found');
      if (csv) args.push('--csv');
      if (xlsx) args.push('--xlsx');
      args.push(username);

      const raw = await runTool('sherlock', args, (timeout + 10) * 10_000);

      // Parse found URLs — lines starting with [+]
      const found = [...raw.matchAll(/\[\+\]\s+\S+:\s+(https?:\/\/\S+)/g)].map((m) => m[1]!);

      emitProgress({ type: 'tool:end', label: 'Sherlock complete', detail: `${found.length} profiles found` });
      return { username, found, foundCount: found.length, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),

  /**
   * Maigret: maigret <username> [--top-sites N] [-a] [--pdf] [--html] [--csv] [--json]
   *   --no-extracting        skip metadata extraction
   *   --permute              generate username variants
   *   Docs: https://github.com/soxoj/maigret
   */
  runMaigret: tool({
    description:
      'Deep username dossier across 3,000+ sites using Maigret. Extracts metadata, linked accounts, and builds reports. More thorough than Sherlock — use when you want full coverage.',
    inputSchema: z.object({
      username: z.string().min(1),
      allSites: z.boolean().optional().default(false).describe('Scan all 3,000+ sites (slow). Default: top 500 by traffic.'),
      permute: z.boolean().optional().default(false).describe('Also search common username variants (john_doe, j.doe, etc.).'),
      format: z.enum(['json', 'pdf', 'html', 'csv', 'txt']).optional().default('json').describe('Output report format.'),
      tags: z.string().optional().describe('Filter to sites with this tag (e.g. "photo", "dating", "us"). Comma-separated.'),
    }),
    execute: async ({ username, allSites, permute, format, tags }) => {
      const approved = await confirmOsintAction('Run Maigret deep username scan', [
        `Target: ${username}`,
        allSites ? 'Scanning all 3,000+ sites' : 'Scanning top 500 sites by traffic',
        permute ? 'Generating username permutations' : '',
        `Output format: ${format}`,
      ].filter(Boolean));
      if (!approved) throw new Error('Blocked Maigret scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'Maigret scanning', detail: username });

      const dir = await ensureOutputDir('maigret');
      const reportBase = path.join(dir, `${sanitize(username)}-${ts()}`);

      // Maigret places reports in the current dir under reports/ — use --folderoutput
      const args: string[] = ['--no-color', '--folderoutput', dir];
      if (allSites) args.push('-a');
      if (permute) args.push('--permute');
      if (tags) args.push('--tags', tags);
      // Output format flags: --pdf, --html, --csv, --json, --txt
      args.push(`--${format}`);
      args.push(username);

      const raw = await runTool('maigret', args, allSites ? 900_000 : 300_000);

      emitProgress({ type: 'tool:end', label: 'Maigret scan complete', detail: username });
      return { username, outputDir: dir, format, raw: raw.slice(0, 4000) };
    },
  }),

  /**
   * Blackbird (p1ngul1n0): python3 blackbird.py -u <username> -e <email> [--pdf] [--csv]
   *   Docs: https://github.com/p1ngul1n0/blackbird
   *   Note: installed as `blackbird` CLI via pip install blackbird-osint
   */
  runBlackbird: tool({
    description:
      'Search username and/or email across 600+ platforms using Blackbird (WhatsMyName dataset). Generates PDF/CSV profile reports. Best combined username+email sweep.',
    inputSchema: z.object({
      username: z.string().optional().describe('Username/handle to search.'),
      email: z.string().email().optional().describe('Email address to search alongside.'),
      pdf: z.boolean().optional().default(true).describe('Export results as PDF report.'),
      csv: z.boolean().optional().default(false).describe('Export results as CSV.'),
    }),
    execute: async ({ username, email, pdf, csv }) => {
      if (!username && !email) throw new Error('Provide at least one of username or email.');

      const approved = await confirmOsintAction('Run Blackbird scan', [
        username ? `Username: ${username}` : '',
        email ? `Email: ${email}` : '',
        'Searches 600+ platforms via WhatsMyName dataset',
        pdf ? 'Generating PDF report' : '',
      ].filter(Boolean));
      if (!approved) throw new Error('Blocked Blackbird scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'Blackbird scanning' });

      const args: string[] = ['--no-nsfw'];
      if (username) args.push('-u', username);
      if (email) args.push('-e', email);
      if (pdf) args.push('--pdf');
      if (csv) args.push('--csv');

      const raw = await runTool('blackbird', args, 240_000);
      const dir = await ensureOutputDir('blackbird');
      const outFile = await saveOutput(`blackbird/blackbird-${sanitize(username ?? email ?? 'scan')}-${ts()}.txt`, raw);

      emitProgress({ type: 'tool:end', label: 'Blackbird complete' });
      return { username, email, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),

  /**
   * Naminter: naminter <username>
   *   Uses TLS browser impersonation — bypasses Cloudflare bot detection
   *   Docs: https://github.com/soxoj/naminter
   */
  runNaminter: tool({
    description:
      'Username scan using TLS browser impersonation (bypasses Cloudflare/bot-detection). Use when Sherlock/Maigret get blocked on target sites.',
    inputSchema: z.object({
      username: z.string().min(1),
    }),
    execute: async ({ username }) => {
      const approved = await confirmOsintAction('Run Naminter username scan', [
        `Target: ${username}`,
        'Uses TLS impersonation — harder for sites to detect and block',
      ]);
      if (!approved) throw new Error('Blocked Naminter scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'Naminter scanning', detail: username });
      const raw = await runTool('naminter', [username], 240_000);
      const outFile = await saveOutput(`naminter/naminter-${sanitize(username)}-${ts()}.txt`, raw);
      emitProgress({ type: 'tool:end', label: 'Naminter complete' });
      return { username, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),

  /**
   * Linkook: linkook --url <profile_url> [--depth N]
   *   Recursively scrapes linked profiles to find alternate usernames
   *   Docs: https://github.com/soxoj/linkook
   */
  runLinkook: tool({
    description:
      'Recursively scrape a profile page and hunt for alternate usernames linked from it. Best when you already have one profile URL and want to find all connected accounts.',
    inputSchema: z.object({
      profileUrl: z.string().url().describe('Starting profile URL, e.g. https://twitter.com/target.'),
      depth: z.number().int().min(1).max(3).optional().default(1).describe('How many hops deep to follow links (1–3).'),
    }),
    execute: async ({ profileUrl, depth }) => {
      const approved = await confirmOsintAction('Run Linkook recursive profile scan', [
        `Starting URL: ${profileUrl}`,
        `Recursion depth: ${depth}`,
        'Scrapes linked profiles to map connected accounts',
      ]);
      if (!approved) throw new Error('Blocked Linkook scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'Linkook scanning', detail: profileUrl });
      const args = ['--url', profileUrl, '--depth', String(depth)];
      const raw = await runTool('linkook', args, 300_000);
      const outFile = await saveOutput(`linkook/linkook-${ts()}.txt`, raw);
      emitProgress({ type: 'tool:end', label: 'Linkook complete' });
      return { profileUrl, depth, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),
};

// ─── Email & Identity Tools ───────────────────────────────────────────────────

export const emailTools = {
  /**
   * Holehe: holehe [--only-used] [--no-color] <email>
   *   Output markers: [+] = found, [-] = not found, [x] = rate limit, [!] = error
   *   Docs: https://github.com/megadose/holehe
   */
  runHolehe: tool({
    description:
      'Silently check if an email is registered on 120+ platforms using Holehe. Uses the forgotten-password flow — never alerts the target. Best first step when you have an email.',
    inputSchema: z.object({
      email: z.string().email(),
    }),
    execute: async ({ email }) => {
      const approved = await confirmOsintAction('Run Holehe email registration check', [
        `Target: ${email}`,
        'Checks 120+ platforms silently via forgotten-password flow',
        'Target is never alerted',
      ]);
      if (!approved) throw new Error('Blocked Holehe scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'Holehe scanning', detail: email });

      // --only-used suppresses negative results for cleaner output
      // --no-color for clean parsing
      const raw = await runTool('holehe', ['--only-used', '--no-color', email], 240_000);

      // Parse: [+] = email used on platform
      const found = [...raw.matchAll(/\[\+\]\s+([^\n]+)/g)].map((m) => m[1]!.trim());
      // Parse: [x] = rate limited
      const rateLimited = [...raw.matchAll(/\[x\]\s+([^\n]+)/g)].map((m) => m[1]!.trim());

      const outFile = await saveOutput(`holehe/holehe-${email.replace('@', '_at_')}-${ts()}.txt`, raw);
      emitProgress({ type: 'tool:end', label: 'Holehe complete', detail: `${found.length} platforms found` });

      return { email, found, foundCount: found.length, rateLimited, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),

  /**
   * Epieos: epieos <email> [--api-key KEY]
   *   Reverse email → Google ID, profile pic, Calendar events, Maps reviews
   *   Docs: https://epieos.com
   */
  runEpieos: tool({
    description:
      'Reverse email lookup via Epieos. Extracts linked Google account ID, profile photo, public Calendar entries, and Google Maps reviews. Powerful for Gmail targets.',
    inputSchema: z.object({
      email: z.string().email(),
      apiKey: z.string().optional().describe('Epieos API key for extended quota. Uses free tier if omitted.'),
    }),
    execute: async ({ email, apiKey }) => {
      const approved = await confirmOsintAction('Run Epieos reverse email lookup', [
        `Target: ${email}`,
        'Queries Epieos for Google ID, profile picture, Calendar, Maps reviews',
      ]);
      if (!approved) throw new Error('Blocked Epieos lookup. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'Epieos lookup', detail: email });
      const args = [email];
      if (apiKey) args.push('--api-key', apiKey);
      const raw = await runTool('epieos', args, 60_000);
      const outFile = await saveOutput(`epieos/epieos-${email.replace('@', '_at_')}-${ts()}.txt`, raw);
      emitProgress({ type: 'tool:end', label: 'Epieos complete' });
      return { email, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),
};

// ─── Phone Tools ──────────────────────────────────────────────────────────────

export const phoneTools = {
  /**
   * PhoneInfoga: phoneinfoga scan -n <number> [--disable scanner1,scanner2]
   *   Scanners: local, numverify (needs NUMVERIFY_API_KEY), googlesearch, ovh
   *   Exact flag: -n or --number  (not --number as a positional)
   *   Docs: https://sundowndev.github.io/phoneinfoga/getting-started/usage/
   */
  runPhoneInfoga: tool({
    description:
      'Gather intelligence on a phone number using PhoneInfoga: carrier, country, line type, and OSINT footprints. Set NUMVERIFY_API_KEY env var for extended carrier data.',
    inputSchema: z.object({
      phoneNumber: z
        .string()
        .describe('Phone number with country code in E.164 format, e.g. +12125551234 or +233201234567.'),
      disableScanners: z
        .array(z.enum(['numverify', 'googlesearch', 'ovh']))
        .optional()
        .describe('Scanners to skip. "numverify" requires API key; skip if key not set.'),
    }),
    execute: async ({ phoneNumber, disableScanners }) => {
      const approved = await confirmOsintAction('Run PhoneInfoga phone scan', [
        `Target: ${phoneNumber}`,
        'Gathers carrier, line type, and OSINT footprints',
        disableScanners?.length ? `Skipping scanners: ${disableScanners.join(', ')}` : 'Running all configured scanners',
      ]);
      if (!approved) throw new Error('Blocked PhoneInfoga scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'PhoneInfoga scanning', detail: phoneNumber });

      // Correct flag is: phoneinfoga scan -n "+12125551234"
      const args = ['scan', '-n', phoneNumber];
      if (disableScanners?.length) {
        for (const s of disableScanners) args.push('--disable', s);
      }

      const raw = await runTool('phoneinfoga', args, 120_000);
      const outFile = await saveOutput(`phoneinfoga/phoneinfoga-${phoneNumber.replace(/\D/g, '')}-${ts()}.txt`, raw);
      emitProgress({ type: 'tool:end', label: 'PhoneInfoga complete' });
      return { phoneNumber, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),
};

// ─── Domain & Recon Tools ─────────────────────────────────────────────────────

export const domainTools = {
  /**
   * theHarvester: theHarvester -d <domain> -b <sources> -l <limit> [-f <output>] [-v] [-c] [-n]
   *   Sources: google, bing, yahoo, duckduckgo, crtsh, dnsdumpster, hackertarget,
   *            hunter, securityTrails, shodan, virustotal, certspotter, github-code, linkedin, all
   *   -v  verify hosts via DNS
   *   -c  DNS brute force
   *   -n  DNS reverse query on ranges
   *   Docs: https://github.com/laramies/theHarvester
   */
  runTheHarvester: tool({
    description:
      'Harvest emails, subdomains, hosts, and employee names for a target domain. Queries search engines, cert databases, and DNS. API keys for Shodan/Hunter/SecurityTrails unlock more results.',
    inputSchema: z.object({
      domain: z.string().min(3).describe('Target domain, e.g. example.com.'),
      sources: z
        .array(
          z.enum([
            'baidu', 'bing', 'certspotter', 'crtsh', 'dnsdumpster', 'duckduckgo',
            'github-code', 'google', 'hackertarget', 'hunter', 'linkedin',
            'otx', 'securityTrails', 'shodan', 'urlscan', 'virustotal', 'yahoo', 'all',
          ]),
        )
        .optional()
        .default(['bing', 'crtsh', 'dnsdumpster', 'hackertarget', 'duckduckgo'])
        .describe('Data sources to query. Use "all" to query every available source.'),
      limit: z.number().int().min(10).max(1000).optional().default(200).describe('Max results per source.'),
      verifyDns: z.boolean().optional().default(false).describe('Verify discovered hosts via DNS (-v flag).'),
      bruteForceDns: z.boolean().optional().default(false).describe('DNS brute force for subdomains (-c flag).'),
    }),
    execute: async ({ domain, sources, limit, verifyDns, bruteForceDns }) => {
      const approved = await confirmOsintAction('Run theHarvester domain recon', [
        `Domain: ${domain}`,
        `Sources: ${sources!.join(', ')}`,
        `Limit: ${limit} results per source`,
        verifyDns ? 'DNS verification enabled' : '',
        bruteForceDns ? 'DNS brute force enabled' : '',
      ].filter(Boolean));
      if (!approved) throw new Error('Blocked theHarvester scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'theHarvester scanning', detail: domain });

      const dir = await ensureOutputDir('harvester');
      const outBase = path.join(dir, `${sanitize(domain)}-${ts()}`);

      const args = [
        '-d', domain,
        '-b', sources!.join(','),
        '-l', String(limit),
        '-f', outBase, // saves both .xml and .json
      ];
      if (verifyDns) args.push('-v');
      if (bruteForceDns) args.push('-c');

      const raw = await runTool('theHarvester', args, 600_000);

      // Extract emails from raw output
      const emails = [...new Set(
        [...raw.matchAll(/[\w.+%-]+@[\w-]+\.[a-z]{2,}/gi)].map((m) => m[0]!.toLowerCase()),
      )];
      // Extract subdomains/hosts
      const hosts = [...new Set(
        [...raw.matchAll(/(?:\[\*\]|\[\+\])\s+([\w.-]+\.[\w.-]+)/g)].map((m) => m[1]!),
      )];

      emitProgress({ type: 'tool:end', label: 'theHarvester complete', detail: `${emails.length} emails, ${hosts.length} hosts` });
      return {
        domain,
        emails,
        hosts,
        emailCount: emails.length,
        hostCount: hosts.length,
        outputFiles: { xml: `${outBase}.xml`, json: `${outBase}.json` },
        raw: raw.slice(0, 4000),
      };
    },
  }),

  /**
   * SpiderFoot: python3 -m spiderfoot -s <target> -o json -R <output>
   *   Or spiderfoot CLI if installed globally
   *   Docs: https://github.com/smicallef/spiderfoot
   */
  runSpiderFoot: tool({
    description:
      'Full digital footprint mapping using SpiderFoot (200+ modules). Accepts IP, domain, email, username, or name as input. Queries WHOIS, DNS, leaks, social, certificates, and more.',
    inputSchema: z.object({
      target: z.string().min(1).describe('Target: domain, IP, email, username, or name.'),
      modules: z
        .array(z.string())
        .optional()
        .describe('Specific SpiderFoot module names (e.g. "sfp_whois", "sfp_dns_resolve"). Omit to auto-select by target type.'),
      maxRuntime: z.number().int().min(30).max(3600).optional().default(300).describe('Max scan seconds (default 5 min).'),
    }),
    execute: async ({ target, modules, maxRuntime }) => {
      const approved = await confirmOsintAction('Run SpiderFoot reconnaissance', [
        `Target: ${target}`,
        modules?.length ? `Modules: ${modules.join(', ')}` : 'Auto-selecting modules by target type',
        `Max runtime: ${maxRuntime}s`,
      ]);
      if (!approved) throw new Error('Blocked SpiderFoot scan. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'SpiderFoot scanning', detail: target });

      const dir = await ensureOutputDir('spiderfoot');
      const outFile = path.join(dir, `sf-${sanitize(target)}-${ts()}.json`);

      const args = ['-s', target, '-o', 'json', '-R', outFile];
      if (modules?.length) args.push('-m', modules.join(','));

      const raw = await runTool('spiderfoot', args, (maxRuntime! + 30) * 1000);
      emitProgress({ type: 'tool:end', label: 'SpiderFoot complete', detail: target });
      return { target, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),
};

// ─── File & Network Tools ─────────────────────────────────────────────────────

export const forensicsTools = {
  /**
   * ExifTool: exiftool [-json] [-csv] [-GPS*] <file>
   *   -json         structured JSON output (one object per file)
   *   -GPS*         extract only GPS fields
   *   -fast         skip tail-of-file scan (faster on large files)
   *   Docs: https://exiftool.org
   */
  runExifTool: tool({
    description:
      'Extract all hidden metadata from an image, PDF, or document using ExifTool. Can reveal GPS coordinates, camera make/model/serial, author, creation timestamps, and software used.',
    inputSchema: z.object({
      filePath: z.string().min(1).describe('Absolute path to the file to analyze.'),
      gpsOnly: z.boolean().optional().default(false).describe('Extract only GPS fields — faster if you just need location data.'),
    }),
    execute: async ({ filePath, gpsOnly }) => {
      const approved = await confirmOsintAction('Run ExifTool metadata extraction', [
        `File: ${filePath}`,
        gpsOnly ? 'Extracting GPS coordinates only' : 'Extracting all available metadata',
      ]);
      if (!approved) throw new Error('Blocked ExifTool analysis. Ask user to approve.');

      if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

      emitProgress({ type: 'tool:start', label: 'ExifTool extracting metadata', detail: filePath });

      const args = ['-json'];
      if (gpsOnly) args.push('-GPS*');
      args.push(filePath);

      const raw = await runTool('exiftool', args, 30_000);

      let metadata: Record<string, unknown> | null = null;
      try {
        const arr = JSON.parse(raw) as Record<string, unknown>[];
        metadata = arr[0] ?? null;
      } catch { /* output wasn't valid JSON */ }

      const outFile = await saveOutput(`exiftool/exiftool-${sanitize(path.basename(filePath))}-${ts()}.json`, raw);
      emitProgress({ type: 'tool:end', label: 'ExifTool complete' });
      return { filePath, metadata, outputFile: outFile };
    },
  }),

  /**
   * Shodan CLI: shodan host <ip> | shodan domain <domain> | shodan search <query>
   *   Requires SHODAN_API_KEY env var (free tier works for basic host lookups)
   *   Docs: https://cli.shodan.io
   */
  runShodan: tool({
    description:
      'Query Shodan for open ports, exposed services, CVEs, and device banners on an IP or domain. Requires SHODAN_API_KEY environment variable. Free tier supports basic host lookups.',
    inputSchema: z.object({
      target: z.string().min(1).describe('IP address or domain to look up.'),
      type: z
        .enum(['host', 'domain', 'search'])
        .optional()
        .default('host')
        .describe('"host" for a specific IP, "domain" for DNS records/IPs, "search" for a Shodan dork query.'),
      query: z.string().optional().describe('Shodan search query when type is "search", e.g. "org:\\"Example Corp\\"".'),
    }),
    execute: async ({ target, type, query }) => {
      if (!process.env.SHODAN_API_KEY) {
        throw new Error('SHODAN_API_KEY is not set. Add it to your .env file and restart the agent.');
      }

      const approved = await confirmOsintAction('Run Shodan lookup', [
        `Target: ${target}`,
        `Type: ${type}`,
        'Queries Shodan for open ports, banners, CVEs',
      ]);
      if (!approved) throw new Error('Blocked Shodan lookup. Ask user to approve.');

      emitProgress({ type: 'tool:start', label: 'Shodan querying', detail: target });

      let args: string[];
      if (type === 'search') {
        // shodan search --fields ip_str,port,org,hostnames <query>
        args = ['search', '--fields', 'ip_str,port,org,hostnames', query ?? target];
      } else if (type === 'domain') {
        args = ['domain', target];
      } else {
        args = ['host', target];
      }

      const raw = await runTool('shodan', args, 60_000);
      const outFile = await saveOutput(`shodan/shodan-${sanitize(target)}-${ts()}.txt`, raw);
      emitProgress({ type: 'tool:end', label: 'Shodan complete' });
      return { target, type, outputFile: outFile, raw: raw.slice(0, 4000) };
    },
  }),
};

// ─── Meta Orchestration ───────────────────────────────────────────────────────

export const orchestrationTools = {
  /**
   * Master investigation entry point — chains the right tools based on what identifiers are known.
   *
   * Chain logic by depth:
   *   quick    → Sherlock, Holehe, PhoneInfoga, theHarvester (fastest single-source per input type)
   *   standard → all quick + Blackbird, ExifTool
   *   deep     → all standard + Maigret, Linkook, SpiderFoot (thorough, slow)
   */
  osintInvestigation: tool({
    description:
      'Master OSINT investigation. Accepts any combination of identifiers (username, email, phone, domain, file, profile URL) and chains the right tools automatically. Use this as the primary entry point.',
    inputSchema: z.object({
      username: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional().describe('E.164 format, e.g. +233201234567'),
      domain: z.string().optional().describe('e.g. example.com'),
      filePath: z.string().optional().describe('Absolute path to image/PDF for metadata extraction.'),
      profileUrl: z.string().url().optional().describe('A known profile URL to start recursive link mapping from.'),
      depth: z
        .enum(['quick', 'standard', 'deep'])
        .optional()
        .default('standard')
        .describe(
          'quick = one fast tool per input; standard = all reliable tools; deep = everything including Maigret, SpiderFoot, Linkook (slow)',
        ),
    }),
    execute: async ({ username, email, phone, domain, filePath, profileUrl, depth }) => {
      const identifiers = [
        username && `username: ${username}`,
        email && `email: ${email}`,
        phone && `phone: ${phone}`,
        domain && `domain: ${domain}`,
        filePath && `file: ${filePath}`,
        profileUrl && `profileUrl: ${profileUrl}`,
      ].filter(Boolean) as string[];

      if (!identifiers.length) throw new Error('Provide at least one identifier.');

      const approved = await confirmOsintAction('Run full OSINT investigation', [
        `Identifiers: ${identifiers.join(', ')}`,
        `Depth: ${depth}`,
        'Chains multiple OSINT tools sequentially based on available inputs',
      ]);
      if (!approved) throw new Error('Blocked investigation. Ask user to approve.');

      // Build execution plan
      const plan: Array<{ name: string; run: () => Promise<unknown> }> = [];

      if (username) {
        plan.push({ name: 'sherlock', run: () => runTool('sherlock', ['--print-found', '--no-color', '--timeout', '30', username], 90_000) });
        if (depth === 'deep') {
          plan.push({ name: 'maigret', run: () => runTool('maigret', ['--no-color', '--json', username], 600_000) });
        }
        if (depth !== 'quick') {
          plan.push({
            name: 'blackbird',
            run: () => runTool('blackbird', ['--no-nsfw', '-u', username], 240_000),
          });
        }
        if (depth === 'deep' && profileUrl) {
          plan.push({ name: 'linkook', run: () => runTool('linkook', ['--url', profileUrl, '--depth', '2'], 300_000) });
        }
      }

      if (email) {
        plan.push({ name: 'holehe', run: () => runTool('holehe', ['--only-used', '--no-color', email], 240_000) });
        if (depth !== 'quick') {
          plan.push({ name: 'epieos', run: () => runTool('epieos', [email], 60_000) });
          plan.push({ name: 'blackbird (email)', run: () => runTool('blackbird', ['--no-nsfw', '-e', email], 240_000) });
        }
      }

      if (phone) {
        plan.push({ name: 'phoneinfoga', run: () => runTool('phoneinfoga', ['scan', '-n', phone], 120_000) });
      }

      if (domain) {
        plan.push({
          name: 'theHarvester',
          run: () => runTool('theHarvester', ['-d', domain, '-b', 'bing,crtsh,dnsdumpster,hackertarget', '-l', '200'], 600_000),
        });
        if (depth === 'deep') {
          plan.push({ name: 'spiderfoot', run: () => runTool('spiderfoot', ['-s', domain, '-o', 'json'], 600_000) });
          plan.push({ name: 'shodan', run: () => runTool('shodan', ['domain', domain], 60_000) });
        }
      }

      if (filePath && existsSync(filePath)) {
        plan.push({ name: 'exiftool', run: () => runTool('exiftool', ['-json', filePath], 30_000) });
      }

      emitProgress({ type: 'tool:start', label: 'Investigation started', detail: `${plan.length} tools planned` });

      const results: Record<string, unknown> = {};
      for (const step of plan) {
        emitProgress({ type: 'tool:start', label: `Running ${step.name}` });
        try {
          const raw = await step.run() as string;
          results[step.name] = raw.slice(0, 2000);
          emitProgress({ type: 'tool:end', label: `${step.name} done` });
        } catch (err) {
          results[step.name] = { error: err instanceof Error ? err.message : String(err) };
          emitProgress({ type: 'tool:end', label: `${step.name} failed` });
        }
      }

      const report = JSON.stringify({ identifiers, depth, plan: plan.map((p) => p.name), results }, null, 2);
      const outFile = await saveOutput(`investigation-${sanitize(identifiers[0]!)}-${ts()}.json`, report);

      emitProgress({ type: 'tool:end', label: 'Investigation complete', detail: outFile });
      return { identifiers, depth, toolsRun: plan.map((p) => p.name), outputFile: outFile, results };
    },
  }),
};

// ─── Barrel export ────────────────────────────────────────────────────────────

export const osintTools = {
  ...usernameTools,
  ...emailTools,
  ...phoneTools,
  ...domainTools,
  ...forensicsTools,
  ...orchestrationTools,
};