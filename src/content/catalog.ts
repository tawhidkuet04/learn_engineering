export type TopicStatus = 'live' | 'drafting';

export interface Topic {
  slug: string;
  code: string;
  title: string;
  blurb: string;
  status: TopicStatus;
  steps?: number;
  minutes?: number;
}

export interface Track {
  id: string;
  title: string;
  intro: string;
  topics: Topic[];
}

export const TRACKS: Track[] = [
  {
    id: 'system-design',
    title: 'System design',
    intro: 'How big systems stay fast and stay up.',
    topics: [
      {
        slug: 'load-balancing',
        code: 'SD-01',
        title: 'Load Balancing',
        blurb: 'One address, many servers. Algorithms, health checks, sticky sessions, Layer 4 vs 7, and failover.',
        status: 'live',
        steps: 25,
        minutes: 25,
      },
      { slug: 'caching', code: 'SD-02', title: 'Caching', blurb: 'Cache-aside, TTLs, eviction, and why invalidation is famously hard.', status: 'live', steps: 19, minutes: 25 },
      { slug: 'cdn', code: 'SD-03', title: 'CDNs', blurb: 'Serve bytes from the edge, close to every user on the planet.', status: 'drafting' },
      { slug: 'consistent-hashing', code: 'SD-04', title: 'Consistent Hashing', blurb: 'Add a server and move only 1/N of the keys, not all of them.', status: 'live', steps: 19, minutes: 25 },
      { slug: 'replication', code: 'SD-05', title: 'Database Replication', blurb: 'Leaders, followers, failover, and the replication lag that bites.', status: 'drafting' },
      { slug: 'sharding', code: 'SD-06', title: 'Sharding', blurb: 'Split a database that no longer fits on one machine.', status: 'drafting' },
      { slug: 'rate-limiting', code: 'SD-07', title: 'Rate Limiting', blurb: 'Token buckets, leaky buckets and sliding windows, side by side.', status: 'drafting' },
      { slug: 'message-queues', code: 'SD-08', title: 'Message Queues', blurb: 'Decouple services, absorb spikes, and retry safely.', status: 'drafting' },
      { slug: 'cap', code: 'SD-09', title: 'CAP & Consistency', blurb: 'What a network partition forces you to choose.', status: 'drafting' },
    ],
  },
  {
    id: 'networking',
    title: 'Networking',
    intro: 'What actually happens between two computers.',
    topics: [
      { slug: 'life-of-a-request', code: 'NET-01', title: 'What happens when you hit Enter', blurb: 'From URL to pixels: DNS, TCP, TLS and HTTP in one journey.', status: 'live', steps: 20, minutes: 28 },
      { slug: 'osi-model', code: 'NET-02', title: 'The OSI Model', blurb: 'Watch data get wrapped layer by layer, sent, then unwrapped.', status: 'drafting' },
      { slug: 'tcp', code: 'NET-03', title: 'TCP Handshakes & Reliability', blurb: 'SYN, ACK, lost packets, retransmits and congestion control.', status: 'live', steps: 21, minutes: 40 },
      { slug: 'dns', code: 'NET-04', title: 'DNS Resolution', blurb: 'Root, TLD and authoritative servers in a single lookup.', status: 'drafting' },
      { slug: 'tls', code: 'NET-05', title: 'TLS & HTTPS', blurb: 'How two strangers agree on a secret while everyone listens.', status: 'live', steps: 21, minutes: 32 },
      { slug: 'http-versions', code: 'NET-06', title: 'HTTP/1.1 vs 2 vs 3', blurb: 'Head-of-line blocking, multiplexing and QUIC.', status: 'live', steps: 20, minutes: 32 },
      { slug: 'nat', code: 'NET-07', title: 'IP, Subnets & NAT', blurb: 'How billions of devices share a few billion addresses.', status: 'drafting' },
      { slug: 'websockets', code: 'NET-08', title: 'WebSockets', blurb: 'Keeping a line open for chat, games and live data.', status: 'drafting' },
    ],
  },
  {
    id: 'computer-science',
    title: 'Computer science',
    intro: 'The machinery under every program.',
    topics: [
      { slug: 'processes-threads', code: 'CS-01', title: 'Processes vs Threads', blurb: 'Isolation, shared memory and context switches.', status: 'drafting' },
      { slug: 'event-loop', code: 'CS-02', title: 'The Event Loop', blurb: 'How one thread juggles thousands of tasks.', status: 'live', steps: 19, minutes: 30 },
      { slug: 'hash-tables', code: 'CS-03', title: 'Hash Tables', blurb: 'Buckets, collisions and resizing, one insert at a time.', status: 'live', steps: 23, minutes: 25 },
      { slug: 'stack-heap', code: 'CS-04', title: 'Stack vs Heap', blurb: 'Where your variables live, and how long.', status: 'drafting' },
      { slug: 'garbage-collection', code: 'CS-05', title: 'Garbage Collection', blurb: 'Mark, sweep, and generational tricks.', status: 'drafting' },
      { slug: 'cpu-caches', code: 'CS-06', title: 'CPU Caches', blurb: 'Why memory layout can make code 10× faster.', status: 'drafting' },
      { slug: 'race-conditions', code: 'CS-07', title: 'Race Conditions & Locks', blurb: 'Two threads, one counter, and a lost update.', status: 'drafting' },
      { slug: 'big-o', code: 'CS-08', title: 'Big-O, Visually', blurb: 'Feel the difference between n, n log n and n².', status: 'drafting' },
    ],
  },
];

export const ALL_TOPICS = TRACKS.flatMap((t) => t.topics.map((topic) => ({ ...topic, track: t })));

export function findTopic(slug: string) {
  return ALL_TOPICS.find((t) => t.slug === slug) ?? null;
}
