import type { LessonMeta } from '@/components/lesson/LessonStage';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { CheatSheet } from './panel';
import type { AutoItem, DnsSim } from './sim';
import type { Chapter } from './types';
import type { RRType } from './zones';

export const META: LessonMeta = { slug: 'dns', code: 'NET-04', track: 'Networking', title: 'DNS Resolution' };

const FLOW = ['laptop', 'resolver', 'root', 'tld', 'auth'];
const FLOW_CDN = [...FLOW, 'cdn'];

const alice = (q: string, t?: RRType): AutoItem => ({ c: 'laptop', q, t });
const bob = (q: string, t?: RRType): AutoItem => ({ c: 'bob', q, t });

/** The resolver already knows the way to these zones (learned a while ago). */
const knows =
  (...zones: string[]) =>
  (s: DnsSim) => {
    for (const z of zones) s.seedZone(z);
  };

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'names',
    title: 'Names and numbers',
    steps: [
      {
        id: 'names-for-people',
        title: 'Names for people, numbers for machines',
        cfg: {
          cast: ['laptop', 'resolver', 'web'],
          blackBox: true,
          http: true,
          resolverTitle: 'DNS',
          auto: { list: [alice('shop.example')], every: 2.4, seq: true, loop: true, first: 0.6 },
        },
        body: (
          <>
            <p>
              You type <code>shop.example</code> into your browser. Names are for people: easy to remember, easy to type, and they stay the same when the
              shop moves to new servers.
            </p>
            <p>
              Computers find each other by <strong>IP address</strong>, like <code>203.0.113.10</code>. So before your browser can send a single byte to the
              shop, it has to turn the name into an address. Watch <Term k="laptop">Alice’s laptop</Term> ask first, then connect.
            </p>
            <p>
              That lookup is the job of the <Term k="resolver">Domain Name System</Term>, DNS. It runs before almost every connection you make, and you
              rarely notice it. This lesson opens it up.
            </p>
          </>
        ),
        callouts: [{ target: 'web', text: <>the shop lives at <b>203.0.113.10</b></>, dir: 'down' }],
        legend: ['query', 'answer', 'http'],
        code: {
          title: 'terminal',
          lang: 'dig',
          code: `$ dig +short shop.example\n!203.0.113.10`,
          note: 'dig is the classic tool for asking DNS questions. +short prints just the answer.',
        },
      },
      {
        id: 'a-phone-book-nobody-owns',
        title: 'A phone book nobody owns',
        cfg: { view: 'tree', cast: ['root', 'com', 'org', 'tld', 'dev', 'auth', 'cdn'] },
        body: (
          <>
            <p>
              DNS is often called the internet’s phone book, but no single server holds the whole book. There are over 360 million registered domains, their
              owners change records whenever they like, and one server answering every lookup on Earth would be a bottleneck and a single point of failure.
            </p>
            <p>
              So names form a <strong>tree</strong>, split into <strong>zones</strong> run by different people. The <Term k="root">root</Term> knows only
              where to find the servers for each top-level domain (TLD), like <code>.com</code> or <code>.dev</code>. Each <Term k="tld">TLD</Term> knows only
              where to find the servers for each domain under it. And the owner of <Term k="auth">shop.example</Term> runs the servers that hold its actual
              records.
            </p>
            <p>
              Handing a branch of the tree to someone else is called <strong>delegation</strong>. It’s also why you read a name from right to left:{' '}
              <code>shop.example.</code> is <em>shop</em>, inside <em>example</em>, inside the root, the invisible dot at the end.
            </p>
            <Aside>
              <code>.example</code> is reserved for documentation, so it isn’t really in the root. In this lesson it plays the part of a TLD like{' '}
              <code>.com</code>, and everything works exactly the same way.
            </Aside>
          </>
        ),
        callouts: [{ target: 'L:leaves', text: <>the actual records live <b>at the leaves</b></>, dir: 'down' }],
        code: {
          title: 'who runs .com?',
          lang: 'dig',
          code: `$ dig +short NS com.\na.gtld-servers.net.\nb.gtld-servers.net.\n; … 13 names in all …\nm.gtld-servers.net.`,
          note: 'A TLD is just another zone. Verisign runs the servers for .com; other registries run other TLDs.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'cast',
    title: 'The cast',
    steps: [
      {
        id: 'the-stub-resolver',
        title: 'Your laptop asks just one server',
        cfg: {
          cast: FLOW,
          blackBox: true,
          dig: true,
          dock: 'dig',
          auto: { list: [alice('shop.example'), alice('cdn.example'), alice('api.shop.example')], every: 1.6, seq: true, loop: true, first: 0.5 },
        },
        focus: ['laptop', 'resolver'],
        body: (
          <>
            <p>
              Your laptop doesn’t walk that tree itself. Its operating system has a tiny <Term k="laptop">stub resolver</Term> that can do exactly one thing:
              send the question to a <Term k="resolver">recursive resolver</Term> and wait for the final answer.
            </p>
            <p>
              The recursive resolver does the legwork. Usually your ISP runs it, and your laptop learns its address from the network (DHCP) when it joins.
              Plenty of people pick a public one instead, like Cloudflare’s <code>1.1.1.1</code> or Google’s <code>8.8.8.8</code>.
            </p>
            <p>
              Look at the query in the card. It sets the <strong>rd</strong> flag, <em>recursion desired</em>: “find me the final answer, however many steps
              it takes.”
            </p>
          </>
        ),
        callouts: [{ target: 'L:resolver', text: <>does <b>all the legwork</b></>, dir: 'down' }],
        legend: ['query', 'answer'],
        code: {
          title: '/etc/resolv.conf',
          lang: 'conf',
          code: `# where the stub sends every question
!nameserver 192.0.2.53   # ISP resolver (DHCP)
nameserver 1.1.1.1      # public backup
options timeout:2 attempts:2`,
          note: 'On many Linux machines this says 127.0.0.53: that’s systemd-resolved, a local caching stub that forwards to the real resolver.',
        },
      },
      {
        id: 'the-name-servers',
        title: 'Root, TLD and authoritative servers',
        cfg: {
          cast: FLOW,
          resCache: false,
          rootLetters: true,
          auto: { list: [alice('shop.example')], every: 1.2, seq: true, loop: true, first: 0.5 },
        },
        focus: ['resolver', 'root', 'tld', 'auth'],
        body: (
          <>
            <p>
              The resolver talks to three kinds of <strong>name servers</strong>, one for each level of the tree. None of them searches on anyone’s behalf:
              each answers only from the data it holds.
            </p>
            <p>
              The <Term k="root">root servers</Term> know where every TLD’s servers are. There are 13 root server names, <code>a.root-servers.net</code>{' '}
              through <code>m.root-servers.net</code>, run by 12 organizations. Each name is served by many machines around the world sharing one address (
              <strong>anycast</strong>), so your query reaches a nearby copy. Well over a thousand machines in all.
            </p>
            <p>
              The <Term k="tld">TLD servers</Term> for <code>.example</code> know which servers are responsible for each domain registered under it. The{' '}
              <Term k="auth">authoritative servers</Term> for <code>shop.example</code> hold its actual records. The domain’s owner runs them, or more often a
              DNS provider does.
            </p>
          </>
        ),
        callouts: [{ target: 'L:letters', text: <><b>13 names</b>, 1,000+ machines</>, dir: 'left' }],
        legend: ['query', 'referral', 'answer'],
        code: {
          title: 'named.root (root hints)',
          lang: 'zone',
          code: `; the one thing every resolver knows in advance
.                     3600000  NS    A.ROOT-SERVERS.NET.
!A.ROOT-SERVERS.NET.   3600000  A     198.41.0.4
A.ROOT-SERVERS.NET.   3600000  AAAA  2001:503:ba3e::2:30
.                     3600000  NS    B.ROOT-SERVERS.NET.
; … and so on, through M.ROOT-SERVERS.NET.`,
          note: 'A fresh resolver starts from this file, asks one root server for the current list, and caches it.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'lookup',
    title: 'One lookup, start to finish',
    cfg: { cast: FLOW },
    steps: [
      {
        id: 'follow-a-lookup',
        title: 'Follow one lookup',
        cfg: { dig: true, cacheTable: true, dock: 'dig', pace: 1.3, think: 1.0, auto: { list: [alice('shop.example')], every: 99, seq: true, first: 0.6 } },
        body: (
          <>
            <p>
              Here is a complete lookup of <code>shop.example</code>, slowed way down. The card shows every message the way <code>dig</code> prints it, and
              the resolver’s cache starts empty.
            </p>
            <p>
              The resolver starts at the top. A <Term k="root">root server</Term> says “ask the <code>.example</code> servers”. The{' '}
              <Term k="tld">.example server</Term> says “ask <code>ns1.shop.example</code>”. And <Term k="auth">ns1.shop.example</Term> finally answers:{' '}
              <code>203.0.113.10</code>.
            </p>
            <p>Every server was asked the same question. Only the last one knew the answer. Watch the cache fill up as the resolver learns.</p>
            <Aside>
              Packets are slowed way down; the HUD shows real-world timing, about 109 ms for this cold lookup. Many resolvers also trim each question to what
              that server needs (QNAME minimization), so the root only hears <code>example.</code>
            </Aside>
          </>
        ),
        hud: ['time', 'trips'],
        legend: ['query', 'referral', 'answer'],
        code: {
          title: 'dig +trace',
          lang: 'dig',
          code: `$ dig +trace shop.example
.              518400  IN  NS  a.root-servers.net.
; … 12 more root servers
;; Received 239 bytes from 192.0.2.53#53(192.0.2.53) in 14 ms

!example.       172800  IN  NS  a.nic.example.
example.       172800  IN  NS  b.nic.example.
;; Received 109 bytes from 198.41.0.4#53(a.root-servers.net) in 20 ms

!shop.example.  172800  IN  NS  ns1.shop.example.
shop.example.  172800  IN  NS  ns2.shop.example.
;; Received 109 bytes from 192.0.2.30#53(a.nic.example) in 31 ms

!shop.example.  300     IN  A   203.0.113.10
;; Received 57 bytes from 203.0.113.53#53(ns1.shop.example) in 44 ms`,
          note: '+trace makes dig do the resolver’s job itself, starting from the root, so you can see each referral. Real output also includes DNSSEC signatures, trimmed here.',
        },
      },
      {
        id: 'referrals-and-glue',
        title: 'Referrals and glue',
        cfg: { dig: true, cacheTable: true, dock: 'dig', holdKinds: ['referral'], auto: { list: [alice('shop.example')], every: 99, seq: true, first: 0.5 } },
        body: (
          <>
            <p>
              The root didn’t answer the question. It sent a <strong>referral</strong>: an empty answer section, plus an <strong>authority</strong> section
              with <code>NS</code> records naming the servers that know more.
            </p>
            <p>
              But a name isn’t an address. To reach <code>a.nic.example</code>, the resolver would first have to look it up by asking the{' '}
              <code>.example</code> servers, which is exactly who it’s trying to find. So the referral also carries their addresses in the{' '}
              <strong>additional</strong> section. These helper records are called <strong>glue</strong>.
            </p>
            <p>
              The lookup now pauses at each referral. Every one moves the resolver a level down the tree, and it caches both the NS records and the glue.
            </p>
            <Aside>
              If a domain’s name servers live under a different domain, say <code>ns1.dnshost.net</code>, there’s no glue. The resolver looks their address
              up separately, usually from its cache.
            </Aside>
          </>
        ),
        interaction: { kind: 'continue', prompt: 'The lookup stops at every referral. Read the card, then continue.' },
        callouts: [{ target: 'L:dig-glue', text: <><b>glue</b>: the address that comes with the name</>, dir: 'right' }],
        hud: ['trips'],
        legend: ['query', 'referral', 'answer'],
        code: {
          title: 'ask a root server directly',
          lang: 'dig',
          code: `$ dig @a.root-servers.net shop.example +norecurse +noedns
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 20931
;; flags: qr; QUERY: 1, ANSWER: 0, AUTHORITY: 2, ADDITIONAL: 2

;; AUTHORITY SECTION:
!example.         172800  IN  NS  a.nic.example.
!example.         172800  IN  NS  b.nic.example.

;; ADDITIONAL SECTION:
!a.nic.example.   172800  IN  A   192.0.2.30
!b.nic.example.   172800  IN  A   198.51.100.30`,
          note: 'No answer and no aa flag: that’s how you recognize a referral. Real referrals often list many name servers; resolvers pick one, usually the fastest.',
        },
      },
      {
        id: 'where-next',
        title: 'Your turn: where does it go next?',
        predict: 3,
        predictPrompt: 'Which server does the resolver ask next?',
        cfg: {
          dig: true,
          cacheTable: true,
          dock: 'dig',
          predict: 'hops',
          auto: { list: [alice('shop.example'), alice('api.shop.example'), alice('mail.shop.example')], every: 1.8, seq: true, loop: true, flush: true, first: 0.6 },
        },
        body: (
          <>
            <p>
              Your turn. The resolver’s cache is empty. Each time it is about to send a query, the animation pauses. <strong>Click the server you think it
              asks next.</strong>
            </p>
            <p>Use what the resolver knows at that moment: what’s in its cache, and the last message it received, shown in the card.</p>
          </>
        ),
        hud: ['trips'],
        legend: ['query', 'referral', 'answer'],
      },
      {
        id: 'recursive-vs-iterative',
        title: 'Recursive vs iterative',
        cfg: { view: 'seq', cast: [] },
        body: (
          <>
            <p>That lookup hid two different kinds of question.</p>
            <p>
              Your laptop asked a <strong>recursive</strong> query: <em>get me the final answer, however many steps it takes</em>. It sent one message and
              waited (the pink bar).
            </p>
            <p>
              The resolver asked <strong>iterative</strong> queries: <em>tell me what you know</em>. Each server answers from its own data, with the answer or
              a referral, and never goes off to ask anyone else. Only the resolver walks the tree (the violet bar).
            </p>
            <p>
              Time runs downward, to scale: the longer a message takes, the further down it lands. The whole walk took 109 ms, almost all of it waiting on the
              network.
            </p>
          </>
        ),
        legend: ['query', 'referral', 'answer'],
        code: {
          title: 'the flags tell you',
          lang: 'dig',
          code: `$ dig shop.example
!;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

$ dig @ns1.shop.example shop.example
;; flags: qr aa rd; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1
!;; WARNING: recursion requested but not available`,
          note: 'rd: you asked for recursion. ra: this server offers it. An authoritative server answers (aa) but won’t recurse for you.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'caching',
    title: 'Caching',
    steps: [
      {
        id: 'the-second-lookup',
        title: 'The second lookup is instant',
        cfg: {
          cast: ['laptop', 'bob', 'resolver', 'root', 'tld', 'auth'],
          cacheTable: true,
          stubTable: true,
          stubCache: true,
          dock: 'cache',
          auto: { list: [bob('shop.example'), alice('shop.example')], every: 2.2, seq: true, loop: true, first: 6 },
        },
        script: [
          {
            at: 0.5,
            run: (s) =>
              s.startLookup('laptop', 'shop.example', 'A', () =>
                s.after(0.9, () => s.startLookup('bob', 'shop.example', 'A', () => s.after(1.1, () => s.startLookup('laptop', 'shop.example')))),
              ),
          },
        ],
        body: (
          <>
            <p>
              The resolver keeps every record it learns in its <Term k="cache">cache</Term>, along with a <strong>TTL</strong> (time to live): how many
              seconds it may reuse it. The zone’s owner sets the TTL. For <code>shop.example</code>’s address it’s 300, five minutes.
            </p>
            <p>
              So when <Term k="bob">Bob</Term> asks for <code>shop.example</code> right after Alice, the resolver answers straight from its cache. One round
              trip instead of four: 14 ms instead of 109. A busy resolver serving thousands of people answers most questions this way.
            </p>
            <p>
              Caches exist on your side too. Alice’s operating system (and her browser) keep their own, so when <Term k="laptop">Alice</Term> asks again, the
              answer never even leaves her laptop.
            </p>
          </>
        ),
        hud: ['alice', 'bob', 'hits'],
        legend: ['query', 'referral', 'answer'],
        code: {
          title: 'the same lookup, twice',
          lang: 'dig',
          code: `$ dig shop.example
!shop.example.   300  IN  A  203.0.113.10
;; Query time: 109 msec

$ dig shop.example        # ten seconds later
!shop.example.   290  IN  A  203.0.113.10
;; Query time: 14 msec`,
          note: 'Same answer, a lower TTL, and 8× faster: the second one came from the resolver’s cache.',
        },
      },
      {
        id: 'cached-referrals',
        title: 'Cached referrals skip the root',
        predict: 3,
        predictPrompt: 'Where does the resolver send its first query for this name?',
        cfg: {
          cast: FLOW_CDN,
          cacheTable: true,
          dock: 'cache',
          predict: 'first',
          auto: {
            list: [alice('cdn.example'), alice('api.shop.example'), alice('shop.example'), alice('static.cdn.example'), alice('mail.shop.example')],
            every: 1.5,
            seq: true,
            loop: true,
            wrapFlushAnswers: true,
            first: 0.8,
          },
        },
        setup: (s) => {
          s.seedZone('example');
          s.seedZone('shop.example');
          s.seedAnswer('shop.example', 'A', 240);
        },
        body: (
          <>
            <p>
              The resolver caches more than final answers. It also kept the <strong>referrals</strong>: who serves <code>.example</code> and who serves{' '}
              <code>shop.example</code>. NS records like these usually live for a day or two, which is why root servers see only a small slice of all
              lookups.
            </p>
            <p>
              So a new name doesn’t send it back to the root: it starts at the <strong>closest zone it already knows</strong>. The shop’s page pulls images
              from <code>cdn.example</code> and data from <code>api.shop.example</code>. <strong>Predict where each lookup starts.</strong>
            </p>
          </>
        ),
        hud: ['trips', 'root'],
        legend: ['query', 'referral', 'answer'],
      },
      {
        id: 'ttl-countdown',
        title: 'TTL: every answer expires',
        cfg: {
          cast: FLOW,
          cacheTable: true,
          dock: 'cache',
          pace: 0.8,
          auto: { list: [alice('shop.example')], every: 0.9, seq: true, loop: true, first: 0.5 },
        },
        setup: (s) => {
          s.setTtlA(20);
          s.seedZone('example');
          s.seedZone('shop.example');
        },
        focus: ['laptop', 'resolver', 'auth'],
        body: (
          <>
            <p>
              Every cached record counts down. When its TTL hits zero the resolver throws it away, and the next person who asks triggers a fresh query to{' '}
              <Term k="auth">ns1.shop.example</Term>.
            </p>
            <p>
              Drag the TTL and watch the trade-off. A <strong>short TTL</strong> gets changes to users quickly, but means more queries for the authoritative
              server and more lookups waiting on the network. A <strong>long TTL</strong> gives fast, cheap answers, but a change can take that long to be
              seen. Typical values run from 300 seconds (five minutes) to 86400 (a day).
            </p>
            <Aside>
              Real TTLs are minutes to days; here they’re seconds so you can watch them run out. A new TTL only applies when the record is next fetched.
            </Aside>
          </>
        ),
        interaction: { kind: 'ttl', prompt: 'Set the TTL on shop.example’s A record:', min: 5, max: 60, initial: 20 },
        hud: ['hits', 'misses', 'auth'],
        legend: ['query', 'answer'],
        code: {
          title: 'zone file: shop.example',
          lang: 'zone',
          code: `; name           TTL   class  type  value
!shop.example.    300   IN     A     203.0.113.10`,
        },
      },
      {
        id: 'negative-caching',
        title: 'Remembering “no such name”',
        cfg: { cast: ['laptop', 'bob', 'resolver', 'root', 'tld', 'auth'], cacheTable: true, dig: true, dock: 'cache' },
        setup: (s) => {
          s.seedZone('example');
          s.seedZone('shop.example');
        },
        script: [
          {
            at: 0.6,
            run: (s) =>
              s.startLookup('laptop', 'shpo.example', 'A', () =>
                s.after(1.2, () =>
                  s.startLookup('bob', 'shpo.example', 'A', () =>
                    s.after(1.6, () => s.startLookup('bob', 'sale.shop.example', 'A', () => s.after(1.2, () => s.startLookup('laptop', 'sale.shop.example')))),
                  ),
                ),
              ),
          },
        ],
        body: (
          <>
            <p>
              Typos happen. Alice types <code>shpo.example</code>. The resolver already knows the <code>.example</code> servers, so it asks them directly, and
              they reply <strong>NXDOMAIN</strong>: no such domain.
            </p>
            <p>
              The reply carries the zone’s <strong>SOA</strong> record, whose last field says how long that “no” may be remembered. That’s{' '}
              <strong>negative caching</strong>. When <Term k="bob">Bob</Term> makes the same typo, the answer comes straight from the cache.
            </p>
            <p>
              It saves the servers a flood of repeated questions from typos and broken apps. The catch: if you create a name right after someone looked it up,
              they keep getting NXDOMAIN until the negative TTL runs out.
            </p>
          </>
        ),
        quiz: {
          question: 'Who told the resolver that shpo.example doesn’t exist?',
          options: [
            {
              text: 'A root server',
              why: 'The root only knows about TLDs, and .example exists. Besides, the resolver already had the .example referral cached, so it never asked the root.',
            },
            {
              text: 'The .example TLD servers',
              correct: true,
              why: 'They know every domain registered under .example. shpo.example isn’t one of them, so they answer NXDOMAIN along with the .example SOA record.',
            },
            {
              text: 'ns1.shop.example',
              why: 'It only answers for names inside shop.example. shpo.example is a different domain altogether, so the resolver never asks it.',
            },
          ],
        },
        hud: ['neg', 'trips'],
        legend: ['query', 'nx'],
        code: {
          title: 'a typo',
          lang: 'dig',
          code: `$ dig shpo.example
!;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 5810

;; AUTHORITY SECTION:
!example.  900  IN  SOA  a.nic.example. hostmaster.nic.example. 2026092601 1800 900 604800 900`,
          note: 'The negative TTL is the smaller of the SOA record’s own TTL and its last field: here, 900 seconds.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'changes',
    title: 'Changing a record',
    cfg: { view: 'move', cast: ['auth', 'r1', 'r2', 'r3', 'u1', 'u2', 'u3', 'web', 'web2'], http: true, labels: false },
    steps: [
      {
        id: 'moving-day',
        title: 'Moving the shop to a new server',
        setup: (s) => {
          s.setTtlA(30);
          s.seedMove();
        },
        body: (
          <>
            <p>
              You’re moving the shop to a new server at <code>203.0.113.80</code>, so you update the A record on <Term k="auth">ns1.shop.example</Term>.
              Done?
            </p>
            <p>
              Not quite. Three <Term k="resolvers">resolvers</Term> already have the old address cached, each with a different amount of time left. DNS has no
              “push”: nobody tells them the record changed. Each keeps handing out the old address until its copy expires, then asks again.
            </p>
            <p>
              That is all <strong>DNS propagation</strong> really is: caches around the world expiring at different times. Change the record, watch the{' '}
              <Term k="users">users</Term> move over one by one, and try shutting the old server down too early.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Change the A record',
              icon: 'bolt',
              run: (s) => s.moveSite(),
              after: (
                <>
                  The authoritative server now says <code>203.0.113.80</code>. Each resolver keeps serving the old address until its own copy runs out.
                </>
              ),
            },
            {
              label: 'Shut down the old server',
              icon: 'power',
              run: (s) => s.setWebDown(true),
              after: <>Anyone whose resolver still holds the old address now gets a failed page load. Keep it running until the old TTL has passed.</>,
            },
            { label: 'Start over', icon: 'replay', run: (s) => s.resetMove() },
          ],
        },
        hud: ['moved', 'since', 'errors'],
        legend: ['query', 'old', 'new'],
        code: {
          title: 'zone file: the change',
          lang: 'zone',
          code: `!shop.example.  30  IN  A  203.0.113.80   ; was 203.0.113.10`,
          note: 'Nothing is sent anywhere when you save this. The new answer only spreads as old copies expire.',
        },
      },
      {
        id: 'lower-the-ttl-first',
        title: 'The pro move: lower the TTL first',
        setup: (s) => {
          s.setTtlA(30);
          s.seedMove();
        },
        body: (
          <>
            <p>
              Operators have a standard playbook. A day or so before the move, <strong>lower the TTL</strong>, say from 3600 to 60 seconds. Then wait out the
              old TTL, so every cached copy gets refetched with the short one.
            </p>
            <p>
              Now change the address. The longest anyone can hold the old one is the new, short TTL. Once everything looks good, <strong>raise the TTL</strong>{' '}
              again so resolvers go back to caching it for longer.
            </p>
            <p>
              Try it on our compressed clock, where 30 seconds plays the part of an hour. Watch the <strong>Longest cached copy</strong> gauge before you
              press step 2.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          prompt: 'Run the playbook in order:',
          buttons: [
            {
              label: '1. Lower the TTL to 5 s',
              run: (s) => s.setTtlA(5),
              after: <>New copies expire after 5 s, but copies cached earlier still count down from 30. Wait for the gauge to drop to 5.</>,
            },
            {
              label: '2. Change the A record',
              run: (s) => s.moveSite(),
              after: <>Every resolver refetches within 5 seconds, so every user is on the new server almost at once.</>,
            },
            {
              label: '3. Raise the TTL again',
              run: (s) => s.setTtlA(30),
              after: <>Back to long, cheap caching, now pointing at the new address.</>,
            },
            { label: 'Start over', icon: 'replay', run: (s) => s.resetMove() },
          ],
        },
        quiz: {
          question: 'An A record has a TTL of 3600. You change the address at 12:00. When has every well-behaved resolver stopped handing out the old one?',
          options: [
            { text: 'Immediately', why: 'A resolver that cached it at 11:59 may keep using it for a full hour. Nothing tells it the record changed.' },
            {
              text: 'By about 13:00',
              correct: true,
              why: 'One TTL after the change, every cached copy has expired. Browser and OS caches add a little, but they’re usually short.',
            },
            {
              text: '24 to 48 hours later',
              why: 'That old rule of thumb comes from changing name servers, where the TLD’s NS records are cached for up to two days, plus resolvers that bend the rules. For an A record, the TTL is the limit.',
            },
          ],
        },
        hud: ['maxTtl', 'moved', 'since'],
        legend: ['query', 'old', 'new'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'records',
    title: 'Record types',
    steps: [
      {
        id: 'more-than-addresses',
        title: 'More than addresses',
        cfg: { cast: FLOW, dig: true, cacheTable: true, dock: 'dig' },
        setup: knows('example', 'shop.example'),
        script: [{ at: 0.5, run: (s) => s.query('shop.example', 'A') }],
        focus: ['laptop', 'resolver', 'auth'],
        body: (
          <>
            <p>
              A name can have many records, each with a <strong>type</strong>. Every query asks for a name <em>and</em> a type, and each type answers a
              different question.
            </p>
            <p>
              <code>A</code> gives an IPv4 address and <code>AAAA</code> an IPv6 one. <code>MX</code> says which servers accept email for the domain.{' '}
              <code>TXT</code> holds text, like ownership proofs and email policy. <code>NS</code> lists the zone’s name servers.
            </p>
            <p>
              Pick a type below. The resolver already knows the way, so it goes straight to <Term k="auth">ns1.shop.example</Term>.
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Ask for shop.example’s…',
          options: [
            { label: 'A', apply: (s) => s.query('shop.example', 'A'), note: <>The IPv4 address: four bytes, <code>203.0.113.10</code>.</> },
            {
              label: 'AAAA',
              apply: (s) => s.query('shop.example', 'AAAA'),
              note: <>The IPv6 address (“quad A”: four times as long). Browsers usually ask for A and AAAA at the same time.</>,
            },
            {
              label: 'MX',
              apply: (s) => s.query('shop.example', 'MX'),
              note: <>Where to deliver email for <code>@shop.example</code>. The number is a priority: the lowest one is tried first.</>,
            },
            {
              label: 'TXT',
              apply: (s) => s.query('shop.example', 'TXT'),
              note: <>Free-form text. This one is <strong>SPF</strong>: only the domain’s own MX servers may send its email.</>,
            },
            {
              label: 'NS',
              apply: (s) => s.query('shop.example', 'NS'),
              note: <>The zone’s own list of name servers, matching what the TLD handed out in its referral.</>,
            },
          ],
        },
        legend: ['query', 'answer'],
        code: {
          title: 'dig by type',
          lang: 'dig',
          code: `$ dig +short shop.example AAAA
2001:db8::10
$ dig +short shop.example MX
!10 mail.shop.example.
$ dig +short shop.example TXT
"v=spf1 mx -all"`,
        },
      },
      {
        id: 'cname-aliases',
        title: 'CNAME: an alias with a price',
        cfg: { cast: FLOW_CDN, dig: true, cacheTable: true, dock: 'dig' },
        setup: knows('example', 'shop.example'),
        script: [{ at: 0.6, run: (s) => s.query('www.shop.example') }],
        body: (
          <>
            <p>
              A <strong>CNAME</strong> record says “this name is an alias: look up that other name instead.” Here <code>www.shop.example</code> points to{' '}
              <code>shop.cdn.example</code>, where a CDN serves the shop.
            </p>
            <p>
              <Term k="auth">ns1.shop.example</Term> answers with the CNAME, and the resolver starts over for the new name. It lives in a different zone, so
              that takes another referral from the TLD and a question to another server, <Term k="cdn">ns1.cdn.example</Term>. Chains can be several links
              long, and on a cold cache every link can cost round trips.
            </p>
            <p>
              One rule: a name with a CNAME can’t have any other records. That’s why bare <code>shop.example</code> can’t be a CNAME: it needs its SOA and NS
              records. Many DNS providers offer a workaround called ALIAS or CNAME flattening.
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Where should www.shop.example point?',
          options: [
            {
              label: 'At the CDN',
              apply: (s) => {
                s.setWwwTarget('shop.cdn.example.');
                s.query('www.shop.example');
              },
              note: <>The target is in another zone: a referral and a second server. Three queries in total.</>,
            },
            {
              label: 'At shop.example',
              apply: (s) => {
                s.setWwwTarget('shop.example.');
                s.query('www.shop.example');
              },
              note: <>Same zone: ns1.shop.example follows the alias itself and returns the CNAME and the A record together. One query.</>,
            },
          ],
        },
        hud: ['time', 'trips'],
        legend: ['query', 'referral', 'cname', 'answer'],
        code: {
          title: 'following an alias',
          lang: 'dig',
          code: `$ dig www.shop.example
;; ANSWER SECTION:
!www.shop.example.   3600  IN  CNAME  shop.cdn.example.
!shop.cdn.example.   60    IN  A      198.51.100.8`,
          note: 'The resolver hands back the whole chain. Note the CDN’s short TTL: it wants to move traffic around quickly.',
        },
      },
      {
        id: 'the-zone-file',
        title: 'The zone file',
        cfg: {
          cast: ['laptop', 'resolver', 'auth'],
          zoneFile: true,
          dig: true,
          dock: 'zone',
          auto: {
            list: [
              alice('shop.example'),
              alice('shop.example', 'MX'),
              alice('www.shop.example', 'CNAME'),
              alice('api.shop.example'),
              alice('shop.example', 'TXT'),
              alice('sale.shop.example'),
              alice('shop.example', 'AAAA'),
              alice('shop.example', 'NS'),
            ],
            every: 1.1,
            seq: true,
            loop: true,
            wrapFlushAnswers: true,
            first: 0.5,
          },
        },
        setup: knows('example', 'shop.example'),
        body: (
          <>
            <p>
              Everything <Term k="auth">ns1.shop.example</Term> knows comes from one place: the <strong>zone file</strong> for <code>shop.example</code>, or
              a database playing the same role at a DNS provider. Watch the line that answers each query light up.
            </p>
            <p>
              The <strong>SOA</strong> (start of authority) record describes the zone itself. Its <strong>serial</strong> number goes up with every edit,
              which tells the secondary server, <code>ns2</code>, to copy the new version (a <strong>zone transfer</strong>). Its last field is the
              negative-caching TTL you met earlier.
            </p>
            <p>
              <code>@</code> means the zone’s own name, and names without a final dot are relative to it: <code>www</code> means{' '}
              <code>www.shop.example.</code>
            </p>
          </>
        ),
        legend: ['query', 'answer', 'nx'],
        code: {
          title: 'shop.example.zone',
          lang: 'zone',
          code: `$ORIGIN shop.example.
$TTL 3600                     ; default TTL
@     IN  SOA  ns1 hostmaster (
!               2026092601     ; serial: bump on every edit
               7200           ; refresh: how often ns2 checks
               3600           ; retry
               1209600        ; expire
!               300 )          ; negative-caching TTL
@     IN  NS    ns1
@     IN  NS    ns2
@ 300 IN  A     203.0.113.10
@ 300 IN  AAAA  2001:db8::10
@     IN  MX    10 mail
@     IN  TXT   "v=spf1 mx -all"
www   IN  CNAME shop.cdn.example.
api   300 IN A  203.0.113.11
mail  IN  A     203.0.113.25
ns1   IN  A     203.0.113.53
ns2   IN  A     198.51.100.54`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'wire',
    title: 'On the wire',
    steps: [
      {
        id: 'udp-port-53',
        title: 'One packet each way: UDP port 53',
        cfg: {
          cast: FLOW,
          dig: true,
          wire: true,
          dock: 'dig',
          resCache: false,
          clickDrop: true,
          auto: { list: [alice('shop.example'), alice('api.shop.example'), alice('mail.shop.example')], every: 1.4, seq: true, loop: true, first: 0.5 },
        },
        body: (
          <>
            <p>
              DNS messages are tiny. Alice’s query is 30 bytes and the answer 46. Each fits in a single <strong>UDP</strong> datagram sent to port{' '}
              <strong>53</strong>: no connection to set up, no handshake, one packet out and one back.
            </p>
            <p>
              UDP doesn’t promise delivery, so DNS handles loss itself: if no reply arrives in time, ask again, often a different server from the NS list.
              The 16-bit <strong>ID</strong> matches replies to questions. Resolvers also use a random source port for every query, so forged replies are
              hard to sneak in.
            </p>
            <p>
              <strong>Try it:</strong> click a packet in flight to drop it. Alice’s stub waits 2 seconds before retrying; resolvers use much shorter,
              adaptive timeouts.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          prompt: 'Click any packet on the stage to drop it, or:',
          buttons: [{ label: 'Drop the next packet', icon: 'x', run: (s) => s.dropNext() }],
        },
        hud: ['time', 'lost', 'retries'],
        legend: ['query', 'referral', 'answer'],
        code: {
          title: 'tcpdump',
          lang: 'dig',
          code: `$ sudo tcpdump -n -t port 53
!IP 198.51.100.42.53124 > 192.0.2.53.53: 4412+ A? shop.example. (30)
!IP 192.0.2.53.53 > 198.51.100.42.53124: 4412 1/0/0 A 203.0.113.10 (46)`,
          note: '4412 is the ID and + means rd. 1/0/0 counts the answer, authority and additional records. (30) and (46) are the sizes in bytes.',
        },
      },
      {
        id: 'tcp-for-big-answers',
        title: 'Too big for UDP? Switch to TCP',
        cfg: { cast: FLOW, dig: true, wire: true, dock: 'dig', stubEdns: false },
        setup: (s) => {
          s.setBigTxt(true);
          s.seedZone('example');
          s.seedZone('shop.example');
        },
        script: [{ at: 0.6, run: (s) => s.query('shop.example', 'TXT') }],
        focus: ['laptop', 'resolver', 'auth'],
        body: (
          <>
            <p>
              Some answers don’t fit. <code>shop.example</code> has a pile of TXT records, verification tokens for half a dozen services, over 700 bytes in
              all. Signed zones (DNSSEC) produce big answers too.
            </p>
            <p>
              Classic DNS over UDP allows 512 bytes. The <strong>EDNS</strong> extension lets each side advertise a bigger buffer, commonly 1232 bytes, which
              is how the resolver got the answer from <Term k="auth">ns1.shop.example</Term> in one piece.
            </p>
            <p>
              Alice’s stub doesn’t use EDNS, though. So the resolver replies with the <strong>TC</strong> (truncated) flag set, and the stub asks again over{' '}
              <strong>TCP</strong>, still port 53, which carries messages of any size (up to 64 KB). Every DNS server must support TCP; firewalls that only
              allow UDP port 53 break big lookups in confusing ways.
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Alice’s stub resolver…',
          options: [
            {
              label: 'Plain (512 bytes)',
              apply: (s) => s.retryBig(false),
              note: <>Over the limit: truncated, then retried over TCP.</>,
            },
            {
              label: 'With EDNS (1232)',
              apply: (s) => s.retryBig(true),
              note: <>It fits in one UDP datagram, so there’s no retry.</>,
            },
          ],
        },
        hud: ['size', 'time'],
        legend: ['query', 'answer', 'trunc', 'tcp'],
        code: {
          title: 'dig without EDNS',
          lang: 'dig',
          code: `$ dig +noedns shop.example TXT
!;; Truncated, retrying in TCP mode.
;; ANSWER SECTION:
shop.example.  3600  IN  TXT  "v=spf1 mx -all"
shop.example.  3600  IN  TXT  "example-site-verification=3f9a1c07…"
; … 8 more …
;; MSG SIZE  rcvd: 732`,
        },
      },
      {
        id: 'private-lookups',
        title: 'Who can read your lookups?',
        cfg: {
          cast: ['laptop', 'wifi', 'resolver', 'root', 'tld', 'auth'],
          dig: true,
          dock: 'snoop',
          auto: {
            list: [alice('shop.example'), alice('cdn.example'), alice('api.shop.example'), alice('www.shop.example')],
            every: 1.3,
            seq: true,
            loop: true,
            wrapFlushAnswers: true,
            first: 0.5,
          },
        },
        setup: knows('example', 'shop.example', 'cdn.example'),
        body: (
          <>
            <p>
              Classic DNS travels in plain text. Anyone on the path, like the café <Term k="wifi">Wi-Fi</Term> or your ISP, can read every name you look up.
              The log under the Wi-Fi shows exactly what it sees.
            </p>
            <p>
              <strong>DNS over TLS</strong> (DoT) and <strong>DNS over HTTPS</strong> (DoH) encrypt the conversation between your device and the resolver.
              Switch them on below and watch the log go dark.
            </p>
            <p>
              What they don’t hide: the <Term k="resolver">resolver</Term> still sees every name, so you’re choosing whom to trust. And its own queries to
              root, TLD and authoritative servers mostly still go out unencrypted.
            </p>
            <Aside>
              Two caveats. The browser’s next step, the TLS handshake, usually still reveals the name (SNI) unless Encrypted Client Hello is used. And DNSSEC
              is a different tool: it signs records so forged answers can be detected, but it hides nothing.
            </Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'How does Alice’s laptop reach the resolver?',
          options: [
            {
              label: 'Plain DNS',
              apply: (s) => s.setTransport('udp'),
              note: <>UDP port 53, unencrypted. Anyone on the path can read every name, and could even forge the answers.</>,
            },
            {
              label: 'DoT',
              apply: (s) => s.setTransport('dot'),
              note: <>DNS over TLS: the same messages inside an encrypted TLS connection on port 853. Private, but easy to spot (and block) by its port.</>,
            },
            {
              label: 'DoH',
              apply: (s) => s.setTransport('doh'),
              note: <>DNS over HTTPS: queries sent as HTTPS requests on port 443, blending in with ordinary web traffic. Browsers ship it built in.</>,
            },
          ],
        },
        legend: ['query', 'answer', 'enc'],
        code: {
          title: 'a DoH request',
          lang: 'http',
          code: `!GET /dns-query?dns=AAABAAABAAAAAAAABHNob3AHZXhhbXBsZQAAAQAB HTTP/2
Host: dns.isp.example
Accept: application/dns-message`,
          note: 'The dns= parameter is the same 30-byte query, base64url-encoded. The answer comes back as an ordinary HTTPS response.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: {
          cast: ['laptop', 'bob', 'resolver', 'root', 'tld', 'auth', 'cdn'],
          cacheTable: true,
          stubCache: true,
          dock: 'cache',
          pace: 0.7,
          think: 0.15,
          auto: {
            list: [
              alice('shop.example'),
              bob('shop.example'),
              alice('www.shop.example'),
              bob('api.shop.example'),
              alice('cdn.example'),
              bob('www.shop.example'),
              alice('api.shop.example'),
              bob('static.cdn.example'),
              alice('shpo.example'),
              bob('shop.example', 'MX'),
            ],
            every: 0.35,
            seq: true,
            loop: true,
            random: true,
            first: 0.3,
          },
        },
        body: (
          <p>
            Everything in one place, with Alice and Bob browsing in the background. Watch how fast the share of answers served from cache climbs, and how
            rarely anyone bothers a root server.
          </p>
        ),
        extra: <CheatSheet />,
        hud: ['lookups', 'hitRate', 'root'],
        legend: ['query', 'referral', 'answer', 'cname', 'nx'],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { cast: FLOW_CDN, dig: true, cacheTable: true, dock: 'cache' },
        script: [{ at: 0.6, run: (s) => s.query('shop.example') }],
        body: (
          <p>
            Your turn to drive. Look up any name, flush the caches, change the TTL, or switch caching off to see what the internet would be like without it.
            The challenges check your understanding.
          </p>
        ),
        interaction: { kind: 'playground' },
        hud: ['time', 'trips', 'hitRate'],
        legend: ['query', 'referral', 'answer', 'cname', 'nx'],
      },
    ],
  },
];
