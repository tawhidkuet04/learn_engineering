import type { Algo, Size } from '../engine/types';

interface ServerLine {
  label: string;
  ip: string;
  size: Size;
  weight: number;
  up: boolean;
}

const ALGO_LINE: Record<Algo, string> = {
  rr: '    # round robin: the default, no directive needed',
  least: '!    least_conn;',
  weighted: '    # weighted round robin: see weight= below',
  iphash: '!    ip_hash;',
  random: '!    random;',
  p2c: '!    random two least_conn;   # power of two choices',
};

const SIZE_NAME: Record<Size, string> = { s: '2 cores', m: '4 cores', l: '8 cores' };

/** Builds the NGINX config that matches the playground's current settings. */
export function nginxConfig(algo: Algo, servers: ServerLine[], healthChecks: boolean): string {
  const lines = ['upstream backend {', ALGO_LINE[algo]];
  for (const s of servers) {
    const weight = algo === 'weighted' && s.weight !== 1 ? ` weight=${s.weight}` : '';
    const note = `# ${s.label}, ${SIZE_NAME[s.size]}${s.up ? '' : ', crashed'}`;
    const line = `    server ${s.ip}:8080${weight};`;
    lines.push(`${weight ? '!' : ''}${line.padEnd(38)}${note}`);
  }
  if (healthChecks) {
    lines.push('', '!    # active checks (NGINX Plus) or HAProxy "check"', '!    # health_check interval=2s fails=3 passes=2;');
  }
  lines.push(
    '}',
    '',
    'server {',
    '    listen 443 ssl;',
    '    ssl_certificate     /etc/ssl/shop.example.crt;',
    '    ssl_certificate_key /etc/ssl/shop.example.key;',
    '    location / {',
    '        proxy_pass http://backend;',
    '    }',
    '}',
  );
  return lines.join('\n');
}
