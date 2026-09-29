/**
 * Things the real-software checks in verify/ caught, and what changed in the
 * lesson as a result. Shown on /tested. Add an entry whenever a check forces a fix.
 */
export interface Catch {
  lesson: string;
  step?: string;
  /** What the real program did that the lesson got wrong */
  found: string;
  /** What changed */
  fixed: string;
}

export const CAUGHT: Catch[] = [
  {
    lesson: 'load-balancing',
    step: 'a-server-crashes',
    found:
      'The animation said users get 502 Bad Gateway while a crashed server is still in rotation. Real HAProxy answers 503 Service Unavailable, after retrying the dead server three times, a second apart.',
    fixed: 'The animation now shows the three retries, then the 503.',
  },
  {
    lesson: 'load-balancing',
    step: 'playground',
    found:
      'Crashing a server in the playground produced a steady stream of errors. Real NGINX, running the exact config the playground shows, served every request: it retries the next server and skips the dead one for 10 seconds.',
    fixed: 'The playground now fails over the way NGINX does, and all servers down gives 502, as on the real thing.',
  },
  {
    lesson: 'load-balancing',
    step: 'enter-the-load-balancer',
    found: 'Three nginx.conf examples used listen 443 ssl without a certificate. nginx refuses to start with that config.',
    fixed: 'Added the ssl_certificate lines.',
  },
  {
    lesson: 'load-balancing',
    step: 'health-checks',
    found: 'The HAProxy example had no balance line. Since HAProxy 3.3 the default is random, not the least connections the animation shows.',
    fixed: 'The example now says balance leastconn.',
  },
  {
    lesson: 'load-balancing',
    step: 'sticky-sessions',
    found: 'NGINX’s ip_hash only reads the first three numbers of an IPv4 address, so Alice and Carol (both 198.51.100.x) always land on the same server.',
    fixed: 'The lesson says so next to its simplified hash.',
  },
  {
    lesson: 'rate-limiting',
    step: 'burst-then-trickle',
    found: 'The nginx example said a 10 MB zone remembers about 160,000 client IPs. Fed 200,000 addresses, real nginx kept about 81,000: each entry takes 128 bytes on a 64-bit machine.',
    fixed: 'The note now says about 80,000.',
  },
  {
    lesson: 'rate-limiting',
    step: 'backoff-and-jitter',
    found:
      'The retry example multiplied Retry-After by 1000. When the header is an HTTP date, which the lesson says it can be, that gives NaN, and the client retried at once instead of waiting.',
    fixed: 'The example now handles both forms, and runs against servers that send each.',
  },
  {
    lesson: 'cdn',
    step: 'hit-ratio',
    found:
      'The CDN lesson animates stale-while-revalidate: a stale copy goes out at once while the edge checks with the origin (a 304). Real nginx, with the edge config as printed, re-downloaded the whole file and made the visitor wait.',
    fixed: 'Added proxy_cache_revalidate and proxy_cache_background_update. With them, nginx matches the animation request for request.',
  },
  {
    lesson: 'cdn',
    step: 'cache-control',
    found: 'The animation keeps a no-cache response and revalidates it before reuse. nginx never stores a no-cache response at all: every request went to the origin in full.',
    fixed: 'The lesson now says caches differ here, and what nginx does.',
  },
  {
    lesson: 'http-versions',
    step: 'playground',
    found: 'The same missing certificate broke examples in the CDN and TLS lessons, and all 8 configs the HTTP versions playground can print: nginx refused every one.',
    fixed: 'Added the certificate lines; all 8 now load.',
  },
  {
    lesson: 'consistent-hashing',
    found:
      'The note said plain hash (without consistent) remaps nearly every URI on any server change. Editing the server list moved about 4 in 5, but a crashed server that stays in the list only lost its own keys.',
    fixed: 'The note now says both.',
  },
  {
    lesson: 'event-loop',
    step: 'every-click-is-a-task',
    found: 'The lesson said tasks run first come, first served. In real Chrome, a click that arrived after a timer had come due still ran before the timer: browsers favor input.',
    fixed: 'The text and the simulation now let a waiting click go ahead of timers, as Chrome does.',
  },
  {
    lesson: 'event-loop',
    step: 'break-it-up',
    found:
      'The lesson said scheduler.yield() does the job "even better". Running the lesson’s own code in Chrome, clicks did get through and the work finished sooner, but only 34 to 39 of 90 frames were painted.',
    fixed: 'The lesson now states the trade-off. The simulation also clamped nested timers one call too early; it now matches Chrome.',
  },
  {
    lesson: 'event-loop',
    step: 'the-microtask-queue',
    found: 'The MutationObserver example never fires: it creates the observer but never calls observe(). The cheat sheet’s “nextTick runs before promise microtasks” is also false in an ES module.',
    fixed: 'Added the observe() call and reworded the cheat sheet.',
  },
  {
    lesson: 'hash-tables',
    step: 'hash-function',
    found: 'The note said Math.imul(h, 31) reproduces Java’s String.hashCode(). On its own it doesn’t: for "xfjfxtz" it gives 2147483668, Java gives -2147483628.',
    fixed: 'The note now shows the full expression, which matches Java on every test string.',
  },
  {
    lesson: 'replication',
    step: 'writes-that-vanish',
    found:
      'This step exists to show async replication losing a confirmed write when the leader crashes. Run headlessly, the animation lost none: the follower was never far enough behind. A real async PostgreSQL pair lost 2 confirmed writes in the same crash.',
    fixed: 'The follower now lags as a real one does, so the crash always loses a write.',
  },
  {
    lesson: 'replication',
    step: 'dont-go-back-in-time',
    found: 'This step shows a reader seeing time go backwards when refreshes hit different followers. The animation could never do it: its lag was shorter than the time between refreshes. Real followers did (125 → 105 → 125).',
    fixed: 'The lagging follower is now far enough behind that it happens, several times a minute.',
  },
  {
    lesson: 'replication',
    step: 'fencing',
    found: 'The pg_rewind command, as shown, brought the old leader back as a writable leader again: a second split brain.',
    fixed: 'Added --write-recovery-conf, and a note that pg_rewind needs wal_log_hints (or checksums) set before the failover.',
  },
  {
    lesson: 'replication',
    step: 'one-sync-rest-async',
    found: 'MySQL refused to start with the semi-sync settings as shown: the plugin has to be loaded first.',
    fixed: 'Added the plugin-load-add lines for the source and the replica.',
  },
  {
    lesson: 'replication',
    step: 'multi-leader',
    found: 'Two MySQL leaders with the lesson’s settings took two concurrent deposits and ended at different balances (120 and 150), with no error anywhere. MySQL doesn’t resolve conflicts.',
    fixed: 'The note now says so.',
  },
  {
    lesson: 'sharding',
    step: 'transactions',
    found: 'The two-phase commit step said anything that touches the locked rows is stuck. In PostgreSQL a plain SELECT came back in 2 ms, with the old balances.',
    fixed: 'It now says writes are stuck and plain reads still see the old balances.',
  },
  {
    lesson: 'caching',
    step: 'playground',
    found: 'The caching playground prints a live redis.conf. Real Redis refused to start with it: redis.conf doesn’t allow a comment after a setting, and a SET command sat among the settings.',
    fixed: 'Comments now sit on their own lines. All 576 configs the playground can print start a real server.',
  },
  {
    lesson: 'caching',
    step: 'which-key-goes',
    found:
      'The lesson evicts by exact LRU. Real Redis samples a few keys instead: on the lesson’s ten reads, 30 runs with the default settings gave 15 to 17 different outcomes, and only 1 matched the lesson. Some evicted a key the moment it was written.',
    fixed: 'A new aside shows what Redis actually does, and that raising maxmemory-samples to 10 made every run match.',
  },
  {
    lesson: 'caching',
    step: 'lru-lfu-fifo',
    found:
      'Redis has no FIFO policy, and the playground stood in allkeys-random, whose hit ratio swung between 56% and 62.5%. Measured instead: volatile-ttl with the same TTL on every key matched FIFO in 8 of 8 runs. The LFU example’s counter numbers were off too.',
    fixed: 'The playground now uses volatile-ttl for FIFO, and the LFU comments show measured counts: about 10 after 100 reads, 255 by a million.',
  },
  {
    lesson: 'hash-tables',
    step: 'lookup-race',
    found: 'The Redis example said small hashes stay a flat list up to 128 entries “because that is faster”. Redis 7.2.5’s default is 512, and the flat list isn’t faster: it uses a third of the memory and slows down as it grows.',
    fixed: 'The example now shows 512 and says what the flat list really buys.',
  },
];
