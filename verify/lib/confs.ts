/**
 * Turns the config snippets shown in lessons into configs the real programs
 * can load. Every change made here is mechanical and listed in `changes`:
 * example addresses become local ports, certificate paths become a
 * throwaway self-signed certificate. Nothing else about the snippet changes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpDir } from './procs';
import { plain } from './snippets';

let cert: { crt: string; key: string } | null = null;

/** A self-signed certificate for shop.example (made once per run). */
export function testCert() {
  if (cert && existsSync(cert.crt)) return cert;
  const dir = tmpDir('cert');
  const crt = path.join(dir, 'shop.example.crt');
  const key = path.join(dir, 'shop.example.key');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=shop.example', '-addext', 'subjectAltName=DNS:shop.example,DNS:*.shop.example,DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  cert = { crt, key };
  return cert;
}

/**
 * Separate the lines of a fragment that can only live at http level
 * (upstream/map blocks, *_zone and cache-path lines) from the rest.
 */
function splitHttpLevel(text: string) {
  const http: string[] = [];
  const rest: string[] = [];
  let depth = 0;
  let block = false;
  let statement = false;
  for (const line of text.split('\n')) {
    const code = line.replace(/#.*$/, '');
    if (depth === 0 && /^\s*(upstream|map|geo|split_clients)\b/.test(code)) block = true;
    if (depth === 0 && /^\s*(limit_req_zone|limit_conn_zone|proxy_cache_path|log_format|map_hash_\w+|variables_hash_\w+)\b/.test(code)) statement = true;
    (block || statement ? http : rest).push(line);
    depth += (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
    if (block && depth === 0) block = false;
    if (statement && code.includes(';')) statement = false;
  }
  return { http, rest };
}

export interface Prepared {
  text: string;
  changes: string[];
}

/**
 * An nginx snippet ready for an `http {}` block.
 * - `addresses`: e.g. { '10.0.1.11:8080': '127.0.0.1:53121' }
 * - `port`: every `listen` moves to 127.0.0.1:<port> (flags like `ssl` stay)
 * - certificate paths point at the test certificate
 * - a bare list of `location` blocks gets wrapped in a `server {}`
 * - `proxy_pass http://name` to an upstream the snippet doesn't define gets a stub upstream
 */
export function nginxHttp(code: string, opts: { port: number; addresses?: Record<string, string>; stub?: string; front?: boolean }): Prepared {
  const changes: string[] = [];
  let text = plain(code);
  for (const [from, to] of Object.entries(opts.addresses ?? {})) {
    if (text.includes(from)) {
      text = text.replaceAll(from, to);
      changes.push(`${from} → ${to}`);
    }
  }
  text = text.replace(/listen\s+(?:[\d.]+:)?(\d+)([^;]*);/g, (_m, p: string, rest: string) => {
    changes.push(`listen ${p} → 127.0.0.1:${opts.port}`);
    return `listen 127.0.0.1:${opts.port}${rest};`;
  });
  const c = testCert();
  text = text.replace(/(ssl_certificate(?:_key)?)\s+([^;\s]+);/g, (_m, dir: string, file: string) => {
    changes.push(`${file} → test certificate`);
    return `${dir} ${dir.endsWith('_key') ? c.key : c.crt};`;
  });
  if (!/^\s*server\s*\{/m.test(text) && /^\s*location\b/m.test(text)) {
    const { http, rest } = splitHttpLevel(text);
    text = `${http.join('\n')}\nserver {\n    listen 127.0.0.1:${opts.port};\n${rest.join('\n')}\n}`;
    changes.push(http.length ? 'wrapped the locations in server {} (http-level lines kept outside)' : 'wrapped in server {}');
  }
  const defined = new Set([...text.matchAll(/upstream\s+([\w.-]+)\s*\{/g)].map((m) => m[1]));
  if (opts.front && !/^\s*server\s*\{/m.test(text) && defined.size) {
    const first = [...defined][0];
    text = `${text}\nserver {\n    listen 127.0.0.1:${opts.port};\n    location / { proxy_pass http://${first}; }\n}`;
    changes.push(`added a server {} that proxies to ${first}`);
  }
  const used = new Set([...text.matchAll(/proxy_pass\s+https?:\/\/([\w.-]+)[;/]/g)].map((m) => m[1]).filter((n) => !/^[\d.]+$/.test(n)));
  for (const name of used) {
    if (defined.has(name)) continue;
    text = `upstream ${name} { server ${opts.stub ?? '127.0.0.1:9'}; }\n${text}`;
    changes.push(`stub upstream ${name}`);
  }
  return { text, changes };
}

/**
 * A HAProxy snippet made loadable: adds `defaults` with timeouts when the
 * snippet has none, and a frontend on 127.0.0.1:<port> when it only shows a
 * backend. `bind` lines move to the local port.
 */
export function haproxyCfg(code: string, opts: { port: number; addresses?: Record<string, string>; logs?: boolean }): Prepared {
  const changes: string[] = [];
  let text = plain(code);
  for (const [from, to] of Object.entries(opts.addresses ?? {})) {
    if (text.includes(from)) {
      text = text.replaceAll(from, to);
      changes.push(`${from} → ${to}`);
    }
  }
  text = text.replace(/bind\s+[^\n#]*?:(\d+)/g, (_m, p: string) => {
    changes.push(`bind :${p} → 127.0.0.1:${opts.port}`);
    return `bind 127.0.0.1:${opts.port}`;
  });
  const head: string[] = [];
  if (opts.logs) head.push('global', '    log stderr format short local0 info');
  if (!/^defaults/m.test(text)) {
    head.push('defaults', '    timeout connect 5s', '    timeout client 30s', '    timeout server 30s');
    if (opts.logs) head.push('    log global', '    option log-health-checks');
    changes.push('added defaults (timeouts)');
  }
  if (!/^(frontend|listen)\b/m.test(text)) {
    const backend = text.match(/^backend\s+(\S+)/m)?.[1] ?? 'web';
    const mode = /^\s*mode\s+tcp/m.test(text) ? 'tcp' : 'http';
    head.push(`frontend www`, `    mode ${mode}`, `    bind 127.0.0.1:${opts.port}`, `    default_backend ${backend}`);
    changes.push('added a frontend');
  }
  if (!/^\s*mode\s+/m.test(text) && head.includes('defaults')) head.splice(head.indexOf('defaults') + 1, 0, '    mode http');
  return { text: `${head.join('\n')}\n${text}\n`, changes };
}
