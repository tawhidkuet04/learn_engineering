import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { CLIENTS } from './engine/constants';
import type { ServerSpec } from './engine/types';
import { CheatSheet } from './panel/CheatSheet';
import type { Chapter } from './types';

const THREE: ServerSpec[] = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
const FOUR: ServerSpec[] = [...THREE, { id: 's4' }];

const HEAVY = <strong style={{ color: 'var(--sig-heavy)' }}>orange</strong>;

export const LESSON = {
  slug: 'load-balancing',
  code: 'SD-01',
  track: 'System design',
  title: 'Load Balancing',
};

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'one-server',
    title: 'One server, too many users',
    config: { lb: 'none', servers: [{ id: 's1' }], showZones: false, showBrain: false },
    steps: [
      {
        id: 'meet-the-server',
        title: 'Meet your server',
        reset: true,
        config: { rps: 0.9 },
        body: (
          <>
            <p>
              This is a web server, drawn the way an engineer would sketch it. On the left are three of your <Term k="clients">users</Term>. Every glowing
              dot they send is an <strong>HTTP request</strong>: loading a page, adding boots to a cart, logging in.
            </p>
            <p>
              The server works on requests in <strong>worker slots</strong>, the bars inside <Term k="server:s1">web-1</Term>. This one has two, so it can
              handle two requests at the same time. When a bar fills up, the work is done and a green <strong>response</strong> flies back.
            </p>
            <p>Right now traffic is gentle, and the server is barely breaking a sweat.</p>
          </>
        ),
        callouts: [{ target: 'units:s1', text: <>2 worker slots: <b>2 requests at once</b></>, dir: 'down' }],
        hud: ['throughput', 'latency'],
        legend: ['req', 'res'],
      },
      {
        id: 'goes-viral',
        title: 'Your app goes viral',
        config: { rps: 0.9 },
        script: [{ at: 0.3, run: (w) => w.rampRps(3, 6) }],
        body: (
          <>
            <p>Someone posts your shop on social media and traffic triples.</p>
            <p>
              Both slots are busy now, so new requests wait in the <strong>queue</strong>, the line of dots forming in front of the server. Watch the{' '}
              <strong>p95 latency</strong> climb. Every request stuck in line makes the one behind it wait even longer.
            </p>
            <Aside>p95 latency: 95% of requests finish faster than this number. It tracks what your unluckiest users feel.</Aside>
          </>
        ),
        callouts: [{ target: 'queue:s1', text: <>the <b>queue</b>: requests waiting their turn</>, dir: 'up' }],
        hud: ['throughput', 'latency'],
        legend: ['req', 'res'],
      },
      {
        id: 'breaking-point',
        title: 'Find the breaking point',
        reset: true,
        config: { rps: 1.5 },
        body: (
          <>
            <p>Your turn. Drag the traffic slider up and watch what happens.</p>
            <p>
              Each slot needs a moment per request, so this server can finish only about <strong>2.2 requests per second</strong>. Send more than that and
              the queue grows and grows. Real servers can&apos;t queue forever, so this one has room for 10 waiting requests. Past that, new arrivals are
              turned away with <code>503 Service Unavailable</code>.
            </p>
            <p>Every red dot is a real person staring at an error page.</p>
          </>
        ),
        interaction: {
          kind: 'slider',
          label: 'Traffic',
          min: 0.5,
          max: 6,
          step: 0.25,
          goalDrops: 3,
          done: (
            <>
              <strong>That&apos;s the breaking point.</strong> Past about 2.2 req/s the queue fills and the server starts refusing work. No amount of
              waiting fixes this. You need more capacity.
            </>
          ),
        },
        hud: ['throughput', 'latency', 'drops'],
        legend: ['req', 'res', 'err'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'scaling',
    title: 'Scale up, or scale out?',
    config: { lb: 'none', showZones: false, showBrain: false },
    steps: [
      {
        id: 'scale-up',
        title: 'Scale up: buy a bigger machine',
        config: { servers: [{ id: 's1', size: 'l' }], rps: 4 },
        body: (
          <>
            <p>
              The quick fix is <strong>vertical scaling</strong>: move to a machine with more CPU cores and memory. More cores, more worker slots.{' '}
              <Term k="server:s1">web-1</Term> now has 8 slots and shrugs off 4 requests per second.
            </p>
            <p>
              It works, up to a point. Big machines get expensive fast, there&apos;s always a largest one you can buy, and it&apos;s still <em>one</em>{' '}
              machine.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          prompt: 'What happens when that one machine goes down?',
          buttons: [
            {
              label: 'Pull the plug on web-1',
              icon: 'power',
              run: (w) => w.crashServer('s1'),
              after: (
                <>
                  Everything is down. With one server, a single crash, kernel update or bad deploy takes <strong>100% of your users</strong> offline.
                  That&apos;s a <strong>single point of failure</strong>.
                </>
              ),
            },
            { label: 'Reboot it', icon: 'replay', run: (w) => w.reviveServer('s1') },
          ],
        },
        hud: ['throughput', 'latency', 'errors'],
        legend: ['req', 'res', 'err'],
      },
      {
        id: 'scale-out',
        title: 'Scale out: add more servers',
        config: { servers: THREE, directTo: 's1', rps: 4 },
        body: (
          <>
            <p>
              <strong>Horizontal scaling</strong> means adding more ordinary machines instead of one giant one. It&apos;s cheaper, and if one dies the
              others keep going.
            </p>
            <p>
              But there&apos;s a catch. Your users&apos; browsers look up <code>shop.example</code> in DNS and get exactly one address: web-1&apos;s. So
              all the traffic still hammers <Term k="server:s1">web-1</Term> while <Term k="server:s2">web-2</Term> and <Term k="server:s3">web-3</Term>{' '}
              sit idle. Nobody knows they exist.
            </p>
          </>
        ),
        callouts: [{ target: 'server:s3', text: <>idle: <b>no one knows its address</b></>, dir: 'down' }],
        hud: ['throughput', 'latency', 'drops'],
        legend: ['req', 'res', 'err'],
      },
      {
        id: 'enter-the-load-balancer',
        title: 'Enter the load balancer',
        config: { servers: THREE, lb: 'single', algorithm: 'rr', rps: 4, showZones: true },
        body: (
          <>
            <p>
              A <Term k="lb">load balancer</Term> sits in front of your servers and becomes the <strong>only address anyone talks to</strong>. DNS now
              points <code>shop.example</code> at its public IP, <code>203.0.113.10</code>.
            </p>
            <p>
              For every request it picks a server, forwards the request, and relays the response back. The three servers share the work, and nobody gets
              turned away.
            </p>
            <p>
              See the dashed line? Users on the <strong>public internet</strong> can only reach the load balancer. The servers live on a{' '}
              <strong>private network</strong> behind it, so you can add, remove or replace them without anyone noticing.
            </p>
          </>
        ),
        callouts: [{ target: 'lb', text: <>the one public address: <b>203.0.113.10</b></>, dir: 'up' }],
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
!upstream backend {
!    server 10.0.1.11:8080;   # web-1
!    server 10.0.1.12:8080;   # web-2
!    server 10.0.1.13:8080;   # web-3
!}

server {
    listen 443 ssl;
    server_name shop.example;

    location / {
!        proxy_pass http://backend;
    }
}`,
          note: 'This is the whole idea in NGINX: an upstream group of servers, and a proxy_pass that sends traffic to it.',
        },
        hud: ['throughput', 'latency', 'drops'],
        legend: ['req', 'res'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'follow',
    title: 'Follow one request',
    config: { lb: 'single', servers: THREE, rps: 0, showBrain: false, showZones: true },
    steps: [
      {
        id: 'alice-sends-a-request',
        title: 'Alice sends a request',
        reset: true,
        onEnter: (w) => w.startTour('client'),
        focus: ['client:alice', 'lb'],
        body: (
          <>
            <p>Let&apos;s slow down and follow a single request from start to finish.</p>
            <p>
              <Term k="client:alice">Alice</Term> opens her cart. Her browser sends <code>GET /cart</code> to <code>shop.example</code>, which DNS
              resolved to the load balancer&apos;s address. As far as her browser can tell, the load balancer <em>is</em> the website.
            </p>
            <p>The card shows what&apos;s inside: the HTTP request itself, and the network addresses it travels between.</p>
          </>
        ),
      },
      {
        id: 'the-load-balancer-forwards-it',
        title: 'The load balancer forwards it',
        reset: true,
        onEnter: (w) => w.startTour('lb'),
        script: [{ at: 1.1, run: (w) => w.releaseTour() }],
        focus: ['lb', 'server:s2'],
        body: (
          <>
            <p>
              The load balancer picks a healthy server, <Term k="server:s2">web-2</Term> this time, and forwards the request over the private network.
            </p>
            <p>
              It opens <strong>its own connection</strong> to web-2, so the addresses change (yellow). It also adds an <code>X-Forwarded-For</code>{' '}
              header (green) so web-2 still knows who the real visitor is. That matters for logs, rate limits and fraud checks.
            </p>
          </>
        ),
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
location / {
    proxy_pass http://backend;
    proxy_set_header Host $host;
!    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}`,
        },
      },
      {
        id: 'the-response-retraces-its-path',
        title: 'The response retraces its path',
        reset: true,
        onEnter: (w) => w.startTour('server'),
        focus: ['client:alice', 'lb', 'server:s2'],
        body: (
          <>
            <p>web-2 loads Alice&apos;s cart, renders the page, and sends the response back to the load balancer, which relays it to Alice.</p>
            <p>
              Alice&apos;s browser never learns that web-2 exists. That indirection is the whole trick: behind one address you can run three servers or
              three thousand, and swap them whenever you like.
            </p>
          </>
        ),
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'algorithms',
    title: 'How does it choose?',
    config: { lb: 'single', servers: THREE, showBrain: true, showZones: true },
    steps: [
      {
        id: 'round-robin',
        title: 'Round robin: take turns',
        reset: true,
        config: { algorithm: 'rr', rps: 1.1, hideNext: true },
        body: (
          <>
            <p>
              The simplest strategy deals requests out like cards: web-1, web-2, web-3, then back to web-1. No measuring, no guessing. This is{' '}
              <strong>round robin</strong>, the default in NGINX and many other load balancers.
            </p>
            <p>
              The panel under the <Term k="lb">load balancer</Term> shows what it&apos;s thinking. Now it&apos;s your turn: when a request arrives, the
              animation pauses. <strong>Click the server you think gets it.</strong>
            </p>
          </>
        ),
        interaction: { kind: 'predict', rounds: 3, prompt: 'Which server gets the next request?' },
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
upstream backend {
!    # no directive needed: round robin is the default
    server 10.0.1.11:8080;
    server 10.0.1.12:8080;
    server 10.0.1.13:8080;
}`,
        },
        legend: ['req', 'res'],
      },
      {
        id: 'unequal-requests',
        title: 'When requests aren’t equal',
        reset: true,
        config: { algorithm: 'rr', rps: 3, pattern: ['H', 'L', 'L'] },
        body: (
          <>
            <p>
              Round robin assumes every request costs the same. Real ones don&apos;t: showing a product page takes milliseconds, exporting a year of
              orders takes seconds.
            </p>
            <p>
              Here every third request is a heavy export (the {HEAVY} ones). Round robin blindly deals every single one to{' '}
              <Term k="server:s1">web-1</Term>. Its queue keeps growing while <Term k="server:s2">web-2</Term> and <Term k="server:s3">web-3</Term> coast.
              Same three servers, terrible result.
            </p>
          </>
        ),
        callouts: [
          { target: 'server:s1', text: <>drowning in <b>exports</b></>, dir: 'up' },
          { target: 'server:s3', text: <>mostly idle</>, dir: 'down' },
        ],
        hud: ['throughput', 'latency'],
        legend: ['req', 'heavy', 'res'],
      },
      {
        id: 'least-connections',
        title: 'Least connections: ask who’s free',
        config: { algorithm: 'least', rps: 3, pattern: ['H', 'L', 'L'] },
        body: (
          <>
            <p>
              <strong>Least connections</strong> sends each request to the server with the fewest requests in progress right now. The load balancer
              already tracks every connection it has open, so this costs almost nothing.
            </p>
            <p>
              web-1 is busy chewing on exports, so new requests flow to web-2 and web-3 until it catches up. Read the open-connection counts under the
              load balancer and <strong>predict its next pick</strong>.
            </p>
          </>
        ),
        interaction: { kind: 'predict', rounds: 3, prompt: 'Which server has the fewest open connections?' },
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
upstream backend {
!    least_conn;
    server 10.0.1.11:8080;
    server 10.0.1.12:8080;
    server 10.0.1.13:8080;
}`,
        },
        hud: ['latency'],
        legend: ['req', 'heavy', 'res'],
      },
      {
        id: 'weighted',
        title: 'Weighted: bigger servers get more',
        reset: true,
        config: { algorithm: 'weighted', servers: [{ id: 's1', size: 'l' }, { id: 's2' }, { id: 's3' }], rps: 4.5, showServed: true },
        body: (
          <>
            <p>
              Servers aren&apos;t always equal either. Say <Term k="server:s1">web-1</Term> is a big machine with four times the CPU of the others.
              Treating them all the same would waste it, or swamp the small ones.
            </p>
            <p>
              <strong>Weighted round robin</strong> hands out requests in proportion to each server&apos;s weight, here 4 : 1 : 1. Watch the share of
              traffic settle at about 67%, 17% and 17%.
            </p>
          </>
        ),
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
upstream backend {
!    server 10.0.1.11:8080 weight=4;   # the big one
    server 10.0.1.12:8080;            # weight=1 by default
    server 10.0.1.13:8080;
}`,
        },
        hud: ['share', 'latency'],
        legend: ['req', 'res'],
      },
      {
        id: 'sticky-sessions',
        title: 'The case of the vanishing cart',
        reset: true,
        seed: 5,
        config: { algorithm: 'rr', sessions: true, colorBy: 'client', clientOrder: 'random', rps: 1.6 },
        body: (
          <>
            <p>
              Many apps keep a user&apos;s session, their login and shopping cart, in the memory of the server that handled them. The cart icons under
              each server show whose cart lives where.
            </p>
            <p>
              Now watch <Term k="client:alice">Alice</Term>. Round robin sends her next request to a <em>different</em> server, which has never heard of
              her cart. From her side, the cart just emptied itself (the yellow warnings).
            </p>
            <p>
              <strong>IP hash</strong> fixes it: turn the user&apos;s IP address into a number, divide by the number of servers, and use the remainder to
              pick one. Same IP, same server, every time. Switch the algorithm below.
            </p>
            <Aside>Real load balancers use a proper hash function. Adding up the numbers is just easier to follow.</Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Pick the algorithm and watch the carts:',
          initial: 0,
          options: [
            {
              label: 'Round robin',
              apply: (w) => {
                w.clearSessions();
                w.update({ algorithm: 'rr' });
              },
            },
            {
              label: 'IP hash',
              apply: (w) => {
                w.clearSessions();
                w.update({ algorithm: 'iphash' });
              },
            },
          ],
        },
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
upstream backend {
!    ip_hash;     # same client IP -> same server
    server 10.0.1.11:8080;
    server 10.0.1.12:8080;
    server 10.0.1.13:8080;
}`,
        },
        legend: ['clients', 'res', 'warn'],
      },
      {
        id: 'adding-a-server-reshuffles',
        title: 'The catch: adding a server reshuffles everyone',
        reset: true,
        config: { algorithm: 'iphash', sessions: true, colorBy: 'client', clientOrder: 'random', rps: 1.6 },
        body: (
          <>
            <p>
              IP hash has a catch. The server you land on depends on <strong>how many servers there are</strong>. Traffic grows, you add a fourth, and{' '}
              <code>mod 3</code> becomes <code>mod 4</code>.
            </p>
            <p>
              Try it. <Term k="client:alice">Alice</Term> and <Term k="client:bob">Bob</Term> suddenly hash to different servers and lose their carts.
              Carol happens to stay put. With many servers, adding one moves almost every user at once.
            </p>
            <p>
              <strong>Consistent hashing</strong> limits the damage so only about 1 in N users move. It&apos;s clever enough to get its own lesson. But
              there&apos;s an even sturdier fix.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Add a 4th server',
              icon: 'plus',
              run: (w) => w.update({ servers: FOUR }),
              after: (
                <>
                  Look at the load balancer&apos;s math: it&apos;s now <code>mod 4</code>. Alice&apos;s <code>391 mod 4 = 3</code> sends her to web-4,
                  where no cart exists.
                </>
              ),
            },
            { label: 'Back to 3 servers', icon: 'minus', run: (w) => w.update({ servers: THREE }) },
          ],
        },
        legend: ['clients', 'res', 'warn'],
      },
      {
        id: 'stateless-servers',
        title: 'The real fix: stateless servers',
        reset: true,
        config: { algorithm: 'least', sessions: true, sessionStore: true, colorBy: 'client', clientOrder: 'random', servers: FOUR, rps: 2.2 },
        body: (
          <>
            <p>
              The robust answer is to stop keeping sessions in any one server&apos;s memory. Put them in a shared, fast store like{' '}
              <Term k="redis">Redis</Term>, and every server looks the session up there (the small purple pulses).
            </p>
            <p>
              Now the servers are <strong>stateless</strong>: any server can handle any request. Use whichever algorithm balances load best, add and
              remove servers at will, and survive crashes without logging anyone out.
            </p>
          </>
        ),
        code: {
          title: 'server.js',
          lang: 'js',
          code: `
import session from 'express-session';
import { RedisStore } from 'connect-redis';

app.use(session({
!  store: new RedisStore({ client: redis }),  // shared by all servers
  secret: process.env.SESSION_SECRET,
}));`,
        },
        legend: ['clients', 'res', 'sess'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'health',
    title: 'When servers fail',
    config: { lb: 'single', servers: THREE, algorithm: 'least', healthChecks: true, rps: 2.2, showBrain: false, showZones: true },
    steps: [
      {
        id: 'health-checks',
        title: 'Health checks: are you alive?',
        reset: true,
        body: (
          <>
            <p>Servers crash, freeze, run out of memory, and restart during deploys. The load balancer needs to know, so it keeps asking.</p>
            <p>
              Every couple of seconds it sends each server a tiny <code>GET /health</code> request (the small purple pulses). A quick{' '}
              <code>200 OK</code> means &ldquo;I&apos;m alive and ready.&rdquo; The dots above each server show its last three results.
            </p>
            <Aside>Time is compressed here. Real health checks usually run every 2 to 10 seconds.</Aside>
          </>
        ),
        callouts: [{ target: 'server:s1', text: <>last 3 checks: <b>all passed</b></>, dir: 'up' }],
        code: {
          title: 'haproxy.cfg',
          lang: 'haproxy',
          code: `
backend web
!    option httpchk GET /health
!    server web-1 10.0.1.11:8080 check inter 2s fall 3 rise 2
    server web-2 10.0.1.12:8080 check inter 2s fall 3 rise 2
    server web-3 10.0.1.13:8080 check inter 2s fall 3 rise 2`,
          note: 'inter: how often to check. fall: failures before a server is pulled. rise: passes before it comes back.',
        },
        hud: ['throughput', 'errors'],
        legend: ['req', 'res', 'hc'],
      },
      {
        id: 'a-server-crashes',
        title: 'A server crashes',
        reset: true,
        script: [{ at: 2.2, run: (w) => w.crashServer('s2') }],
        body: (
          <>
            <p>
              Watch: <Term k="server:s2">web-2</Term> is about to crash.
            </p>
            <p>
              At first the load balancer doesn&apos;t know, so it keeps sending web-2 traffic, and those users get <code>502 Bad Gateway</code> errors.
              Then the health checks start failing. After <strong>3 failures in a row</strong>, the load balancer marks web-2 as down and stops sending it
              anything. The errors stop, and web-1 and web-3 absorb the load.
            </p>
            <Aside>Many load balancers also retry a failed request on another server. That&apos;s a safety net, not a replacement for health checks.</Aside>
          </>
        ),
        quiz: {
          question: 'web-2 just failed its first health check. Does the load balancer stop sending it traffic right away?',
          options: [
            {
              text: 'Yes, immediately',
              why: 'One failure could be a dropped packet or a brief hiccup. Pulling servers on a single blip would make the whole system jumpy.',
            },
            {
              text: 'No, it waits for 3 failures in a row',
              correct: true,
              why: 'That’s the fall threshold (fall 3 in HAProxy). It accepts a few seconds of errors in exchange for not overreacting to network blips.',
            },
          ],
        },
        hud: ['throughput', 'errors'],
        legend: ['req', 'res', 'err', 'hc'],
      },
      {
        id: 'recovery',
        title: 'Recovery, and your turn',
        reset: true,
        config: { servers: [{ id: 's1' }, { id: 's2', down: true }, { id: 's3' }] },
        script: [{ at: 1.4, run: (w) => w.reviveServer('s2') }],
        clickServers: true,
        body: (
          <>
            <p>
              web-2 is rebooting. Once it&apos;s back it has to pass <strong>2 checks in a row</strong> before it gets traffic again. There&apos;s no
              point flooding a server that&apos;s still warming up.
            </p>
            <p>
              <strong>Your turn:</strong> click any server on the stage to crash it or bring it back. Take down two at once. Can you make the load
              balancer answer <code>503</code> for everyone?
            </p>
          </>
        ),
        interaction: { kind: 'clickServers', prompt: 'Click a server on the stage to crash or revive it.' },
        hud: ['throughput', 'errors', 'latency'],
        legend: ['req', 'res', 'err', 'hc'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'layers',
    title: 'Layer 4 vs Layer 7',
    config: { lb: 'single', servers: THREE, showBrain: true, showZones: true },
    steps: [
      {
        id: 'layer-4',
        title: 'Layer 4: routing by address',
        reset: true,
        config: { layer: 'l4', algorithm: 'least', rps: 2 },
        body: (
          <>
            <p>So far our load balancer has been reading HTTP requests. Many don&apos;t.</p>
            <p>
              A <strong>Layer 4</strong> load balancer works one level down, at TCP. It sees IP addresses and ports, but the contents stay sealed (the
              envelopes). Think of a mail sorter that reads the envelope but never opens it.
            </p>
            <p>
              It picks a server when a connection opens, then shuttles bytes back and forth for the life of that connection, so all of{' '}
              <Term k="client:alice">Alice</Term>&apos;s requests follow her connection to the same server. It&apos;s blazing fast and works for any
              protocol: databases, game servers, video streams.
            </p>
          </>
        ),
        code: {
          title: 'haproxy.cfg',
          lang: 'haproxy',
          code: `
frontend www
    bind :443
!    mode tcp                 # don't parse, just forward bytes
    default_backend web

backend web
!    mode tcp
    balance leastconn
    server web-1 10.0.1.11:443 check`,
        },
        legend: ['sealed'],
      },
      {
        id: 'layer-7',
        title: 'Layer 7: routing by content',
        reset: true,
        config: {
          layer: 'l7',
          routeByPath: true,
          colorBy: 'path',
          algorithm: 'rr',
          rps: 2.4,
          servers: [
            { id: 's1', label: 'api-1', pool: 'api' },
            { id: 's2', label: 'api-2', pool: 'api' },
            { id: 's3', label: 'media-1', pool: 'media', size: 'm' },
          ],
        },
        body: (
          <>
            <p>
              A <strong>Layer 7</strong> load balancer speaks HTTP. It decrypts the traffic (called <strong>TLS termination</strong>), opens the envelope,
              and reads the method, path, headers and cookies. Then it routes by content.
            </p>
            <p>
              Here <code>/api/*</code> goes to the API servers and <code>/media/*</code> goes to a server tuned for images and video. The same box can also
              retry failed requests, compress responses and rate-limit abusers.
            </p>
            <p>
              The price is more CPU per request, because it parses every one. Most web apps use Layer 7. Layer 4 wins when you need raw speed or
              aren&apos;t speaking HTTP.
            </p>
          </>
        ),
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
upstream api   { server 10.0.1.11:8080; server 10.0.1.12:8080; }
upstream media { server 10.0.1.13:8080; }

server {
    listen 443 ssl;             # TLS terminates here
!    location /api/   { proxy_pass http://api; }
!    location /media/ { proxy_pass http://media; }
}`,
        },
        legend: ['api', 'media', 'res'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'redundancy',
    title: 'Who balances the balancer?',
    config: { servers: THREE, algorithm: 'least', rps: 2.2, showBrain: false, showZones: true },
    steps: [
      {
        id: 'the-balancer-can-fail-too',
        title: 'The balancer can fail too',
        reset: true,
        config: { lb: 'single' },
        body: (
          <>
            <p>We made the servers redundant, and in doing so created a new single point of failure: the load balancer itself.</p>
            <p>If it dies, nobody gets through, no matter how many healthy servers sit behind it. Go on, pull the plug.</p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Crash the load balancer',
              icon: 'power',
              run: (w) => w.crashLB('A'),
              after: <>Every request times out, even though all three servers are perfectly healthy.</>,
            },
            { label: 'Bring it back', icon: 'replay', run: (w) => w.reviveLB('A') },
          ],
        },
        hud: ['throughput', 'errors'],
        legend: ['req', 'res', 'err'],
      },
      {
        id: 'active-passive',
        title: 'Two balancers and a floating IP',
        reset: true,
        config: { lb: 'pair' },
        script: [{ at: 4.5, run: (w) => w.crashLB('A') }],
        body: (
          <>
            <p>
              The fix: run two load balancers. The <strong>active</strong> one owns the public IP. The <strong>standby</strong> watches its heartbeats,
              the purple pulses between them. The protocol is called <strong>VRRP</strong>, and tools like <code>keepalived</code> implement it.
            </p>
            <p>
              When the heartbeats stop, the standby claims the IP within a second or two and traffic flows again. Clients keep using the same address and
              never notice the swap. That&apos;s why it&apos;s called a <strong>floating IP</strong>.
            </p>
            <p>Managed cloud load balancers do all of this for you, across many machines and data centers.</p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Crash the active one',
              icon: 'power',
              run: (w) => {
                const a = w.activeLB();
                if (a) w.crashLB(a.id);
              },
            },
            {
              label: 'Repair both',
              icon: 'replay',
              run: (w) => {
                w.reviveLB('A');
                w.reviveLB('B');
              },
            },
          ],
        },
        code: {
          title: 'keepalived.conf',
          lang: 'conf',
          code: `
vrrp_instance VI_1 {
    state MASTER            # BACKUP on the standby
    interface eth0
    virtual_router_id 51
    priority 150            # the standby uses 100
!    advert_int 1            # heartbeat every second
    virtual_ipaddress {
!        203.0.113.10        # the floating IP
    }
}`,
        },
        hud: ['throughput', 'errors'],
        legend: ['req', 'res', 'err', 'hb'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'playground',
    title: 'Recap & playground',
    config: { lb: 'single', showZones: true, showBrain: true },
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        reset: true,
        config: {
          servers: FOUR,
          clients: CLIENTS,
          algorithm: 'least',
          healthChecks: true,
          chaos: true,
          rps: 3,
          arrival: 'poisson',
          heavyRatio: 0.15,
        },
        body: (
          <>
            <p>
              Here&apos;s everything in one picture: least connections, health checks, and a server failing now and then. Notice how little the users
              feel it.
            </p>
          </>
        ),
        extra: <CheatSheet />,
        hud: ['throughput', 'latency', 'errors'],
        legend: ['req', 'heavy', 'res', 'err', 'hc'],
      },
      {
        id: 'playground',
        title: 'Playground',
        reset: true,
        config: {
          servers: FOUR,
          clients: CLIENTS,
          algorithm: 'rr',
          healthChecks: true,
          rps: 4,
          arrival: 'poisson',
          heavyRatio: 0.2,
          showServed: true,
        },
        clickServers: true,
        body: (
          <p>
            Everything you&apos;ve learned, in one sandbox. Change the algorithm, dial up the traffic, resize servers, and click any server to crash it.
            The config at the bottom is generated live from your settings.
          </p>
        ),
        interaction: { kind: 'playground' },
        hud: ['throughput', 'latency', 'errors', 'share'],
        legend: ['req', 'heavy', 'res', 'err', 'hc'],
      },
    ],
  },
];
