import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import type { ScriptEvent } from '@/lib/sim/Sim';
import { CheatSheet } from './panel/CheatSheet';
import { CAST, patternClients, type RateConfig, type RateSim } from './sim';
import type { HudKey, StageCallout } from './stage/Overlay';

export const META = { slug: 'rate-limiting', code: 'SD-07', track: 'System design', title: 'Rate Limiting' };

export type Interaction =
  | { kind: 'actions'; prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: RateSim) => void; after?: ReactNode }[] }
  | { kind: 'toggle'; prompt: ReactNode; initial?: number; options: { label: string; apply: (s: RateSim) => void; note?: ReactNode }[] }
  | { kind: 'bucketSliders' }
  | { kind: 'exploit' }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<RateConfig>;
  /** Start the world fresh (default true) */
  reset?: boolean;
  script?: ScriptEvent<RateSim>[];
  predict?: number;
  predictPrompt?: ReactNode;
  interaction?: Interaction;
  hud?: HudKey[];
  legend?: LegendItem[];
  callouts?: StageCallout[];
  focus?: string[];
  code?: CodeSpec;
  quiz?: QuizSpec;
  extra?: ReactNode;
  /** A side note shown after the interaction cards */
  aside?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<RateConfig>;
  steps: Step[];
}

/* ---------------- legend pieces ---------------- */

const L = {
  req: { label: 'request', color: SIG.req },
  ok: { label: '200 OK', color: SIG.res },
  r429: { label: '429 Too Many Requests', color: SIG.err },
  r503: { label: '503 overloaded', color: SIG.err },
  token: { label: 'token', color: SIG.hc },
  redis: { label: 'Redis call', color: SIG.hc, shape: 'small' as const },
  alice: { label: 'Alice', color: CAST.alice.color },
  bob: { label: 'Bob', color: CAST.bob.color },
  bot: { label: 'Scraper', color: CAST.bot.color },
};

const TRIO = [
  { id: 'alice', traffic: 'steady' as const, rate: 0.35 },
  { id: 'bob', traffic: 'steady' as const, rate: 0.3 },
  { id: 'bot', traffic: 'flood' as const, rate: 5 },
];

const SMALL_SERVER: Partial<RateConfig> = { workers: 2, service: 0.8, queueCap: 6 };

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'why',
    title: 'Why limit at all?',
    cfg: { strip: 'off', ...SMALL_SERVER },
    steps: [
      {
        id: 'no-limits',
        title: 'An API with no limits',
        cfg: { algo: 'none', clients: [TRIO[0], TRIO[1], { id: 'bot', traffic: 'off', rate: 5 }] },
        script: [{ at: 3.5, run: (s) => s.startScraper() }],
        body: (
          <>
            <p>
              Here&apos;s a small API: one server, <Term k="server">api-1</Term>, with two worker slots. It can finish about{' '}
              <strong>2.5 requests per second</strong>. <Term k="alice">Alice</Term> and <Term k="bob">Bob</Term> use it gently, and every answer comes back
              green.
            </p>
            <p>
              Then a <Term k="bot">scraper</Term> shows up and starts pulling every product page it can find, five requests a second. The server can&apos;t
              keep up. Its waiting room fills, and it starts answering <code>503 Service Unavailable</code>: to the scraper, and to Alice and Bob too.
            </p>
            <p>
              One client just ruined the API for everyone. Scrapers, bots guessing passwords on your login page, and buggy clients stuck in a retry loop all
              look like this. Even when nothing breaks, every request costs CPU, database time and money.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Call off the scraper',
              icon: 'power',
              run: (s) => s.stopScraper(),
              after: <>The waiting room drains and Alice and Bob get their 200s back. But you can&apos;t count on abusers stopping politely.</>,
            },
            { label: 'Send it back in', icon: 'replay', run: (s) => s.startScraper() },
          ],
        },
        hud: ['queue', 'errors'],
        legend: [L.alice, L.bob, L.bot, L.ok, L.r503],
        callouts: [{ target: 'server', text: <>2 slots: about <b>2.5 requests/s</b></>, dir: 'down', pdir: 'none' }],
        code: {
          title: 'access.log (trimmed)',
          lang: 'conf',
          code: `
198.51.100.42 "GET /api/cart" 200
!203.0.113.66 "GET /api/products?p=1181" 200
!203.0.113.66 "GET /api/products?p=1182" 200
!203.0.113.66 "GET /api/products?p=1183" 503
198.51.100.77 "GET /api/orders" 503`,
          note: 'One IP, thousands of requests, and now everyone gets errors. Rate limiting starts with counting who is asking, and how often.',
        },
      },
      {
        id: 'add-a-limiter',
        title: 'Put a limiter at the door',
        cfg: { algo: 'fixed', key: 'client', limit: 5, window: 10, clients: TRIO },
        body: (
          <>
            <p>
              A <Term k="limiter">rate limiter</Term> sits in front of the server and counts how many requests each client has sent recently. The rule here:{' '}
              <strong>5 requests per 10 seconds, per client</strong>. Under the limit, requests pass. Over it, the limiter answers right away with{' '}
              <code>429 Too Many Requests</code>, and the server never sees them.
            </p>
            <p>
              Watch the rows inside the limiter. The <Term k="bot">scraper</Term> fills its 5 slots in a second, then bounces off in red for the rest of the
              window. Alice and Bob stay under their limits and never notice. The server&apos;s waiting room stays nearly empty.
            </p>
            <p>
              Limiters usually live at the edge: in an <strong>API gateway</strong>, a reverse proxy like NGINX, the load balancer, or as middleware in your
              app. Rejecting early is the point. A 429 costs almost nothing; a real request costs a database query.
            </p>
          </>
        ),
        hud: ['queue', 'rejected'],
        legend: [L.alice, L.bob, L.bot, L.ok, L.r429],
        callouts: [{ target: 'limiter', text: <>one count <b>per client</b></>, dir: 'up', pdir: 'none' }],
        code: {
          title: 'server.js',
          lang: 'js',
          code: `
import { rateLimit } from 'express-rate-limit';

app.use('/api', rateLimit({
!  windowMs: 10 * 1000,  // 10-second window
!  limit: 5,             // per client IP
}));`,
          note: 'express-rate-limit keys by client IP by default and answers 429 when a client goes over.',
        },
      },
      {
        id: 'per-client-or-global',
        title: 'One limit for all, or one each?',
        cfg: { algo: 'fixed', key: 'global', limit: 10, window: 10, clients: TRIO },
        body: (
          <>
            <p>
              What should the limiter count together? Try the simplest idea first: <strong>one global limit</strong> of 10 requests per 10 seconds for the
              whole API, about what the server can take.
            </p>
            <p>
              The server is safe, but look who gets the 429s: <Term k="alice">Alice</Term> and <Term k="bob">Bob</Term>. The scraper grabs the whole budget
              the moment each window opens, so by the time they ask, it&apos;s gone. Now switch to <strong>per client</strong>.
            </p>
            <p>
              With a separate count per client, the scraper only burns its own allowance. That&apos;s <strong>fairness</strong>. Real systems layer both: a
              per-client limit for fairness, plus a global one that protects the servers.
            </p>
          </>
        ),
        aside: (
          <>
            Per client needs a key. The IP is easy but blunt: a whole office can share one behind NAT, and attackers rotate through many. For signed-in
            traffic, key by user or API key. Sensitive routes get stricter limits, like 5 login attempts a minute per account.
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'What does the limiter count together?',
          initial: 0,
          options: [
            {
              label: 'One global limit',
              apply: (s) => s.setKeyMode('global', 10),
              note: <>Everyone shares 10 per window. The scraper takes most of them.</>,
            },
            {
              label: 'Per client',
              apply: (s) => s.setKeyMode('client', 5),
              note: <>Each client gets its own 5 per window. Only the scraper hits its limit.</>,
            },
          ],
        },
        hud: ['queue', 'rejected'],
        legend: [L.alice, L.bob, L.bot, L.ok, L.r429],
        code: {
          title: 'limit-key.js',
          lang: 'js',
          code: `
function limitKey(req) {
!  if (req.apiKey) return \`key:\${req.apiKey.id}\`;
!  if (req.user) return \`user:\${req.user.id}\`;
  return \`ip:\${req.ip}\`;   // anonymous traffic
}`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'fixed',
    title: 'Fixed windows',
    cfg: { algo: 'fixed', key: 'client', limit: 5, window: 10, strip: 'hist' },
    steps: [
      {
        id: 'fixed-window',
        title: 'Fixed window counter',
        cfg: { clients: [{ id: 'alice', traffic: 'steady', rate: 0.9 }] },
        body: (
          <>
            <p>
              Time to open the limiter up. The simplest algorithm is the <strong>fixed window counter</strong>. Chop time into 10-second windows: 0:00 to
              0:10, 0:10 to 0:20, and so on. Keep one counter per client per window. Each request adds 1. Once the counter reaches the limit, everything else
              in that window gets a 429. When the next window starts, the counter goes back to zero.
            </p>
            <p>
              <Term k="alice">Alice</Term>&apos;s app calls about once a second, faster than 5 per 10 seconds. Watch her slots fill, the red 429s for the rest
              of the window, then the reset. The <Term k="strip">strip</Term> at the bottom records every decision: one square per request.
            </p>
            <p>It&apos;s cheap: one small counter per client, which can simply expire when its window ends.</p>
            <Aside>Real limits are usually per second, minute or hour. This lesson uses 10-second windows so you can watch several go by.</Aside>
          </>
        ),
        hud: ['allowed', 'rejected'],
        legend: [L.req, L.ok, L.r429],
        callouts: [{ target: 'limiter', text: <><b>5 per window</b>, then 429 until it resets</>, dir: 'up', pdir: 'none' }],
        code: {
          title: 'fixed-window.js',
          lang: 'js',
          code: `
const LIMIT = 5, WINDOW_MS = 10_000;
const counters = new Map(); // key -> {win, n}

function allow(key, now = Date.now()) {
!  const win = Math.floor(now / WINDOW_MS);
  const c = counters.get(key);
!  if (!c || c.win !== win) {  // new window
    counters.set(key, { win, n: 1 });
    return true;
  }
!  if (c.n >= LIMIT) return false;  // 429
  c.n += 1;
  return true;
}`,
        },
      },
      {
        id: 'predict-fixed-window',
        title: 'Allowed, or 429?',
        cfg: { clients: [{ id: 'alice', traffic: 'steady', rate: 0.9 }], clockStart: 3, predict: 'fixed' },
        script: [{ at: 0.2, run: (s) => s.burst('alice', 3) }],
        predict: 3,
        predictPrompt: 'Read the counter and the clock. Does this request get through?',
        body: (
          <>
            <p>
              Your turn. When one of <Term k="alice">Alice</Term>&apos;s requests reaches the <Term k="limiter">limiter</Term>, the animation pauses. Read the
              count and how long the window has left, then decide: allowed, or 429?
            </p>
            <p>Careful around the edges. A request only counts against the window it lands in.</p>
          </>
        ),
        hud: ['allowed', 'rejected'],
        legend: [L.req, L.ok, L.r429],
      },
      {
        id: 'boundary-problem',
        title: 'The boundary problem',
        cfg: { clients: [{ id: 'alice', traffic: 'boundary' }], clockStart: 6, span: true },
        body: (
          <>
            <p>
              Fixed windows have a blind spot. The rule says <em>5 per 10 seconds</em>, but the counter only knows about <em>this</em> window. Watch{' '}
              <Term k="alice">Alice</Term> send 5 requests just before a window ends, and 5 more just after the next one starts.
            </p>
            <p>
              All 10 get through. The first 5 count against the old window, the next 5 against the new one. That&apos;s <strong>twice the limit in about two
              seconds</strong>, and the yellow bracket on the <Term k="strip">strip</Term> marks a 10-second stretch holding 10 allowed requests.
            </p>
            <p>
              If the limit exists because the server can handle 5, the edge of every window is a door left open. A client that sends bursts will stumble
              through it sooner or later, by accident or on purpose.
            </p>
          </>
        ),
        hud: ['span', 'rejected'],
        legend: [L.req, L.ok, L.r429],
        code: {
          title: 'access.log',
          lang: 'conf',
          code: `
!10:00:08.60 GET /search 200  # 1 of 5 (:00)
 10:00:08.72 GET /search 200  # 2 of 5
!10:00:09.08 GET /search 200  # 5 of 5
!10:00:10.25 GET /search 200  # 1 of 5 (:10)
 10:00:10.37 GET /search 200  # 2 of 5
!10:00:10.73 GET /search 200  # 5 of 5`,
          note: 'Two windows, :00 and :10. Ten requests in 2.1 seconds, and every one of them allowed.',
        },
      },
      {
        id: 'exploit-the-boundary',
        title: 'Exploit the seam yourself',
        cfg: { clients: [{ id: 'alice', traffic: 'off' }], span: true, hop: 0.5 },
        body: (
          <>
            <p>
              Now you try. You control <Term k="alice">Alice</Term>, and the button fires a burst of 5 requests. Your goal: get{' '}
              <strong>10 requests allowed within 10 seconds</strong>, double the limit.
            </p>
            <p>
              Keep an eye on the window timer in the <Term k="limiter">limiter</Term>. Requests take half a second to arrive, and they count against
              whichever window they land in.
            </p>
            <Aside>Some limiters start each client&apos;s window at its first request instead of on the clock. That hides the seam, but doesn&apos;t remove it.</Aside>
          </>
        ),
        interaction: { kind: 'exploit' },
        hud: ['best', 'rejected'],
        legend: [L.req, L.ok, L.r429],
        callouts: [{ target: 'alice', text: <>you control <b>Alice</b></>, dir: 'down', pdir: 'none' }],
        code: {
          title: 'exploit.js',
          lang: 'js',
          code: `
// windows follow the clock, so edges are known
const left = 10_000 - (Date.now() % 10_000);
!setTimeout(() => burst(5), left - 800);  // before
!setTimeout(() => burst(5), left + 200);  // after`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'sliding',
    title: 'Sliding windows',
    cfg: { key: 'client', limit: 5, window: 10, strip: 'hist', clients: [{ id: 'alice', traffic: 'boundary' }], clockStart: 6, span: true },
    steps: [
      {
        id: 'sliding-window-log',
        title: 'Sliding window log',
        cfg: { algo: 'log' },
        body: (
          <>
            <p>
              The fix is to stop chopping time into fixed pieces and look back instead: <em>how many requests has Alice made in the last 10 seconds,
              counting from right now?</em>
            </p>
            <p>
              The <strong>sliding window log</strong> keeps a timestamp for every allowed request. When a new one arrives, it drops timestamps older than 10
              seconds and counts the rest. Fewer than 5? Allowed, and its timestamp joins the log. Each slot in the <Term k="limiter">limiter</Term> drains
              as its entry ages out.
            </p>
            <p>
              Same attack as before, but this time the second burst is rejected in full. The window moves with the clock, so there&apos;s no edge to hide
              behind. The violet bracket on the <Term k="strip">strip</Term> is the look-back window.
            </p>
            <p>The catch is memory: one entry per request. A limit of 1,000 per hour means storing up to 1,000 timestamps per client.</p>
          </>
        ),
        hud: ['span', 'rejected'],
        legend: [L.req, L.ok, L.r429],
        code: {
          title: 'redis-cli',
          lang: 'shell',
          code: `
# a sorted set per client, scored by time (ms)
!ZREMRANGEBYSCORE rl:alice 0 1790424590000
!ZCARD rl:alice   # 4 in the window: room for 1
ZADD rl:alice 1790424600000 req-8f2c
PEXPIRE rl:alice 10000`,
          note: 'Wrap these in a Lua script so two servers can’t both count 4 and both add.',
        },
      },
      {
        id: 'sliding-window-counter',
        title: 'Sliding window counter',
        cfg: { algo: 'sliding' },
        body: (
          <>
            <p>
              Most big systems use a cheaper approximation, the <strong>sliding window counter</strong>. Keep the fixed-window counters, but when a request
              arrives, also count the <em>previous</em> window, weighted by how much of it still overlaps the last 10 seconds.
            </p>
            <p>
              Three seconds into a window, the look-back still covers 70% of the previous one, so the estimate is <code>previous × 0.7 + current</code>. Under
              the limit? Allowed. The <Term k="limiter">limiter</Term> shows the math live; the hatched part of the <Term k="strip">strip</Term> is the slice
              of the previous window being counted.
            </p>
            <p>
              Two integers per client, and nearly as strict as the log: here it lets 6 through instead of 10. Not 5, because it assumes the previous
              window&apos;s requests were spread evenly, and ours were crammed at its very end. On real traffic the error is tiny. Cloudflare, which uses
              this method, measured 0.003% of requests misjudged.
            </p>
          </>
        ),
        hud: ['span', 'rejected'],
        legend: [L.req, L.ok, L.r429],
        code: {
          title: 'sliding-counter.js',
          lang: 'js',
          code: `
function allow(key, now) {
  const c = counts(key, now);  // {prev, curr}
!  const into = (now % WINDOW_MS) / WINDOW_MS;
!  const est = c.prev * (1 - into) + c.curr;
  if (est >= LIMIT) return false;
  c.curr += 1;
  return true;
}`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'token',
    title: 'Token bucket',
    cfg: { algo: 'token', key: 'client', capacity: 5, rate: 1, strip: 'hist' },
    steps: [
      {
        id: 'token-bucket',
        title: 'Token bucket',
        cfg: { clients: [{ id: 'alice', traffic: 'bursty', burst: 6, every: 7 }] },
        body: (
          <>
            <p>
              The <strong>token bucket</strong> is the algorithm you&apos;ll meet most in real APIs, and it thinks about rate differently. Picture a bucket
              that holds up to <strong>B tokens</strong> (here 5) and a tap that drips in <strong>R tokens per second</strong> (here 1). Every request must
              take a token. No token, no entry: 429.
            </p>
            <p>
              A full bucket is saved-up allowance. <Term k="alice">Alice</Term> sends bursts of 6: the first 5 each grab a token and go straight through, and
              the 6th finds the <Term k="limiter">bucket</Term> empty. Then the tap refills it, one token a second, before her next burst.
            </p>
            <p>
              So <strong>B</strong> sets how big a burst can be, and <strong>R</strong> sets the average rate over time.
            </p>
            <Aside>
              There&apos;s no timer dripping tokens in real code. Implementations store two numbers per client, the token count and when it was last
              updated, and top the bucket up for the elapsed time whenever a request arrives.
            </Aside>
          </>
        ),
        hud: ['tokens', 'allowed', 'rejected'],
        legend: [L.req, L.token, L.ok, L.r429],
        callouts: [{ target: 'limiter', text: <>tokens drip in at <b>1 per second</b></>, dir: 'up', pdir: 'none' }],
        code: {
          title: 'token-bucket.js',
          lang: 'js',
          code: `
function allow(b, now) {  // now in seconds
  const dt = now - b.last;
!  b.tokens = Math.min(CAP, b.tokens + dt * RATE);
  b.last = now;
!  if (b.tokens < 1) return false;  // empty: 429
  b.tokens -= 1;                   // take one
  return true;
}`,
        },
      },
      {
        id: 'burst-then-trickle',
        title: 'Burst, then trickle',
        cfg: { clients: [{ id: 'alice', traffic: 'steady', rate: 0.3, delay: 2.5 }] },
        script: [{ at: 0.2, run: (s) => s.burst('alice', 10) }],
        body: (
          <>
            <p>
              Your turn. Press <strong>Send 10 now</strong>. With a full bucket, 5 requests go straight through and the other 5 bounce off an empty bucket.
              From there, tokens drip back at one per second, so one request a second is all Alice can keep up.
            </p>
            <p>
              That&apos;s the shape of a token bucket: <strong>generous with short bursts, strict about the average</strong>. Over any stretch of{' '}
              <em>t</em> seconds, at most <code>B + R × t</code> requests get through. Real clients are bursty (one page load can fire a dozen API calls at
              once), so this fits real traffic well.
            </p>
            <p>Now move the sliders. A bigger bucket forgives bigger bursts. A faster refill raises the sustained rate.</p>
          </>
        ),
        interaction: { kind: 'bucketSliders' },
        hud: ['tokens', 'allowed', 'rejected'],
        legend: [L.req, L.token, L.ok, L.r429],
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
limit_req_zone $binary_remote_addr
               zone=api:10m rate=5r/s;

location /api/ {
!    limit_req zone=api burst=10 nodelay;
!    limit_req_status 429;   # default: 503
    proxy_pass http://backend;
}`,
          note: 'NGINX calls its algorithm a leaky bucket, but with nodelay it acts like a token bucket: an idle client can send 11 requests at once (burst + 1), then 5 per second. 10m of shared memory holds about 80,000 client IPs.',
        },
      },
      {
        id: 'predict-token-bucket',
        title: 'How many get through?',
        cfg: { rate: 0.5, clients: [{ id: 'alice', traffic: 'bursts' }], predict: 'bucket' },
        predict: 3,
        predictPrompt: 'A burst is arriving. Count the tokens: how many requests get one?',
        body: (
          <>
            <p>
              Now predict. The refill is slow here, <strong>one token every 2 seconds</strong>, and Alice fires bursts of different sizes. When a burst
              reaches the <Term k="limiter">limiter</Term>, the animation pauses.
            </p>
            <p>Read the token count and pick how many requests in the burst get through. A token that&apos;s still dripping doesn&apos;t count: every request needs a whole one.</p>
          </>
        ),
        hud: ['tokens', 'allowed', 'rejected'],
        legend: [L.req, L.token, L.ok, L.r429],
        code: {
          title: 'aws cli',
          lang: 'shell',
          code: `
aws apigateway create-usage-plan \\
  --name partners \\
!  --throttle burstLimit=20,rateLimit=10 \\
  --api-stages apiId=a1b2c3d4e5,stage=prod`,
          note: 'Amazon API Gateway throttles with a token bucket: burstLimit is the bucket size B, rateLimit is the refill rate R per second.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'leaky',
    title: 'Leaky bucket',
    cfg: { key: 'client', capacity: 5, strip: 'flow' },
    steps: [
      {
        id: 'leaky-bucket',
        title: 'Leaky bucket',
        cfg: { algo: 'leaky', rate: 1, clients: [{ id: 'alice', traffic: 'bursty', burst: 6, every: 8 }] },
        body: (
          <>
            <p>
              The <strong>leaky bucket</strong> flips the picture: the bucket holds <em>requests</em>, not tokens. Arriving requests join a queue, and a hole
              in the bottom lets them out to the server at a fixed pace, here one per second. If the bucket is already full, the request spills over: 429.
            </p>
            <p>
              Alice&apos;s bursts pour into the <Term k="limiter">bucket</Term> all at once but come out evenly spaced. On the <Term k="strip">strip</Term>,
              arrivals stack up above the line; below it is what the server receives: a steady drip.
            </p>
            <p>
              Use it when whatever sits behind you can&apos;t take bursts at all: a legacy system, or a payment provider that allows exactly 10 calls a
              second. The price is <strong>waiting</strong>: a request at the back of the queue waits its turn.
            </p>
          </>
        ),
        hud: ['wait', 'allowed', 'rejected'],
        legend: [L.req, L.ok, L.r429],
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
location /api/ {
!    limit_req zone=api burst=10;  # no nodelay
    limit_req_status 429;
    proxy_pass http://backend;
}`,
          note: 'Without nodelay, NGINX holds the extra requests and releases them at exactly the configured rate: a real leaky bucket.',
        },
      },
      {
        id: 'compare-algorithms',
        title: 'Same traffic, four algorithms',
        cfg: { algo: 'fixed', limit: 5, window: 10, rate: 0.5, clients: [{ id: 'alice', traffic: 'bursty', burst: 7, every: 9 }] },
        body: (
          <>
            <p>
              One bursty client, four limiters, all set to the same long-run rate: <strong>5 requests per 10 seconds</strong>. For the buckets that means 5
              tokens (or queue slots), refilling or leaking at 0.5 per second. Switch between them and compare the <Term k="strip">strip</Term>, especially
              the bottom half: what actually reaches the server.
            </p>
            <p>
              The <strong>fixed window</strong> passes bursts whole and can double up at an edge. The <strong>sliding log</strong> is strict. The{' '}
              <strong>token bucket</strong> passes a burst up to its size, then paces the rest. The <strong>leaky bucket</strong> turns every burst into an
              even trickle, and makes requests wait for it.
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Same traffic. Pick the algorithm:',
          initial: 0,
          options: [
            { label: 'Fixed', apply: (s) => s.setAlgo('fixed'), note: <>Fixed window: cheap, but bursts on both sides of an edge can get double the limit through.</> },
            { label: 'Sliding log', apply: (s) => s.setAlgo('log'), note: <>Sliding log: never more than 5 in any 10 seconds. Costs a timestamp per request.</> },
            { label: 'Token', apply: (s) => s.setAlgo('token'), note: <>Token bucket: up to 5 at once from a full bucket, then one every 2 seconds.</> },
            { label: 'Leaky', apply: (s) => s.setAlgo('leaky'), note: <>Leaky bucket: never faster than one every 2 seconds. Watch the longest wait climb.</> },
          ],
        },
        hud: ['allowed', 'rejected', 'wait'],
        legend: [L.req, L.ok, L.r429],
        code: {
          title: 'envoy.yaml',
          lang: 'conf',
          code: `
# Envoy's local rate limit filter
token_bucket:
!  max_tokens: 5         # B
!  tokens_per_fill: 1    # R: 1 token...
!  fill_interval: 2s     # ...every 2 s`,
          note: 'Envoy, the proxy under many service meshes, uses a token bucket too.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'responses',
    title: 'Saying no politely',
    steps: [
      {
        id: 'http-429',
        title: '429 Too Many Requests',
        cfg: { algo: 'fixed', key: 'client', limit: 5, window: 10, strip: 'hist', inspect: true, clients: [{ id: 'alice', traffic: 'steady', rate: 1.1 }] },
        body: (
          <>
            <p>
              How you say no matters as much as when. The standard answer is <code>429 Too Many Requests</code>, and it should tell the client{' '}
              <strong>when to come back</strong>. The card above the wire shows the headers of the latest response.
            </p>
            <p>
              <code>Retry-After</code> is the important one: the number of seconds until a retry can succeed, here when the window resets. Allowed responses
              carry the client&apos;s remaining budget too, so a well-behaved client can slow down <em>before</em> it hits the wall.
            </p>
            <p>
              Don&apos;t answer with 503 or 500. Those say the server is broken, and clients and monitoring treat them that way. 429 says: <em>you</em>{' '}
              are sending too much.
            </p>
            <Aside>
              Header names vary. Many APIs send X-RateLimit-Limit, -Remaining and -Reset (GitHub does, with Reset as a Unix timestamp). The RateLimit-*
              names here come from an IETF draft, whose latest version folds them into RateLimit and RateLimit-Policy. 429 itself is from RFC 6585.
              NGINX&apos;s <code>limit_req</code> sends a bare 429 with none of these headers, so your app or gateway has to add them.
            </Aside>
          </>
        ),
        hud: ['allowed', 'rejected'],
        legend: [L.req, L.ok, L.r429],
        code: {
          title: 'response',
          lang: 'http',
          code: `
!HTTP/1.1 429 Too Many Requests
Content-Type: application/json
!Retry-After: 4
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: 4

{"error": "rate_limited", "retry_after": 4}`,
        },
      },
      {
        id: 'backoff-and-jitter',
        title: 'Back off, with jitter',
        cfg: { scene: 'storm', devices: 6, algo: 'token', key: 'global', capacity: 1, rate: 0.5, strip: 'hist', hop: 0.6, retry: 'immediate', workers: 4, service: 0.3 },
        body: (
          <>
            <p>What the client does after a 429 decides whether things calm down or get worse.</p>
            <p>
              Six phones lose their connection and reconnect at the same moment. This API lets one request through every 2 seconds (a one-token bucket
              shared by everyone), so five of the six get a 429. If they <strong>retry immediately</strong>, they hammer the limiter in a tight loop and most
              retries fail again: a <strong>retry storm</strong>. Every failed attempt is load you pay for.
            </p>
            <p>
              <strong>Exponential backoff</strong> waits 1 s, then 2, then 4 before each retry, and cuts the wasted attempts a lot. But the phones back off in
              lockstep: they wake at the same instant, one wins, the rest fail together, and the limiter idles in between. <strong>Jitter</strong> waits a
              random time between 0 and the backoff instead, so retries spread out and use capacity as it refills. Compare the counts, top left.
            </p>
          </>
        ),
        aside: <>If a 429 comes with Retry-After, honor it. Backoff with jitter is the fallback, and it works for 503s too.</>,
        interaction: {
          kind: 'toggle',
          prompt: 'How should the phones retry?',
          initial: 0,
          options: [
            { label: 'Retry at once', apply: (s) => s.setRetry('immediate'), note: <>A tight loop: the most attempts by far, nearly all of them wasted.</> },
            { label: 'Backoff', apply: (s) => s.setRetry('backoff'), note: <>Far fewer attempts, but they come in synchronized waves, so the last phone waits longest.</> },
            { label: 'Backoff + jitter', apply: (s) => s.setRetry('jitter'), note: <>About as few attempts as backoff, and everyone is through much sooner.</> },
          ],
        },
        hud: ['storm'],
        legend: [L.req, L.ok, L.r429],
        code: {
          title: 'client.js',
          lang: 'js',
          code: `
async function fetchWithRetry(url, tries = 6) {
  for (let i = 0; ; i++) {
    const res = await fetch(url);
    if (res.status !== 429 || i === tries - 1)
      return res;
    // Retry-After is seconds ("4") or an HTTP date
    const after = res.headers.get('Retry-After');
    const ms = !after ? NaN
      : isNaN(after) ? Date.parse(after) - Date.now() : after * 1000;
!    const cap = Math.min(30_000, 1000 * 2 ** i);
!    const wait = Number.isNaN(ms) ? Math.random() * cap   // full jitter
!      : Math.max(0, ms);
    await sleep(wait);
  }
}`,
          note: '“Full jitter”: wait a random time between 0 and the exponential cap, unless the server said how long to wait.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'scale',
    title: 'Rate limiting at scale',
    steps: [
      {
        id: 'distributed-counters',
        title: 'Many gateways, one limit',
        cfg: {
          scene: 'dist',
          algo: 'fixed',
          key: 'client',
          limit: 5,
          window: 10,
          strip: 'off',
          store: 'local',
          clients: [
            { id: 'bot', traffic: 'flood', rate: 3 },
            { id: 'alice', traffic: 'steady', rate: 0.3 },
          ],
        },
        body: (
          <>
            <p>
              One limiter is easy. Real APIs run many gateway instances behind a <Term k="lb">load balancer</Term>, and each one only sees the requests that
              land on it.
            </p>
            <p>
              With <strong>local counters</strong>, each <Term k="gateways">gateway</Term> enforces 5 per 10 s on its own. The load balancer spreads the{' '}
              <Term k="bot">scraper</Term> across all three, so it gets 5 through each: <strong>15 per window</strong>, three times the limit.
            </p>
            <p>
              Switch to a <strong>shared counter</strong>. Every gateway now asks <Term k="redis">Redis</Term> (the violet pulses), which keeps one count per
              client for the whole fleet. The limit holds at 5, for the price of a network round trip per request, well under a millisecond in one data
              center.
            </p>
          </>
        ),
        aside: (
          <>
            If Redis goes down, choose: fail open (allow everything) or fail closed (reject everything). Most APIs fail open, often with a looser local
            limit in each gateway as a backstop.
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Where does each gateway keep its count?',
          initial: 0,
          options: [
            { label: 'Local counters', apply: (s) => s.setStore('local'), note: <>Each gateway counts alone. The scraper gets 5 per gateway.</> },
            { label: 'Shared, in Redis', apply: (s) => s.setStore('redis'), note: <>One count for the whole fleet. The scraper gets 5, total.</> },
          ],
        },
        hud: ['botWindow', 'redis'],
        legend: [L.bot, L.alice, L.ok, L.r429, L.redis],
        code: {
          title: 'gateway.js',
          lang: 'js',
          code: `
// every gateway runs this, against one Redis
const win = Math.floor(Date.now() / 10_000);
const key = \`rl:\${ip}:\${win}\`;
!const n = await redis.incr(key);  // atomic +1
!if (n === 1) await redis.expire(key, 10);
if (n > 5) return tooManyRequests(res);`,
          note: 'In production, send INCR and EXPIRE together (MULTI or a Lua script), so a crash between them can’t leave a counter that never expires.',
        },
      },
      {
        id: 'atomic-counters',
        title: 'Count atomically',
        cfg: { scene: 'race', race: 'getset', strip: 'off', clients: [] },
        predict: 1,
        predictPrompt: 'Both gateways read 4, and the limit is 5. How many of the two requests get through?',
        body: (
          <>
            <p>
              A shared counter hides a trap. The scraper has used 4 of its 5. Two more of its requests arrive at the same moment, one at gw-1 and one at
              gw-2. Each gateway reads the count from Redis, checks it, then writes it back.
            </p>
            <p>
              Between one gateway&apos;s read and its write, the other reads the same stale value: a <strong>race condition</strong>. It happens most under
              heavy traffic, exactly when the limit matters. (Slowed down here: the real exchange takes about a millisecond.)
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: (
            <>
              The fix: make check-and-count <strong>one step inside Redis</strong>.
            </>
          ),
          initial: 0,
          options: [
            { label: 'GET, then SET', apply: (s) => s.setRace('getset'), note: <>Read, decide, write: a gap where another gateway can sneak in. Both get through.</> },
            {
              label: 'INCR',
              apply: (s) => s.setRace('incr'),
              note: (
                <>
                  <code>INCR</code> adds one and returns the new value atomically. gw-1 gets 5 and allows; gw-2 gets 6 and sends a 429.
                </>
              ),
            },
          ],
        },
        legend: [L.req, { label: 'reply', color: SIG.res }, L.r429],
        code: {
          title: 'token_bucket.lua',
          lang: 'sql',
          code: `
-- KEYS[1] bucket · ARGV cap, rate/s, now ms
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local b = redis.call('HMGET', KEYS[1],
                     'tokens', 'ts')
local tokens = tonumber(b[1]) or cap
local ts = tonumber(b[2]) or now
!tokens = math.min(cap,
!  tokens + (now - ts) / 1000 * rate)
local ok = tokens >= 1
if ok then tokens = tokens - 1 end
redis.call('HSET', KEYS[1],
           'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], 60000)
return ok and 1 or 0`,
          note: 'More state than one counter, like a token bucket? Run the whole check as a Lua script (EVALSHA): Redis executes it without interleaving any other command.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    cfg: { algo: 'token', key: 'client', capacity: 5, rate: 1, limit: 5, window: 10, strip: 'hist', clients: patternClients('abusive') },
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        body: (
          <p>
            Everything in one picture: a token bucket per client in front of the API. Alice and Bob sail through; the scraper gets one request a second and
            a steady stream of 429s.
          </p>
        ),
        extra: <CheatSheet />,
        hud: ['allowed', 'rejected'],
        legend: [L.alice, L.bob, L.bot, L.ok, L.r429],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { algo: 'fixed', key: 'global', limit: 10, window: 10 },
        body: (
          <p>
            Your sandbox. It starts where the lesson did: one global fixed window, and the scraper is back. Pick the traffic, the algorithm and what the
            limiter counts together, then tune the numbers. Each of the three challenges needs a different idea from this lesson.
          </p>
        ),
        interaction: { kind: 'playground' },
        hud: ['allowed', 'rejected'],
        legend: [L.alice, L.bob, L.bot, L.ok, L.r429],
      },
    ],
  },
];
