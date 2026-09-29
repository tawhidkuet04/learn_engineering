import type { LegendItem } from '@/components/stage/chrome';
import type { LessonMeta } from '@/components/lesson/LessonStage';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { SIG } from '@/lib/sim/colors';
import { CheatSheet } from './panel';
import { DAY, type CdnSim } from './sim';
import type { Chapter } from './types';

export const META: LessonMeta = { slug: 'cdn', code: 'SD-03', track: 'System design', title: 'CDNs' };

const L: Record<string, LegendItem> = {
  req: { label: 'request', color: SIG.req },
  res: { label: 'response', color: SIG.res },
  fill: { label: 'cache fill (to origin)', color: SIG.heavy },
  reval: { label: 'revalidation', color: SIG.hc },
  purge: { label: 'purge', color: SIG.hc },
  err: { label: 'error', color: SIG.err },
  old: { label: 'old version', color: SIG.warn },
  reroute: { label: 'rerouted', color: SIG.warn, shape: 'line' },
  carol: { label: 'Carol’s page', color: SIG.pink },
  dave: { label: 'Dave’s page', color: SIG.teal },
  handshake: { label: 'TLS handshake', color: SIG.hc },
};

const setLogo = (maxAge: number, swr = 0) => (s: CdnSim) => {
  s.setMaxAge('logo', maxAge);
  s.setSwr('logo', swr);
};

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'distance',
    title: 'Distance is latency',
    cfg: { cdn: false, warm: 'cold', mix: { app: 1 } },
    steps: [
      {
        id: 'one-server-one-planet',
        title: 'One server, one planet',
        cfg: { rps: 1.4 },
        body: (
          <>
            <p>
              Your online shop, <code>shop.example</code>, runs on one server in Virginia: the <Term k="origin">origin</Term>. Your code, your files
              and your database all live there.
            </p>
            <p>
              Your customers don&apos;t. Every glowing dot is a request crossing an ocean and coming back, and the tag by each city is how long that
              round trip takes.
            </p>
            <p>
              <Term k="user:london">London</Term> hears back in about 85 ms. <Term k="user:sydney">Sydney</Term> waits about 212 ms for the exact
              same file. Same server, same code. The only difference is <strong>distance</strong>.
            </p>
            <Aside>
              The numbers in this lesson come from a simple model: great-circle distance, plus 30% for real cable routes, plus 8 ms for the last mile
              (home Wi-Fi to the ISP). Real pings wobble around them.
            </Aside>
          </>
        ),
        callouts: [{ target: 'origin', text: <>your <b>origin</b>: the only server</>, dir: 'up' }],
        hud: ['avg'],
        readout: 'distances',
        legend: [L.req, L.res],
      },
      {
        id: 'speed-of-light',
        title: 'The speed of light is too slow',
        cfg: { rps: 0.55, cities: ['sydney'] },
        focus: ['user:sydney', 'origin'],
        route: { from: 'user:sydney', to: 'origin', label: '15,700 km' },
        body: (
          <>
            <p>
              Why does distance cost so much? Nothing on the internet travels faster than light, and light in optical fiber is slower than in a vacuum:
              about <strong>200,000 km per second</strong>.
            </p>
            <p>
              That&apos;s <strong>5 ms for every 1,000 km</strong>, one way. Sydney to Virginia is 15,700 km along the shortest path over the globe, so
              even a perfect cable needs 78 ms there and 78 ms back. Real cables take longer routes and pass through many routers, so the actual round
              trip is about 212 ms.
            </p>
            <p>
              You can buy more bandwidth. You can&apos;t buy a faster speed of light. The only fix is to <strong>move the server closer</strong>.
            </p>
          </>
        ),
        readout: 'light',
        quiz: {
          question: 'Alice’s office in Sydney upgrades from 100 Mbit/s to 1 Gbit/s. How much faster does a small request to Virginia get?',
          options: [
            {
              text: 'About 10× faster',
              why: 'Bandwidth is how much data fits through per second: the width of the pipe. A small request doesn’t even fill the slow pipe.',
            },
            {
              text: 'Barely faster at all',
              correct: true,
              why: 'The wait comes from the length of the pipe, not its width. The bytes still cross 15,700 km and back, at the same speed as before.',
            },
            {
              text: 'Twice as fast',
              why: 'There’s no halving here: the round trip is set by distance and the speed of light in glass, and both stay the same.',
            },
          ],
        },
        code: {
          title: 'terminal · in Sydney',
          lang: 'shell',
          code: `
$ ping -c 3 shop.example
PING shop.example (203.0.113.10): 56 data bytes
!64 bytes from 203.0.113.10: icmp_seq=0 ttl=49 time=213.1 ms
64 bytes from 203.0.113.10: icmp_seq=1 ttl=49 time=211.7 ms
64 bytes from 203.0.113.10: icmp_seq=2 ttl=49 time=212.4 ms`,
          note: 'ping measures one round trip. Everything a browser does costs at least one.',
        },
        legend: [L.req, L.res],
      },
      {
        id: 'round-trips-add-up',
        title: 'A page load is many round trips',
        cfg: { view: 'sequence', seq: 'pageload', mode: 'idle', rps: 0 },
        body: (
          <>
            <p>A browser doesn&apos;t make one trip to load a page. It makes several, and each waits for the one before. For a fresh visit:</p>
            <p>
              A <strong>TCP handshake</strong> opens the connection: one round trip. A <strong>TLS handshake</strong> sets up encryption: another. Only
              then can the browser <strong>GET</strong> the HTML: a third. The HTML asks for CSS and JavaScript: a fourth. (A <strong>DNS</strong>{' '}
              lookup comes first, usually answered by a resolver nearby.)
            </p>
            <p>
              Add it up: the DNS lookup plus four round trips to Virginia is 869 ms of pure waiting before the page can render. With a server in
              Sydney, the same steps take 53 ms. Watch both play out on the same clock.
            </p>
            <Aside>
              Shown: TLS 1.3 over HTTP/2. TLS 1.2 needs one more round trip, while HTTP/3 (QUIC) merges the TCP and TLS handshakes into one. Big files
              need extra round trips too, because TCP starts slowly and speeds up.
            </Aside>
          </>
        ),
        code: {
          title: 'terminal · in Sydney',
          lang: 'shell',
          code: `
$ curl -so /dev/null https://shop.example/ -w \\
    'dns %{time_namelookup}  tcp %{time_connect}  tls %{time_appconnect}  ttfb %{time_starttransfer}\\n'
!dns 0.021113  tcp 0.233420  tls 0.445802  ttfb 0.657960`,
          note: 'curl’s timers are cumulative, in seconds. Each phase adds one 212 ms round trip to Virginia.',
        },
        legend: [L.req, L.res, L.handshake],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'edges',
    title: 'Enter the CDN',
    cfg: { cdn: true, warm: 'all', warmFiles: ['app', 'logo'], mix: { app: 1, logo: 1 }, chips: ['app', 'logo'] },
    steps: [
      {
        id: 'meet-the-edges',
        title: 'A CDN: copies near everyone',
        cfg: { rps: 1.4 },
        body: (
          <>
            <p>
              A <strong>content delivery network</strong> (CDN) runs servers in hundreds of cities. Each location is a <strong>point of presence</strong>{' '}
              (PoP), often named after the nearest airport: <Term k="pop:SYD">SYD</Term>, <Term k="pop:LHR">LHR</Term>,{' '}
              <Term k="pop:GRU">GRU</Term>.
            </p>
            <p>
              The <strong>edge servers</strong> in each PoP keep copies of your files in a cache (the boxes beside each PoP: green means a copy is
              there). Your <Term k="origin">origin</Term> stays in Virginia as the source of truth.
            </p>
            <p>
              Now each user talks to the edge in their own city. A cached file comes back in about <strong>8 ms</strong>, anywhere on the map.
            </p>
            <Aside>These edges already hold copies of your files. How they got them is the next chapter.</Aside>
          </>
        ),
        callouts: [{ target: 'pop:SYD', text: <>an <b>edge</b> with its own cache</>, dir: 'down' }],
        calloutsPortrait: [],
        hud: ['avg', 'hit'],
        readout: 'log',
        readoutPortrait: 'caches',
        code: {
          title: 'shop.example zone file',
          lang: 'conf',
          code: `
; send the asset hostname to the CDN
!cdn.shop.example.   300  IN  CNAME  shop.example.cdn.example.net.`,
          note: 'A CNAME record hands the name over to the CDN. Its DNS decides which servers answer.',
        },
        legend: [L.req, L.res],
      },
      {
        id: 'flip-the-switch',
        title: 'Flip the switch',
        cfg: { rps: 1.8, cdn: false },
        body: (
          <>
            <p>
              <strong>Your turn.</strong> Switch the CDN off and on, and watch the board fill in city by city.
            </p>
            <p>
              The farther a city is from Virginia, the bigger the win. Sydney drops from about 212 ms to 8 ms, over 25 times faster. London gains
              less, because it was only 85 ms away to begin with.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Where do requests go?',
            initial: 0,
            options: [
              { label: 'CDN off', apply: (s) => s.setCdn(false), note: <>Every request crosses the world to Virginia and back.</> },
              { label: 'CDN on', apply: (s) => s.setCdn(true), note: <>Cached files come from the nearest edge. Virginia rests.</> },
            ],
          },
        ],
        hud: ['avg', 'hit'],
        readout: 'board',
        legend: [L.req, L.res],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'hits',
    title: 'Hits and misses',
    cfg: { cdn: true },
    steps: [
      {
        id: 'first-request-misses',
        title: 'The first request is a miss',
        cfg: { mode: 'tour', rps: 0, warm: 'cold', tags: false, chips: ['app'], people: { city: 'sydney', names: ['Alice', 'Bob'] } },
        onEnter: (s) => s.startTour(),
        focus: ['person:0', 'person:1', 'pop:SYD', 'origin'],
        body: (
          <>
            <p>Let&apos;s follow one file. The Sydney edge has just come online, and its cache is empty.</p>
            <p>
              <Term k="person:0">Alice</Term> asks for <code>app.3f9a.js</code>. The edge looks in its cache and finds nothing: a{' '}
              <strong>cache miss</strong>. So it fetches the file from Virginia itself, <strong>stores a copy</strong>, and passes it on. Alice waits
              the full trip: 213 ms.
            </p>
            <p>
              Then <Term k="person:1">Bob</Term>, also in Sydney, asks for the same file. This time it&apos;s a <strong>cache hit</strong>: the edge
              answers from its own storage in 8 ms, and Virginia never hears about it.
            </p>
          </>
        ),
        readout: 'tour',
        code: {
          title: 'terminal · Bob, in Sydney',
          lang: 'shell',
          code: `
$ curl -sI https://cdn.shop.example/app.3f9a.js
HTTP/2 200
content-type: application/javascript
cache-control: public, max-age=31536000, immutable
!age: 6
!x-cache: HIT`,
          note: 'age is how many seconds the copy has sat in a cache. The hit header’s name varies: x-cache on CloudFront and Fastly, cf-cache-status on Cloudflare.',
        },
        legend: [L.req, L.fill, L.res],
      },
      {
        id: 'hit-or-miss',
        title: 'Hit or miss?',
        cfg: {
          mode: 'hitmiss',
          rps: 0.42,
          mix: { app: 1, logo: 1 },
          labels: true,
          say: true,
          warm: { SYD: ['app', 'logo'], LHR: ['app'], GRU: ['app', 'logo'], BOM: ['logo'] },
          chips: ['app', 'logo'],
        },
        predict: { rounds: 3, prompt: 'Does that edge already have the file? Check its cache.' },
        body: (
          <>
            <p>
              Every PoP keeps <strong>its own cache</strong>, shown beside it: <code>js</code> for <code>app.3f9a.js</code>, <code>png</code> for{' '}
              <code>logo.png</code>. Green means a copy is there; a dashed box means it isn&apos;t.
            </p>
            <p>
              When a request reaches an edge, the animation pauses. <strong>Predict: hit or miss?</strong>
            </p>
            <Aside>Watch what a miss leaves behind: once the file comes back from Virginia, that PoP has it too.</Aside>
          </>
        ),
        readout: 'log',
        readoutPortrait: 'caches',
        hud: ['hit'],
        legend: [L.req, L.fill, L.res],
      },
      {
        id: 'hit-ratio',
        title: 'Hit ratio: the number to watch',
        cfg: { warm: 'cold', rps: 3.2, poisson: true, mix: { app: 3, logo: 2, style: 1 }, chips: ['app', 'logo', 'style'] },
        body: (
          <>
            <p>Here&apos;s a brand-new CDN with every cache empty. At first nearly everything misses, and Virginia sees every request.</p>
            <p>
              As copies spread, the <strong>hit ratio</strong> climbs: the share of requests answered straight from an edge. It&apos;s the single most
              important CDN number. At 95%, 19 of every 20 requests take the fast path, and your origin handles only the 20th.
            </p>
            <p>Few sites reach 100%. New files, expired copies and PoPs that have never seen a file all cost misses.</p>
            <Aside>
              Big catalogs with millions of rarely viewed files (the &ldquo;long tail&rdquo;) have lower hit ratios: each PoP rarely sees the same
              file twice.
            </Aside>
          </>
        ),
        hud: ['hit', 'origin', 'avg'],
        readout: 'ratio',
        code: {
          title: 'nginx.conf · edge server',
          lang: 'nginx',
          code: `
!proxy_cache_path /var/cache/edge keys_zone=edge:50m max_size=10g inactive=7d;

server {
    listen 443 ssl;
    server_name cdn.shop.example;
    ssl_certificate     /etc/ssl/cdn.shop.example.crt;
    ssl_certificate_key /etc/ssl/cdn.shop.example.key;

    location / {
        proxy_pass https://origin.shop.example;
!        proxy_cache edge;
!        proxy_cache_valid 200 10m;   # when the origin doesn't say
        proxy_cache_revalidate on;          # revalidate stale copies
        proxy_cache_background_update on;   # for stale-while-revalidate
!        add_header X-Cache $upstream_cache_status;   # HIT, MISS, EXPIRED…
    }
}`,
          note: 'This is what an edge server does, in nginx: keep responses on disk and reuse them. A CDN runs this idea in hundreds of cities.',
        },
        legend: [L.req, L.fill, L.res],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'routing',
    title: 'Finding the edge',
    cfg: { cdn: true, warm: 'all', warmFiles: ['app', 'logo'], mix: { app: 1, logo: 1 } },
    steps: [
      {
        id: 'anycast',
        title: 'One address, announced everywhere',
        cfg: { mode: 'anycast', rps: 0, tags: false, cities: [] },
        predict: { rounds: 3, prompt: 'Which PoP will this visitor reach? Click it on the map, or pick below.' },
        body: (
          <>
            <p>
              How does Alice&apos;s browser in Sydney find the Sydney edge, and not the one in London? Many CDNs, Cloudflare and Fastly among them,
              use <strong>anycast</strong>.
            </p>
            <p>
              Every PoP announces the <em>same</em> block of IP addresses, <code>198.51.100.0/24</code>, to the internet&apos;s routers using{' '}
              <strong>BGP</strong>, the protocol networks use to share routes. So <code>cdn.shop.example</code> has one address,{' '}
              <code>198.51.100.7</code>, that exists in every PoP at once. Routers forward packets along the best route they know, and they land at the
              nearest PoP. Nobody has to choose anything.
            </p>
            <p>
              Visitors are arriving from cities without a PoP of their own. <strong>Predict where each one lands.</strong>
            </p>
            <Aside>
              &ldquo;Nearest&rdquo; means nearest in network terms: the best route, not a ruler. It usually matches geography, but not always. This sim
              uses straight-line distance.
            </Aside>
          </>
        ),
        readout: 'anycast',
        code: {
          title: 'terminal · anywhere',
          lang: 'shell',
          code: `
$ dig +short cdn.shop.example
shop.example.cdn.example.net.
!198.51.100.7`,
          note: 'The same answer in Sydney, São Paulo and Seoul. Routing does the rest.',
        },
        legend: [L.req, L.res],
      },
      {
        id: 'pop-goes-dark',
        title: 'When a PoP goes dark',
        cfg: { rps: 1.5 },
        body: (
          <>
            <p>
              Anycast gives you failover for free. When a PoP breaks, or is taken down for maintenance, it stops announcing the address. Within seconds,
              routers send its users to the next-nearest PoP.
            </p>
            <p>
              <strong>Try it:</strong> take <Term k="pop:LHR">LHR</Term> offline. London&apos;s requests reroute to Lagos: slower, about 73 ms, but
              still working. Take down more and watch the survivors pick up the load.
            </p>
            <p>
              Others, like Akamai and CloudFront, route with DNS instead (often called <strong>GeoDNS</strong>): the CDN&apos;s DNS server looks at
              where a lookup comes from and answers with the address of a nearby PoP. It allows finer control, but failover has to wait for cached DNS
              answers to expire.
            </p>
          </>
        ),
        interactions: [{ kind: 'pops', prompt: 'Click a PoP on the map, or here, to take it offline.' }],
        callouts: [{ target: 'pop:LHR', text: <>click to take it <b>offline</b></>, dir: 'up' }],
        calloutsPortrait: [],
        hud: ['avg'],
        readout: 'board',
        code: {
          title: 'terminal · GeoDNS instead',
          lang: 'shell',
          code: `
$ dig +short cdn.shop.example        # asked from Sydney
shop.example.cdn.example.net.
!203.0.113.21
$ dig +short cdn.shop.example        # asked from London
shop.example.cdn.example.net.
!203.0.113.45`,
          note: 'With GeoDNS, each place gets a different address. With anycast, everyone gets the same one.',
        },
        legend: [L.req, L.res, L.reroute],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'headers',
    title: 'Cache-Control',
    cfg: { cdn: true, warm: 'cold', cities: ['london'], say: true, tags: false },
    steps: [
      {
        id: 'cache-control',
        title: 'The origin’s headers decide',
        cfg: { rps: 0.8, cycle: true, mix: { app: 1, logo: 1, html: 1, account: 1 }, policy: { logo: { kind: 'public', maxAge: 20 } }, labels: true },
        focus: ['user:london', 'pop:LHR', 'origin'],
        body: (
          <>
            <p>
              So far every file has been cacheable. In reality, <strong>you</strong> tell the CDN what it may keep, with a{' '}
              <code>Cache-Control</code> header on every response from your origin. The table shows what the{' '}
              <Term k="pop:LHR">London edge</Term> does with four files.
            </p>
            <p>
              <code>public, max-age=31536000</code>: any cache may keep it, fresh for a year. <code>max-age=20</code>: fresh for 20 seconds, then it
              must be checked. <code>no-cache</code>: store it, but <em>ask the origin before every use</em> (it doesn&apos;t mean &ldquo;don&apos;t
              cache&rdquo;). <code>private</code>: only the user&apos;s own browser may keep it, so the edge passes it straight through.
            </p>
            <Aside>
              Also common: <code>s-maxage</code>, a max-age just for shared caches like CDNs (browsers ignore it), and <code>no-store</code>: nobody keeps
              a copy, anywhere. Caches differ in the details, too: nginx won&apos;t store a <code>no-cache</code> response at all, so each request goes to
              the origin in full.
            </Aside>
          </>
        ),
        readout: 'table',
        code: {
          title: 'origin response headers',
          lang: 'http',
          code: `
# /app.3f9a.js
!Cache-Control: public, max-age=31536000, immutable
# /logo.png
!Cache-Control: public, max-age=20
# /index.html
!Cache-Control: no-cache
# /account
!Cache-Control: private`,
        },
        legend: [L.req, L.fill, L.reval, L.res],
      },
      {
        id: 'fresh-then-stale',
        title: 'Fresh, then stale',
        cfg: { rps: 0.75, mix: { logo: 1 }, policy: { logo: { kind: 'public', maxAge: 8 } }, chips: ['logo'] },
        focus: ['user:london', 'pop:LHR', 'origin'],
        body: (
          <>
            <p>
              A cached copy is <strong>fresh</strong> until its age passes <code>max-age</code>. After that it&apos;s <strong>stale</strong>, and the
              edge won&apos;t serve it blindly.
            </p>
            <p>
              Instead it asks the origin: &ldquo;I have the version tagged <code>&quot;a1b2&quot;</code>. Has it changed?&rdquo; That&apos;s a{' '}
              <strong>conditional request</strong>. If nothing changed, the origin answers <code>304 Not Modified</code> with no body, and the copy is
              fresh again (the violet dots).
            </p>
            <p>
              <strong>Drag the slider.</strong> A longer max-age means more hits and fewer trips to Virginia, but a new logo takes longer to reach
              everyone. A shorter one keeps things current, at the cost of more origin traffic.
            </p>
            <Aside>
              Time is compressed: these max-ages are simulated seconds. Real ones run from seconds (news pages) to a year (fingerprinted files). A real
              edge also keeps the old max-age until it next fetches the file; the sim applies your change at once.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'slider',
            prompt: 'How long should London keep /logo.png?',
            sliders: [
              {
                label: 'max-age',
                min: 2,
                max: 40,
                step: 1,
                initial: 8,
                format: (v) => `${v} s`,
                ends: ['always checking', 'rarely checking'],
                onChange: (s, v) => s.setMaxAge('logo', v),
              },
            ],
          },
        ],
        hud: ['hit', 'fetches'],
        readout: 'entry',
        code: {
          title: 'the revalidation, on the wire',
          lang: 'http',
          code: `
# edge → origin, once its copy is stale
GET /logo.png HTTP/1.1
Host: cdn.shop.example
!If-None-Match: "a1b2"

# origin → edge: unchanged, keep your copy
!HTTP/1.1 304 Not Modified
ETag: "a1b2"
Cache-Control: public, max-age=8`,
        },
        legend: [L.req, L.fill, L.reval, L.res],
      },
      {
        id: 'stale-while-revalidate',
        title: 'Don’t make anyone wait',
        cfg: { rps: 0.8, mix: { logo: 1 }, policy: { logo: { kind: 'public', maxAge: 5 } }, chips: ['logo'] },
        focus: ['user:london', 'pop:LHR', 'origin'],
        body: (
          <>
            <p>
              Revalidation has a hidden cost. Whoever arrives just after the copy goes stale waits for the check with Virginia: 86 ms instead of 8.
              With a short max-age, that happens often.
            </p>
            <p>
              <code>stale-while-revalidate=30</code> says: for 30 seconds after going stale, the edge may <strong>serve the old copy anyway</strong>{' '}
              while it fetches a fresh one in the background. The user gets the fast answer, and the next user gets the refreshed copy.
            </p>
            <p>
              <strong>Switch it on</strong> and watch the latency column in the log.
            </p>
            <Aside>The stale copy is at most seconds old. Fine for a logo or a product list; maybe not for a live auction price.</Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Cache-Control on /logo.png:',
            initial: 0,
            options: [
              { label: 'max-age=5', apply: setLogo(5, 0), note: <>A stale copy means a check with Virginia first. That user waits about 86 ms.</> },
              {
                label: '+ stale-while-revalidate=30',
                apply: setLogo(5, 30),
                note: <>Stale copies go out at once (STALE, 8 ms) while the edge refreshes in the background.</>,
              },
            ],
          },
        ],
        hud: ['avg'],
        readout: 'log',
        code: {
          title: 'origin response headers',
          lang: 'http',
          code: `
# /logo.png
!Cache-Control: public, max-age=5, stale-while-revalidate=30`,
        },
        legend: [L.req, L.reval, L.res],
      },
      {
        id: 'cache-keys',
        title: 'What counts as the same file?',
        cfg: { rps: 1.3, mix: { logo: 1 }, utm: true, policy: { logo: { kind: 'public', maxAge: DAY } } },
        focus: ['user:london', 'pop:LHR', 'origin'],
        body: (
          <>
            <p>
              An edge finds copies by their <strong>cache key</strong>: usually the whole URL, query string included. That&apos;s normally right:{' '}
              <code>/search?q=boots</code> and <code>/search?q=hats</code> are different pages.
            </p>
            <p>
              But marketing links tack tracking tags onto the same image: <code>/logo.png?utm_source=mail&amp;utm_id=412</code>. Every variation is a
              new key, so every one misses, and the cache fills with duplicates. <strong>Tell the edge to ignore the query string</strong> for images
              and watch the hit ratio recover.
            </p>
            <Aside>
              The <code>Vary</code> header adds request headers to the key. <code>Vary: Accept-Encoding</code> (one copy per compression) is fine.{' '}
              <code>Vary: User-Agent</code> or <code>Vary: Cookie</code> can split one file into thousands of copies.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'LHR’s cache key for /logo.png:',
            initial: 0,
            options: [
              { label: 'Full URL', apply: (s) => s.setIgnoreQuery(false), note: <>Each tracking tag makes a new key. Miss after miss.</> },
              { label: 'Ignore the query string', apply: (s) => s.setIgnoreQuery(true), note: <>All variants share one key: /logo.png. Hits again.</> },
            ],
          },
        ],
        hud: ['hit'],
        readout: 'keys',
        code: {
          title: 'nginx.conf · edge',
          lang: 'nginx',
          code: `
# default key: $scheme$proxy_host$request_uri (query string included)
location ~* \\.(png|jpg|css|js)$ {
    proxy_pass https://origin.shop.example;
    proxy_cache edge;
!    proxy_cache_key $scheme$proxy_host$uri;   # path only
}`,
        },
        legend: [L.req, L.fill, L.res],
      },
      {
        id: 'private-pages',
        title: 'Never share an account page',
        cfg: { mode: 'account', rps: 0.75, people: { city: 'london', names: ['Carol', 'Dave'] }, policy: { account: { kind: 'private' } } },
        focus: ['person:0', 'person:1', 'pop:LHR', 'origin'],
        body: (
          <>
            <p>
              <Term k="person:0">Carol</Term> and <Term k="person:1">Dave</Term> both open <code>/account</code>. Same URL, but each should see their
              own orders and address. The origin marks it <code>private</code>, so the edge passes every request through (BYPASS) and stores nothing.
            </p>
            <p>
              <strong>Break it:</strong> switch the header to <code>public, max-age=60</code>. The edge keeps the first account page it sees and hands
              it to <em>everyone</em> who asks for that URL. Now Carol and Dave see each other&apos;s orders.
            </p>
            <Aside>
              This happens for real. On Christmas Day 2015, a caching change at Steam served pages generated for one user to others; Valve said the
              personal details of about 34,000 users may have been exposed.
            </Aside>
            <p>
              Personal pages can still use the CDN: cache the shared parts and fetch the personal bits separately, or build the page with code that runs
              on the edge itself (<strong>edge compute</strong>, like Cloudflare Workers or Lambda@Edge).
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Cache-Control on /account:',
            initial: 0,
            options: [
              { label: 'private', apply: (s) => s.setPolicy('account', { kind: 'private' }), note: <>Every request goes to the origin. Each person gets their own page.</> },
              {
                label: 'public, max-age=60',
                apply: (s) => s.setPolicy('account', { kind: 'public', maxAge: 60 }),
                note: <>The edge caches whichever page it saw first and serves it to both. Watch the red.</>,
              },
            ],
          },
        ],
        hud: ['leaks'],
        readout: 'log',
        code: {
          title: 'origin response headers',
          lang: 'http',
          code: `
# /account: different for every user
!Cache-Control: private, no-store`,
          note: 'private keeps shared caches out. no-store also keeps the browser from saving a copy: right for sensitive pages.',
        },
        legend: [L.req, L.carol, L.dave],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'deploys',
    title: 'Shipping updates',
    cfg: { cdn: true, warm: 'all' },
    steps: [
      {
        id: 'deploy-and-purge',
        title: 'You deployed. Nobody noticed.',
        cfg: { warmFiles: ['style'], rps: 1.6, mix: { style: 1 }, chips: ['style'], versions: true, policy: { style: { kind: 'public', maxAge: DAY } } },
        body: (
          <>
            <p>
              You fix a bug in <code>/style.css</code> and deploy version 2 to the origin. The old version is cached everywhere with{' '}
              <code>max-age=86400</code>: a whole day.
            </p>
            <p>
              <strong>Deploy it</strong> and watch: every edge keeps serving version 1 (yellow). As far as the edges know, their copies are fresh for
              hours yet. And since each copy expires at its own time, different cities would switch over at different times.
            </p>
            <p>
              The fix is a <strong>purge</strong> (or <em>invalidation</em>): an API call that tells every edge to drop its copy. <strong>Purge
              it</strong>, and the next requests miss and fetch version 2.
            </p>
            <Aside>
              Depending on the CDN, a purge takes from under a second to several minutes. Afterwards every PoP misses at once, so the origin gets a burst
              of traffic.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            prompt: 'Ship the fix:',
            buttons: [
              {
                label: 'Deploy v2 to the origin',
                icon: 'arrowRight',
                run: (s) => s.deploy('style'),
                after: <>The origin has v2, but every edge still answers with its cached v1.</>,
              },
              {
                label: 'Purge /style.css',
                icon: 'replay',
                run: (s) => s.purge('style'),
                after: <>Every edge drops its copy. The next request at each PoP misses and fetches the current version.</>,
              },
            ],
          },
        ],
        hud: ['fetches'],
        readout: 'versions',
        code: {
          title: 'terminal · your deploy script',
          lang: 'shell',
          code: `
$ curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \\
    -H "Authorization: Bearer $API_TOKEN" \\
    -H "Content-Type: application/json" \\
!    --data '{"files": ["https://cdn.shop.example/style.css"]}'`,
          note: 'Every CDN has a purge API. Most can purge by URL, by prefix, by tag, or everything.',
        },
        legend: [L.req, L.res, L.old, L.purge, L.fill],
      },
      {
        id: 'fingerprinting',
        title: 'Better: a new name for every version',
        cfg: { mode: 'pageviews', warmFiles: ['html', 'app'], rps: 0.8, chips: ['html', 'app'] },
        body: (
          <>
            <p>
              Most sites avoid purging assets with <strong>fingerprinted filenames</strong>. The build puts a hash of each file&apos;s contents in its
              name: <code>app.3f9a.js</code>. Change one byte, and the next build is <code>app.8c1e.js</code>.
            </p>
            <p>
              A URL&apos;s content then never changes, so it can be cached for a year: <code>max-age=31536000, immutable</code>. Only the small HTML page
              is <code>no-cache</code>, so edges check it with the origin on every visit (violet) and learn new names at once.
            </p>
            <p>
              <strong>Deploy a new build.</strong> The HTML now points at the new file. Each PoP misses on it once, then serves it. The old file sits
              unused until the cache evicts it. No purge, no mixed versions.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              {
                label: 'Deploy a new build',
                icon: 'arrowRight',
                run: (s) => s.deploy('html'),
                after: <>New HTML, new file name. Each edge fetches the new file once, on the first visit after the deploy.</>,
              },
            ],
          },
        ],
        quiz: {
          question: 'Why does index.html get no-cache, instead of a long max-age like the JavaScript?',
          options: [
            { text: 'HTML files are too big to cache', why: 'Size isn’t the issue; the HTML is tiny compared to the scripts it loads.' },
            {
              text: 'It’s the only file that knows the new names',
              correct: true,
              why: 'Exactly. The HTML is the entry point that references app.8c1e.js. If it were cached for a year, nobody would ever find the new build.',
            },
            { text: 'CDNs can’t cache HTML', why: 'They can. The question is how long it may be reused without checking.' },
          ],
        },
        hud: ['fetches'],
        readout: 'builds',
        code: {
          title: 'nginx.conf · origin',
          lang: 'nginx',
          code: `
# name.hash.js never changes: cache it for a year
location ~ "\\.[0-9a-f]{4,}\\.(js|css)$" {
!    add_header Cache-Control "public, max-age=31536000, immutable";
}

# the HTML points at the current names: always check
location / {
!    add_header Cache-Control "no-cache";
}`,
        },
        legend: [L.req, L.reval, L.fill, L.res],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'origin',
    title: 'Protecting the origin',
    cfg: { cdn: true, warm: 'all', warmFiles: ['app', 'logo'], mix: { app: 1, logo: 1 } },
    steps: [
      {
        id: 'origin-shield',
        title: 'An origin shield',
        cfg: { rps: 0.5, chips: ['app', 'logo', 'sale'] },
        body: (
          <>
            <p>
              Every PoP fills its cache on its own. Publish a new image and each PoP misses once, so your origin gets one request per PoP. Six here;
              with a real CDN&apos;s hundreds of PoPs, hundreds of requests for one file, all at once.
            </p>
            <p>
              An <Term k="shield">origin shield</Term> adds one caching layer: a PoP right next to your origin. Edges send their misses to the shield,
              and only the shield talks to Virginia. It also <strong>collapses</strong> identical requests that arrive together into one fetch.
            </p>
            <p>
              <strong>Publish the sale banner</strong> with the shield off, then on, and compare the origin requests.
            </p>
            <Aside>
              Names vary: tiered cache (Cloudflare), regional edge cache and Origin Shield (CloudFront), shielding (Fastly). A miss costs one extra hop,
              which is small because the shield sits next to the origin.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Origin shield:',
            initial: 0,
            options: [
              { label: 'Off', apply: (s) => s.setShield(false) },
              { label: 'On', apply: (s) => s.setShield(true) },
            ],
          },
          {
            kind: 'actions',
            buttons: [
              {
                label: 'Publish a sale banner',
                icon: 'bolt',
                run: (s) => s.burst(),
                after: <>Everyone asks for the new file at once. Count the requests that reach Virginia.</>,
              },
            ],
          },
        ],
        callouts: [{ target: 'shield', text: <>the <b>shield</b>: a cache for the caches</>, dir: 'up' }],
        calloutsPortrait: [],
        hud: ['fetches'],
        readout: 'shield',
        code: {
          title: 'main.tf · CloudFront',
          lang: 'conf',
          code: `
resource "aws_cloudfront_distribution" "shop" {
  origin {
    domain_name = "origin.shop.example"
    origin_id   = "shop-origin"
!    origin_shield {
!      enabled              = true
!      origin_shield_region = "us-east-1"   # next to the origin
!    }
  }
  # … cache behaviors, certificate …
}`,
        },
        legend: [L.req, L.fill, L.res],
      },
      {
        id: 'flash-crowd',
        title: 'Flash crowds and attacks',
        cfg: { cdn: false, rps: 1.5, poisson: true, originCap: 6 },
        showLoad: true,
        body: (
          <>
            <p>Your origin can handle about 6 requests per second. A normal day brings 1.5. Then the flash sale starts, and traffic jumps twelvefold.</p>
            <p>
              <strong>Start the sale with the CDN off:</strong> requests pile up at the origin, response times balloon, and soon it turns people away
              (red). <strong>Now switch the CDN on:</strong> the edges answer almost everything from cache, and Virginia barely notices.
            </p>
            <p>
              Attacks work the same way. A <strong>DDoS</strong> floods you with junk requests; anycast spreads the flood across hundreds of PoPs, and
              each one filters its share. Lock your origin down so it only accepts traffic from the CDN, or attackers will simply go around it.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'CDN:',
            initial: 0,
            options: [
              { label: 'Off', apply: (s) => s.setCdn(false) },
              { label: 'On', apply: (s) => s.setCdn(true) },
            ],
          },
          {
            kind: 'actions',
            buttons: [
              { label: 'Start the flash sale', icon: 'bolt', run: (s) => s.setRps(18), after: <>18 requests per second, three times what the origin can do.</> },
              { label: 'Back to normal', icon: 'replay', run: (s) => s.setRps(1.5) },
            ],
          },
        ],
        callouts: [{ target: 'origin', text: <>handles <b>6 requests/s</b>, tops</>, dir: 'up' }],
        calloutsPortrait: [],
        hud: ['origin', 'errors', 'avg'],
        readout: 'origin',
        code: {
          title: 'nginx.conf · origin',
          lang: 'nginx',
          code: `
# only the CDN may talk to the origin
location / {
!    allow 198.51.100.0/24;   # the CDN's published address ranges
!    deny  all;
    proxy_pass http://app;
}`,
        },
        legend: [L.req, L.res, L.err],
      },
      {
        id: 'even-uncacheable',
        title: 'Faster, even when it can’t cache',
        cfg: { view: 'sequence', seq: 'dynamic', mode: 'idle', rps: 0 },
        body: (
          <>
            <p>
              Some responses can never be cached: <code>/account</code>, a checkout, an API call. A CDN still speeds them up.
            </p>
            <p>
              The browser does its TCP and TLS handshakes with the <strong>nearby edge</strong> (called <strong>TLS termination</strong>), so they cost 8
              ms each instead of 212. The edge keeps <strong>warm connections</strong> open to your origin, so the request itself crosses the ocean just
              once.
            </p>
            <p>
              Result: 270 ms instead of 677, for a page nobody cached. That&apos;s why many sites put their whole domain behind the CDN, not just the
              static files. And because edges serve most of the bytes, the origin&apos;s bandwidth bill shrinks roughly in line with the hit ratio.
            </p>
          </>
        ),
        code: {
          title: 'terminal · in Sydney',
          lang: 'shell',
          code: `
# the same uncacheable page, direct vs. through the CDN
$ curl -so /dev/null -w '%{time_starttransfer}\\n' https://origin.shop.example/account
0.677412
$ curl -so /dev/null -w '%{time_starttransfer}\\n' https://shop.example/account
!0.270118`,
        },
        legend: [L.req, L.res, L.handshake],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    cfg: { cdn: true, warm: 'all', warmFiles: ['app', 'logo', 'html'] },
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { shield: true, rps: 2.4, poisson: true, mix: { app: 3, logo: 2, html: 1 }, chips: ['app', 'logo', 'html'] },
        body: (
          <p>
            Everything in one picture: edges near every user, a shield in front of the origin, and headers that decide what gets kept and for how long.
          </p>
        ),
        extra: <CheatSheet />,
        readout: 'ratio',
        hud: ['avg', 'hit', 'origin'],
        legend: [L.req, L.fill, L.reval, L.res],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: {
          warm: 'cold',
          rps: 2,
          poisson: true,
          mix: { app: 2, logo: 2, style: 1 },
          chips: ['app', 'logo', 'style'],
          policy: { logo: { kind: 'public', maxAge: 15 } },
          originCap: 6,
        },
        body: (
          <p>
            Every knob in one place. Change the traffic, the logo&apos;s max-age and the CDN&apos;s layers, and click PoPs on the map to take them
            offline. Then try the challenges.
          </p>
        ),
        interactions: [{ kind: 'playground' }],
        readout: 'board',
        hud: ['avg', 'hit', 'origin'],
        legend: [L.req, L.fill, L.reval, L.res, L.err],
      },
    ],
  },
];
