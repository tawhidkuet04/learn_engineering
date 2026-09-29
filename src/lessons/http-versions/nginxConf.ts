import type { Proto } from './engine';

/** The playground's "nginx.conf · live": the server block that serves the page over one HTTP version. */
export function nginxFor(proto: Proto, zeroRtt: boolean) {
  const lines = ['server {'];
  if (proto === 'h3') lines.push('!    listen 443 quic reuseport;');
  lines.push(`${proto === 'h1.0' || proto === 'h1.1' ? '!' : ''}    listen 443 ssl;`);
  if (proto === 'h2' || proto === 'h3') lines.push('!    http2 on;');
  lines.push('    server_name shop.example;');
  lines.push('    ssl_certificate     /etc/ssl/shop.example.pem;');
  lines.push('    ssl_certificate_key /etc/ssl/shop.example.key;');
  if (proto === 'h3') {
    lines.push(`!    add_header Alt-Svc 'h3=":443"; ma=86400';`);
    if (zeroRtt) lines.push('!    ssl_early_data on;    # allow 0-RTT');
  }
  if (proto === 'h1.0') lines.push('    keepalive_timeout 0;  # close after each response');
  lines.push('}');
  return lines.join('\n');
}
