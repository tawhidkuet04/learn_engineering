import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { CheatSheet } from './Panel';
import type { Chapter } from './types';

export const LESSON = {
  slug: 'http-versions',
  code: 'NET-06',
  track: 'Networking',
  title: 'HTTP/1.1 vs 2 vs 3',
};

const ORANGE = <strong style={{ color: 'var(--sig-heavy)' }}>orange</strong>;

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'one-page',
    title: 'One page, many files',
    steps: [
      {
        id: 'many-files',
        title: 'A page is many files',
        cfg: { proto: 'h1.1' },
        body: (
          <>
            <p>
              Open <code>shop.example</code> and your browser doesn&apos;t get one file. It gets an <strong>HTML document</strong>, and the HTML points to more:
              a stylesheet, a script, a logo, a hero image, a grid of product photos, and a font the stylesheet asks for. Twelve files for this small page; real
              pages often need dozens.
            </p>
            <p>
              Watch the <Term k="browser">browser window</Term>: the page fills in as each file lands. Below it, the <Term k="lower">waterfall</Term> has one
              row per file, showing when it was requested and when its bytes arrived. The page is done when the last row ends.
            </p>
            <p>
              Right now the browser speaks <strong>HTTP/1.1</strong>, the version that carried the web for almost twenty years. Every version in this lesson
              loads this same page, so keep an eye on the timer.
            </p>
            <Aside>The stage runs ten times slower than real life. Timers show real milliseconds for a server 100 ms away.</Aside>
          </>
        ),
        callouts: [
          {
            target: 'c:browser',
            text: (
              <>
                the page <b>fills in</b> as files land
              </>
            ),
            dir: 'down',
          },
        ],
        hud: ['proto', 'load', 'files'],
        legend: ['html', 'css', 'js', 'font', 'img'],
        code: {
          title: 'index.html',
          lang: 'http',
          code: `
<!doctype html>
!<link rel="stylesheet" href="/style.css">
!<script src="/app.js" defer></script>
!<img src="/logo.svg" alt="shop.example">
!<img src="/hero.jpg" alt="">
!<img src="/p1.jpg"> <img src="/p2.jpg"> …`,
          note: 'font.woff2 isn’t in the HTML: style.css asks for it, so the browser only finds it once the CSS has arrived.',
        },
      },
      {
        id: 'round-trips',
        title: 'Round trips, not bandwidth',
        cfg: { proto: 'h1.1' },
        body: (
          <>
            <p>
              Every request has to reach the server, and the answer has to come back, before anything happens. That&apos;s one <strong>round trip</strong>, or{' '}
              <strong>RTT</strong>. A nearby server is 10–30 ms away; across an ocean or over a busy mobile network, 100–300 ms is normal.
            </p>
            <p>
              Most web files are small, so the link&apos;s bandwidth is rarely what you wait for. You wait for round trips. Drag the slider: the load time
              climbs almost in step with the RTT, while the bandwidth never changes.
            </p>
            <p>
              So the real question for every HTTP version is: <em>how many round trips does a page cost?</em>
            </p>
          </>
        ),
        interactions: [{ kind: 'slider', sliders: ['rtt'], stats: 'rtts' }],
        callouts: [
          {
            target: 'c:lanes-r',
            text: (
              <>
                each request: <b>there and back</b>
              </>
            ),
            dir: 'up',
          },
        ],
        hud: ['rtt', 'load', 'files'],
        legend: ['req', 'css', 'js', 'img'],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ping -c 3 shop.example
PING shop.example (203.0.113.10): 56 data bytes
!64 bytes from 203.0.113.10: icmp_seq=0 ttl=54 time=98.1 ms
!64 bytes from 203.0.113.10: icmp_seq=1 ttl=54 time=101.4 ms
!64 bytes from 203.0.113.10: icmp_seq=2 ttl=54 time=99.7 ms`,
          note: 'ping measures exactly this: the time for a packet to get to the server and back.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'http1',
    title: 'HTTP/1.x: one at a time',
    steps: [
      {
        id: 'http-1-0',
        title: 'HTTP/1.0: a connection per file',
        cfg: { proto: 'h1.0', labels: true },
        body: (
          <>
            <p>
              In <strong>HTTP/1.0</strong> (1996), a connection carried exactly one request. For every file, the browser opened a TCP connection, sent the
              request, read the response, and the connection closed. Browsers ran a few of these side by side, but every file paid for a brand-new connection.
            </p>
            <p>
              Opening a connection costs round trips before any HTTP happens. TCP&apos;s handshake (<code>SYN</code>, <code>SYN-ACK</code>, <code>ACK</code>)
              takes one; the TLS handshake that makes it HTTPS takes another. The {ORANGE} packets on every lane, and the {ORANGE} at the start of every
              waterfall row, are handshaking, not downloading.
            </p>
            <Aside>
              HTTP/1.0 is older than everyday HTTPS. We add TLS 1.3 so every version pays the same encryption cost; even without it, each file still pays
              TCP&apos;s round trip.
            </Aside>
          </>
        ),
        callouts: [
          {
            target: 'c:seg:connect',
            text: (
              <>
                <b>2 round trips</b>, on every file
              </>
            ),
            dir: 'up',
          },
        ],
        hud: ['proto', 'load', 'hs'],
        legend: ['hs', 'req', 'html', 'css', 'img'],
        code: {
          title: 'HTTP/1.0 on the wire',
          lang: 'http',
          code: `
GET /style.css HTTP/1.0
User-Agent: Mozilla/5.0 …

HTTP/1.0 200 OK
Content-Type: text/css
Content-Length: 31842

!… then the server closes the connection`,
        },
      },
      {
        id: 'keep-alive',
        title: 'HTTP/1.1: keep the connection open',
        cfg: { proto: 'h1.1', labels: true, mode: 'h1req' },
        body: (
          <>
            <p>
              <strong>HTTP/1.1</strong> (1997) made connections <strong>persistent</strong>: after a response, the same connection carries the next request.
              Only the first file on each connection pays for handshakes: 6 handshakes for this page instead of 12.
            </p>
            <p>
              But a connection still carries <strong>one request at a time</strong>. Send it, wait a round trip, read the whole response, and only then send the
              next. To get work done in parallel, browsers open up to <strong>six connections per host</strong>.
            </p>
            <p>
              Files beyond those six wait in the browser&apos;s queue. That&apos;s the thin grey lead-in on the later <Term k="lower">waterfall</Term> rows.
            </p>
          </>
        ),
        callouts: [
          {
            target: 'c:lanes-r',
            text: (
              <>
                6 connections, <b>one file each</b>
              </>
            ),
            dir: 'up',
          },
        ],
        hud: ['proto', 'load', 'hs', 'queue'],
        legend: ['hs', 'req', 'css', 'js', 'img'],
        code: {
          title: 'HTTP/1.1 on the wire',
          lang: 'http',
          code: `
GET /app.js HTTP/1.1
Host: shop.example
!Connection: keep-alive

HTTP/1.1 200 OK
Content-Type: text/javascript
Content-Length: 63907

!… and the connection stays open for the next request`,
        },
      },
      {
        id: 'head-of-line',
        title: 'Head-of-line blocking',
        cfg: { proto: 'h1.1', conns: 1, slowHero: true },
        body: (
          <>
            <p>
              Say the server needs 250 ms to produce <code>hero.jpg</code>, because it resizes it on the fly. On a single connection, everything queued behind
              it waits, even tiny files the server could send instantly.
            </p>
            <p>
              That&apos;s <strong>head-of-line blocking</strong>: the request at the front of the line holds up the whole line. Six connections soften it, since
              the slow file ties up only one of them, but that&apos;s a workaround, not a fix. Every extra connection costs its own handshakes.
            </p>
            <Aside>
              HTTP/1.1 also defined <strong>pipelining</strong>: sending several requests without waiting. Responses still had to come back in order, so one
              slow response blocked the rest, and buggy proxies mangled pipelined traffic. Browsers shipped it turned off.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Give the browser more lanes:',
            initial: 0,
            options: [
              { label: '1 connection', cfg: { conns: 1 }, note: <>One lane: every file waits for everything ahead of it, including the slow hero.jpg.</> },
              { label: '6 connections', cfg: { conns: 6 }, note: <>Six lanes: hero.jpg still takes 250 ms, but it only holds up its own connection.</> },
            ],
            results: [
              { label: '1 connection', key: 'h1.1·1' },
              { label: '6 connections', key: 'h1.1' },
            ],
          },
        ],
        callouts: [
          {
            target: 'c:row:hero.jpg',
            text: (
              <>
                slow file at the <b>head of the line</b>
              </>
            ),
            dir: 'right',
          },
        ],
        hud: ['proto', 'load', 'queue'],
        legend: ['req', 'css', 'js', 'font', 'img'],
      },
      {
        id: 'workarounds',
        title: 'Hacks: sharding, sprites, bundles',
        cfg: { proto: 'h1.1', bundle: true },
        body: (
          <>
            <p>
              For years, web developers fought HTTP/1.1 with hacks. <strong>Domain sharding</strong> spread files over <code>img1.shop.example</code>,{' '}
              <code>img2.shop.example</code>… so browsers would open six connections to <em>each</em>. <strong>Sprites</strong> packed dozens of icons into one
              image. <strong>Bundling</strong> glued scripts and stylesheets together, and <strong>inlining</strong> pasted small files into the HTML.
            </p>
            <p>They all do one thing: fewer requests, shorter queues. Try it: the slider splits the same bytes into more or fewer files.</p>
            <Aside>
              These hacks backfire later. Sharding costs extra handshakes and defeats HTTP/2&apos;s single connection, and with one giant bundle, a one-line
              change means re-downloading everything.
            </Aside>
          </>
        ),
        interactions: [{ kind: 'slider', sliders: ['files'], stats: 'load' }],
        hud: ['proto', 'load', 'files'],
        legend: ['req', 'css', 'js', 'img'],
        code: {
          title: 'index.html · style.css',
          lang: 'http',
          code: `
<!-- sharding: more hostnames, more connections -->
!<img src="https://img1.shop.example/p1.jpg">
!<img src="https://img2.shop.example/p2.jpg">

/* a sprite: many icons, one request */
!.icon-cart { background: url(/sprites.png) -32px 0; }`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'http2',
    title: 'HTTP/2: many streams, one connection',
    steps: [
      {
        id: 'multiplexing',
        title: 'Multiplexing: everything at once',
        cfg: { proto: 'h2', labels: true },
        body: (
          <>
            <p>
              <strong>HTTP/2</strong> (2015) opens <strong>one</strong> connection per site and sends every request at once. Each request and its response form
              a <strong>stream</strong>, and the server interleaves slices of all the responses on the same connection. That&apos;s{' '}
              <strong>multiplexing</strong>.
            </p>
            <p>
              Watch the <Term k="pipe">pipe</Term>: once the HTML arrives, a burst of requests leaves together, and colored slices of many files come back
              interleaved. One handshake, no queue, no six-connection limit. The <Term k="server">server</Term> now has every response on the go at once.
            </p>
            <Aside>
              Browsers only speak HTTP/2 over TLS. Both sides agree on it inside the TLS handshake, using ALPN: the browser offers <code>h2</code> and{' '}
              <code>http/1.1</code>, and the server picks.
            </Aside>
          </>
        ),
        callouts: [
          {
            target: 'c:pipe',
            text: (
              <>
                <b>one connection</b>, files interleaved
              </>
            ),
            dir: 'up',
          },
        ],
        hud: ['proto', 'load', 'conns', 'streams'],
        legend: ['req', 'html', 'css', 'js', 'font', 'img'],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ curl -sI --http2 https://shop.example
!HTTP/2 200
content-type: text/html; charset=utf-8
content-length: 28391
date: Sat, 26 Sep 2026 10:00:00 GMT`,
          note: 'HTTP/2 header names are always lowercase.',
        },
      },
      {
        id: 'frames',
        title: 'Binary frames and stream IDs',
        cfg: { proto: 'h2', mode: 'frames' },
        body: (
          <>
            <p>
              HTTP/1.1 messages are plain text. HTTP/2 chops every message into binary <strong>frames</strong>, and every frame starts with a 9-byte header: its{' '}
              <strong>length</strong>, its <strong>type</strong>, some <strong>flags</strong>, and the <strong>stream ID</strong> it belongs to.
            </p>
            <p>
              Requests travel as <code>HEADERS</code> frames; bodies as <code>DATA</code> frames of up to 16 KB. The browser numbers its streams 1, 3, 5… (even
              numbers belong to the server). However the frames are interleaved, the stream ID tells the receiver which file each one is part of. Follow the
              card.
            </p>
            <Aside>
              Streams can carry priorities too, so CSS can jump ahead of images. HTTP/2&apos;s original priority tree was so complex it was replaced by a simple
              Priority header. Server push, which let servers send files before they were asked for, rarely helped and browsers removed it.
            </Aside>
          </>
        ),
        hud: ['proto', 'load', 'streams'],
        legend: ['req', 'css', 'js', 'font', 'img'],
        code: {
          title: 'RFC 9113 · frame format',
          lang: 'conf',
          code: `
HTTP Frame {
  Length (24),
  Type (8),
  Flags (8),
  Reserved (1),
!  Stream Identifier (31),
  Frame Payload (..),
}`,
          note: 'Numbers are sizes in bits: 24 + 8 + 8 + 1 + 31 = 72 bits, the 9-byte header.',
        },
      },
      {
        id: 'hpack',
        title: 'HPACK: squeezing the headers',
        cfg: { proto: 'h2', mode: 'hpack', lower: 'hpack' },
        body: (
          <>
            <p>
              Every request carries headers, and most of them repeat: the same cookie, the same user-agent, the same accept headers. Over HTTP/1.1 that&apos;s
              often 500+ bytes of text, sent again in full with every request.
            </p>
            <p>
              HTTP/2 compresses them with <strong>HPACK</strong>. Both ends keep a table of headers they&apos;ve already seen. The first request fills the
              table; after that, a repeated header is just an index, about a byte. Only what changes, like the <code>:path</code>, is spelled out.
            </p>
            <Aside>
              Why not just gzip the headers? SPDY, HTTP/2&apos;s predecessor, did, and the CRIME attack showed that compressing secrets like cookies next to
              attacker-controlled text leaks them. HPACK was designed to resist that. HTTP/3 uses a close cousin, QPACK.
            </Aside>
          </>
        ),
        hud: ['proto', 'hdr', 'files'],
        legend: ['req'],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ nghttp -nv https://shop.example/p1.jpg
[  0.101] send SETTINGS frame <length=12, flags=0x00, stream_id=0>
![  0.101] send HEADERS frame <length=26, flags=0x05, stream_id=13>
          ; END_STREAM | END_HEADERS
          :method: GET
          :path: /p1.jpg`,
          note: 'nghttp prints every frame. After the first request, a whole HEADERS frame is a few dozen bytes.',
        },
      },
      {
        id: 'tcp-hol',
        title: 'The catch: one loss stalls everything',
        cfg: { proto: 'h2', mode: 'hol', forceLoss: [9], clickDrop: true },
        predict: { needed: 2, prompt: 'Watch the shared connection. When a chunk goes missing, predict what TCP does.' },
        body: (
          <>
            <p>
              HTTP/2 fixed head-of-line blocking at the HTTP layer, but it runs on TCP, and TCP has its own. TCP promises{' '}
              <strong>one ordered stream of bytes</strong>. It knows nothing about the files multiplexed inside it.
            </p>
            <p>
              So when a single packet is lost, every byte behind it waits in TCP&apos;s buffer until the resend arrives, about a round trip later. Frames from
              every file are stuck, even though they arrived safely.
            </p>
            <p>Watch for the lost chunk and predict. Then drop some yourself: click chunks in flight.</p>
            <Aside>
              Real TCP also slows down after a loss (congestion control), which hurts one shared connection more than six separate ones. On lossy networks, that
              can make HTTP/1.1 beat HTTP/2. This simulation leaves congestion control out.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              { label: 'Drop the next chunk', icon: 'x', run: (s) => s.dropNext() },
              { label: 'Reload the page', icon: 'replay', run: (s) => s.reload() },
            ],
          },
        ],
        callouts: [
          {
            target: 'c:hold',
            text: (
              <>
                arrived fine, <b>held by TCP</b>
              </>
            ),
            dir: 'down',
          },
        ],
        hud: ['proto', 'load', 'lost', 'held'],
        legend: ['css', 'js', 'font', 'img', 'lost'],
        code: {
          title: 'Wireshark · tshark',
          lang: 'c',
          code: `
$ tshark -r load.pcap -Y tcp.analysis.flags
 812 0.412 TCP [TCP Previous segment not captured]
 813 0.413 TCP [TCP Dup ACK 811#1]
 814 0.414 TCP [TCP Dup ACK 811#2]
 815 0.414 TCP [TCP Dup ACK 811#3]
!819 0.512 TCP [TCP Fast Retransmission]`,
          note: 'A capture of one loss (trimmed). The browser keeps re-acknowledging the last byte it has in order until the server resends, a round trip later.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'http3',
    title: 'HTTP/3 and QUIC',
    steps: [
      {
        id: 'quic-streams',
        title: 'QUIC: streams that don’t wait',
        cfg: { proto: 'h3', mode: 'quic', forceLoss: [9], clickDrop: true },
        body: (
          <>
            <p>
              <strong>HTTP/3</strong> (2022) keeps HTTP/2&apos;s ideas (streams, frames, compressed headers) but replaces what&apos;s underneath. Instead of TCP
              it runs on <strong>QUIC</strong>, a transport built on top of UDP. A brand-new transport wouldn&apos;t get through the internet&apos;s firewalls
              and NAT boxes; UDP does, so QUIC builds its own reliability and encryption on top of it.
            </p>
            <p>
              QUIC knows about streams, and delivers each one in order <em>on its own</em>. A lost packet only holds up the stream it belonged to. Here&apos;s
              the same loss as before: one file waits for its resend while every other file keeps flowing.
            </p>
            <p>Click chunks to drop them. Each time, only one lane stalls.</p>
            <Aside>
              All QUIC packets still travel the same path, just like TCP&apos;s. The separate lanes show how the receiver orders the data: per stream, instead
              of per connection.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              { label: 'Drop the next chunk', icon: 'x', run: (s) => s.dropNext() },
              { label: 'Reload the page', icon: 'replay', run: (s) => s.reload() },
            ],
          },
        ],
        callouts: [
          {
            target: 'c:hold',
            text: (
              <>
                only <b>this stream</b> waits
              </>
            ),
            dir: 'down',
          },
        ],
        hud: ['proto', 'load', 'lost', 'held'],
        legend: ['css', 'js', 'font', 'img', 'lost'],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ curl --http3 -sI https://shop.example
!HTTP/3 200
content-type: text/html; charset=utf-8
alt-svc: h3=":443"; ma=86400`,
          note: 'Needs a curl built with HTTP/3 support: curl -V lists HTTP3 under Features.',
        },
      },
      {
        id: 'handshakes',
        title: 'Count the handshake round trips',
        cfg: { view: 'seq', mode: 'handshakes' },
        predict: { needed: 3, prompt: 'How many round trips before the browser can send GET?' },
        body: (
          <>
            <p>
              Before the first HTTP request, browser and server must set up a connection and agree on encryption keys. Over TCP those are two separate
              handshakes, one after the other. QUIC merges its transport handshake with TLS 1.3&apos;s.
            </p>
            <p>
              Predict how many round trips each needs before the browser can send <code>GET /</code>, then watch the messages play out.
            </p>
            <Aside>
              0-RTT data can be replayed by an attacker, so it&apos;s only allowed for safe requests like GET. TLS 1.3 over TCP can resume with 0-RTT too, but
              TCP&apos;s own handshake still costs a round trip first. With TLS 1.2, TCP + TLS takes three round trips before the first request.
            </Aside>
          </>
        ),
        legend: ['hs', 'req', 'res'],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ curl -so /dev/null --http2 https://shop.example \\
    -w 'tcp %{time_connect}  tls %{time_appconnect}  first byte %{time_starttransfer}\\n'
!tcp 0.101  tls 0.203  first byte 0.305`,
          note: 'Against a server 100 ms away: one round trip for TCP, one for TLS, one for the request itself.',
        },
      },
      {
        id: 'migration',
        title: 'Switching networks mid-load',
        cfg: { proto: 'h2', mode: 'migration', labels: true },
        body: (
          <>
            <p>
              You walk out of the house mid-load and your phone hops from Wi-Fi to 5G. Its <Term k="browser">IP address</Term> changes.
            </p>
            <p>
              A TCP connection is identified by four numbers: source IP, source port, destination IP, destination port. Change one and the connection is gone.
              HTTP/2 has to notice, handshake all over again, and re-request everything that hadn&apos;t finished.
            </p>
            <p>
              QUIC identifies a connection by a <strong>connection ID</strong> carried in every packet. When packets arrive from a new address with the same ID,
              the server checks the new path (the purple <code>PATH_CHALLENGE</code>) and carries on. Only what was in flight is resent. Toggle between the two.
            </p>
            <Aside>
              So that an observer can&apos;t link your old and new addresses, each side hands out several connection IDs and switches to a fresh one when the
              path changes.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Which protocol is loading when the network changes?',
            initial: 0,
            options: [
              {
                label: 'HTTP/2 over TCP',
                cfg: { proto: 'h2' },
                note: <>The TCP connection dies with the old address: new handshakes, and every unfinished file starts over.</>,
              },
              { label: 'HTTP/3 over QUIC', cfg: { proto: 'h3' }, note: <>Same connection ID, new path. Only the chunks that were in flight are resent.</> },
            ],
            results: [
              { label: 'HTTP/2', key: 'h2' },
              { label: 'HTTP/3', key: 'h3' },
            ],
          },
          { kind: 'actions', buttons: [{ label: 'Switch networks now', icon: 'bolt', run: (s) => s.switchNetwork() }] },
        ],
        callouts: [
          {
            target: 'c:browser',
            text: (
              <>
                new network, <b>new IP address</b>
              </>
            ),
            dir: 'down',
          },
        ],
        hud: ['proto', 'load', 'net', 'hs'],
        legend: ['hs', 'req', 'ctl', 'lost'],
        code: {
          title: 'RFC 9000 · short header packet',
          lang: 'conf',
          code: `
1-RTT Packet {
  Header Form (1) = 0,
  Fixed Bit (1) = 1,
  Spin Bit (1),
  Reserved Bits (2),
  Key Phase (1),
  Packet Number Length (2),
!  Destination Connection ID (0..160),
  Packet Number (8..32),
  Packet Payload (8..),
}`,
          note: 'No IP addresses or ports in sight: the Destination Connection ID tells the server which connection a packet belongs to.',
        },
      },
      {
        id: 'alt-svc',
        title: 'How browsers find HTTP/3',
        cfg: { mode: 'altsvc' },
        body: (
          <>
            <p>
              A browser can&apos;t know in advance that a server speaks HTTP/3, and some networks block UDP. So the first visit goes over TCP, and the server
              advertises HTTP/3 in a response header: <code>alt-svc: h3=&quot;:443&quot;; ma=86400</code> means &ldquo;HTTP/3 on UDP port 443, remember it for a
              day&rdquo;.
            </p>
            <p>
              Watch the first load run over HTTP/2 and the next one switch to HTTP/3. Browsers keep TCP as a fallback, and stop trying QUIC for a while if UDP
              doesn&apos;t get through.
            </p>
            <Aside>
              Newer DNS <code>HTTPS</code> records can advertise h3 before the first visit, so even the first connection can use QUIC.
            </Aside>
          </>
        ),
        interactions: [{ kind: 'actions', buttons: [{ label: 'Forget it and revisit', icon: 'replay', run: (s) => s.forgetAltSvc() }] }],
        hud: ['proto', 'load', 'files'],
        legend: ['hs', 'req', 'html', 'css', 'img'],
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
server {
!    listen 443 quic reuseport;   # HTTP/3 over UDP
    listen 443 ssl;              # HTTP/1.1 and HTTP/2 over TCP
!    http2 on;
    server_name shop.example;
    ssl_certificate     /etc/ssl/shop.example.pem;
    ssl_certificate_key /etc/ssl/shop.example.key;
!    add_header Alt-Svc 'h3=":443"; ma=86400';
}`,
          note: 'nginx 1.25 or newer. Only one listen line per address and port may say reuseport.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'race',
    title: 'Head to head',
    cfg: { view: 'race' },
    steps: [
      {
        id: 'clean-race',
        title: 'Race on a clean network',
        body: (
          <>
            <p>Same page, same 100 ms round trip, no packet loss. Three browsers load it side by side.</p>
            <p>
              HTTP/1.1 pays for queues and six sets of handshakes. <Term k="race:h2">HTTP/2</Term> and <Term k="race:h3">HTTP/3</Term> both fetch everything at
              once over one connection. HTTP/3 finishes about one round trip sooner, because its handshake is one round trip shorter.
            </p>
            <p>On a clean, fast network, that handshake is most of the difference between the two.</p>
          </>
        ),
        interactions: [{ kind: 'actions', buttons: [{ label: 'Race again', icon: 'replay', run: (s) => s.reload() }] }],
        callouts: [
          {
            target: 'c:race-hs:h3',
            text: (
              <>
                handshake: <b>1 round trip</b>, not 2
              </>
            ),
            dir: 'up',
          },
        ],
        hud: ['rtt', 'loss'],
        legend: ['hs', 'html', 'css', 'js', 'font', 'img'],
      },
      {
        id: 'lossy-race',
        title: 'Race on a lossy network',
        cfg: { mode: 'race-predict', pktLoss: 0.01 },
        predict: { needed: 2, prompt: 'Now 1% of packets get lost. Predict before the race starts.' },
        body: (
          <>
            <p>
              Now make the network worse: 1% of packets are lost, like a phone on a crowded cell tower. The dashed line in each row marks that version&apos;s
              time on a clean network.
            </p>
            <p>Predict the winner before the race starts. Then watch the red: each hatched block is a file waiting for lost data.</p>
            <Aside>
              Each square stands for about 11 real packets, so at 1% packet loss roughly one square in ten goes missing. Real TCP also slows down after every
              loss, which hits HTTP/2&apos;s single connection hardest; the simulation leaves that out.
            </Aside>
          </>
        ),
        code: {
          title: 'terminal · Linux test box',
          lang: 'shell',
          code: `
# make this network: +100 ms per round trip, 1% of packets dropped
!$ sudo tc qdisc add dev eth0 root netem delay 100ms loss 1%
$ curl -so /dev/null -w '%{time_total}\\n' --http2 https://shop.example
$ curl -so /dev/null -w '%{time_total}\\n' --http3 https://shop.example`,
          note: 'netem delays and drops packets as they leave eth0. Remove it with: sudo tc qdisc del dev eth0 root',
        },
        hud: ['rtt', 'loss'],
        legend: ['css', 'js', 'font', 'img', 'lost'],
      },
      {
        id: 'your-network',
        title: 'Your network, your winner',
        cfg: { pktLoss: 0.005 },
        body: (
          <>
            <p>
              Your turn to set the network. With a short round trip and no loss, the three converge: there are few round trips to save. Raise the latency and
              HTTP/3&apos;s shorter handshake pulls ahead. Add loss and watch HTTP/2&apos;s stalls spread across every file.
            </p>
            <p>
              That&apos;s why HTTP/3 makes the biggest difference on mobile networks and long distances, while on a fast wired connection you&apos;d barely
              notice.
            </p>
          </>
        ),
        interactions: [{ kind: 'slider', sliders: ['rtt', 'loss', 'count'], stats: 'race' }],
        hud: ['rtt', 'loss'],
        legend: ['css', 'js', 'font', 'img', 'lost'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    steps: [
      {
        id: 'devtools',
        title: 'Check it in your browser',
        cfg: { view: 'devtools', proto: 'h2' },
        body: (
          <>
            <p>
              Open DevTools, go to the <strong>Network</strong> panel, right-click the column headers and turn on <strong>Protocol</strong>. Every request shows{' '}
              <code>http/1.1</code>, <code>h2</code> or <code>h3</code>. Turn on <strong>Connection ID</strong> too: an HTTP/1.1 site uses up to six per host,
              while HTTP/2 and HTTP/3 use one.
            </p>
            <p>
              Only seeing <code>h3</code> from the second visit on? That&apos;s Alt-Svc at work.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Load the page over:',
            initial: 1,
            options: [
              { label: 'HTTP/1.1', cfg: { proto: 'h1.1' } },
              { label: 'HTTP/2', cfg: { proto: 'h2' } },
              { label: 'HTTP/3', cfg: { proto: 'h3' } },
            ],
          },
        ],
        legend: [],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ curl -so /dev/null -w '%{http_version}\\n' https://shop.example
!2
$ curl -sI --http3 https://shop.example | head -1
!HTTP/3 200`,
        },
      },
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { view: 'race', pktLoss: 0.005 },
        body: <p>The whole story on one card. On stage, all three versions keep racing on a slightly lossy network.</p>,
        extra: <CheatSheet />,
        hud: ['rtt', 'loss'],
        legend: ['hs', 'css', 'js', 'font', 'img', 'lost'],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { proto: 'h2', mode: 'playground', clickDrop: true, varySeed: true, labels: true },
        body: (
          <p>
            Everything in one sandbox. Pick a version, set the network, click chunks to drop them, switch networks mid-load, or race all three. The server
            config below updates to match.
          </p>
        ),
        interactions: [{ kind: 'playground' }],
        hud: ['proto', 'load', 'lost', 'hs', 'rtt', 'loss'],
        legend: ['hs', 'req', 'css', 'js', 'img', 'lost'],
      },
    ],
  },
];
