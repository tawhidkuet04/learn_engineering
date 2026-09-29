import type { Resume, ShakeProto } from '../sim/shake';

/** The playground's "nginx.conf · live": the server block for the chosen protocol and connection. */
export function liveNginxConf(cfg: { proto: ShakeProto; resume: Resume; ech: boolean }): string {
  return [
    'server {',
    cfg.proto === 'http' ? '    listen 80;' : '    listen 443 ssl;',
    '    server_name shop.example;',
    ...(cfg.proto === 'http'
      ? []
      : [
          '    ssl_certificate     fullchain.pem;',
          '    ssl_certificate_key privkey.pem;',
          `!    ssl_protocols       ${cfg.proto === 'tls13' ? 'TLSv1.3' : 'TLSv1.2'};`,
          `!    ssl_session_tickets ${cfg.resume === 'full' ? 'off' : 'on'};`,
          ...(cfg.resume === '0rtt' ? ['!    ssl_early_data      on;'] : []),
        ]),
    '}',
    ...(cfg.ech ? ['# ECH: set up at the CDN in front of the site,', '# with its key published in a DNS HTTPS record'] : []),
  ].join('\n');
}
