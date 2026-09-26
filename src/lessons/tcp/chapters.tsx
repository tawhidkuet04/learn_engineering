import type { ReactNode } from 'react';
import { ActionsCard, SliderCard, Stat, ToggleCard } from '@/components/lesson/cards';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey } from './Overlay';
import { CheatSheet, Playground } from './panel';
import type { PredictKind, StepCfg, TcpSim } from './sim';

export const META = { slug: 'tcp', code: 'NET-03', track: 'Networking', title: 'TCP Handshakes & Reliability' };

export interface StepCtx {
  sim: TcpSim;
  stepKey: string;
  replay: () => void;
}

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg: StepCfg;
  script?: ScriptEvent<TcpSim>[];
  predict?: { kind: PredictKind; rounds: number; prompt: ReactNode };
  hud?: HudKey[];
  /** Side note shown after the interaction cards */
  aside?: ReactNode;
  /** HUD on phones (defaults to the first three) */
  mhud?: HudKey[];
  callouts?: Callout[];
  /** Callouts on phones (none unless given: the stage is narrow) */
  mcallouts?: Callout[];
  legend?: LegendItem[];
  code?: CodeSpec;
  quiz?: QuizSpec;
  extra?: (c: StepCtx) => ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

const L = {
  pkt: { label: 'packet', color: SIG.req },
  ackPkt: { label: 'ACK', color: SIG.res, shape: 'small' as const },
  synData: { label: 'SYN / data', color: SIG.req },
  data: { label: 'data', color: SIG.req },
  fin: { label: 'FIN', color: SIG.req },
  ack: { label: 'ACK', color: SIG.res },
  dup: { label: 'duplicate ACK', color: SIG.warn },
  rtx: { label: 'resent', color: SIG.heavy },
  lost: { label: 'lost', color: SIG.err, shape: 'ring' as const },
  ctl: { label: 'probe / window update', color: SIG.hc },
  timer: { label: 'timer', color: SIG.hc, shape: 'line' as const },
  tw: { label: 'TIME_WAIT', color: SIG.heavy, shape: 'line' as const },
  queue: { label: 'router queue', color: SIG.heavy, shape: 'square' as const },
  cwnd: { label: 'cwnd', color: SIG.warn, shape: 'line' as const },
  ssthresh: { label: 'ssthresh', color: SIG.hc, shape: 'line' as const },
};

const HS_TCP = { isn: [2873416419, 1052773810] as [number, number] };
const FILE = { total: 6, lastLen: 512 };

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'why',
    title: 'Why TCP exists',
    steps: [
      {
        id: 'best-effort',
        title: 'The network makes no promises',
        cfg: { view: 'net', net: 'udp' },
        body: (
          <>
            <p>
              <Term k="client">Alice</Term> is uploading photos to <Term k="server">photos.example</Term>. Her laptop chops the data into{' '}
              <strong>packets</strong> and hands them to the network. They’re numbered here so you can follow them.
            </p>
            <p>
              The internet underneath is <strong>IP</strong>, and IP is <strong>best effort</strong>: every <Term k="routers">router</Term> forwards
              packets as well as it can and promises nothing. Watch what arrives. A full router queue <strong>drops</strong> a packet, one takes the long
              route and arrives <strong>out of order</strong>, and one shows up <strong>twice</strong>.
            </p>
            <p>Nobody tells Alice. If her app needs every byte, in order, something has to fix this.</p>
          </>
        ),
        aside: (
          <Aside>
            Everything goes wrong at once here so you can see it. On real paths, loss is the everyday problem (full queues, flaky Wi-Fi); reordering and
            duplicates are rarer, but a reliable protocol has to survive all three.
          </Aside>
        ),
        hud: ['net-sent', 'net-lost', 'net-late', 'net-dup'],
        mhud: ['net-lost', 'net-late', 'net-dup'],
        callouts: [{ target: 'r2', text: <>a full queue <b>drops packets</b></>, dir: 'up' }],
        legend: [L.pkt, L.lost],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ping -c 6 203.0.113.10
PING 203.0.113.10 (203.0.113.10): 56 data bytes
64 bytes from 203.0.113.10: icmp_seq=0 ttl=52 time=98.4 ms
64 bytes from 203.0.113.10: icmp_seq=1 ttl=52 time=97.9 ms
!Request timeout for icmp_seq 2
64 bytes from 203.0.113.10: icmp_seq=3 ttl=52 time=131.2 ms
64 bytes from 203.0.113.10: icmp_seq=4 ttl=52 time=98.1 ms
64 bytes from 203.0.113.10: icmp_seq=5 ttl=52 time=97.6 ms

--- 203.0.113.10 ping statistics ---
!6 packets transmitted, 5 packets received, 16.7% packet loss
round-trip min/avg/max/stddev = 97.6/104.6/131.2/13.3 ms`,
          note: 'ping sends raw ICMP packets with no recovery: a lost one is simply gone, and the 131 ms one sat in a queue somewhere.',
        },
      },
      {
        id: 'tcp-or-udp',
        title: 'TCP or UDP?',
        cfg: { view: 'net', net: 'udp' },
        body: (
          <>
            <p>There are two classic ways to send data over IP.</p>
            <p>
              <strong>UDP</strong> adds little more than port numbers and a checksum. No connection, no numbering, no retries: whatever arrives goes
              straight to the app, gaps and all. That’s ideal when late data is useless anyway (a video-call frame, a game update) or when a request is so
              small you can just ask again (a DNS lookup).
            </p>
            <p>
              <strong>TCP</strong> turns the same unreliable packets into a <strong>reliable, ordered byte stream</strong>. Switch to TCP below. The
              server now acknowledges what it gets (green), Alice resends what went missing (orange), and the server holds early arrivals until the gap is
              filled, so the app reads 1, 2, 3… in order.
            </p>
            <p>The price is waiting: while a lost packet is resent, everything behind it is stuck. The rest of this lesson is how TCP pulls it off.</p>
          </>
        ),
        aside: (
          <Aside>QUIC, the transport under HTTP/3, runs on top of UDP and rebuilds reliability, ordering and congestion control itself, per stream.</Aside>
        ),
        extra: ({ sim, stepKey }) => (
          <ToggleCard
            key={stepKey}
            prompt="Pick the transport:"
            options={[
              { label: 'UDP', apply: () => sim.setNetMode('udp'), note: <>The app gets exactly what the network delivered: fast, but with holes, repeats and scrambled order.</> },
              {
                label: 'TCP',
                apply: () => sim.setNetMode('tcp'),
                note: (
                  <>
                    Every packet is acknowledged and every gap refilled. The app reads a clean stream, but it <strong>waits</strong> whenever something has to
                    be resent.
                  </>
                ),
              },
            ]}
          />
        ),
        hud: ['net-sent', 'net-lost', 'net-late', 'net-rtx'],
        mhud: ['net-lost', 'net-late', 'net-rtx'],
        legend: [L.pkt, L.ackPkt, L.rtx, L.lost],
        code: {
          title: 'sockets.py',
          lang: 'python',
          code: `
import socket

# TCP: a connection, then a reliable byte stream
!tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
tcp.connect(("203.0.113.10", 443))   # the handshake happens here
tcp.sendall(photo)                    # the kernel resends and reorders

# UDP: independent datagrams, no guarantees
!udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp.sendto(query, ("192.0.2.53", 53)) # fire and forget`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'handshake',
    title: 'The handshake',
    steps: [
      {
        id: 'three-way-handshake',
        title: 'The three-way handshake',
        cfg: { view: 'seq', scenario: 'handshake', tcp: { ...HS_TCP, total: 1, lastLen: 517, firstData: 60 }, seq: { abs: true, inspect: true, rtt: true }, start: 0.9 },
        body: (
          <>
            <p>
              Before any data flows, TCP sets up a <strong>connection</strong>: both sides agree to talk, and each picks a starting{' '}
              <strong>sequence number</strong>. Time runs downward; each line is a <strong>segment</strong>, TCP’s word for a packet.
            </p>
            <p>
              1. <Term k="client">Alice</Term> sends a <strong>SYN</strong> (“synchronize”) with her starting number, <code>seq = x</code>.
              <br />
              2. The <Term k="server">server</Term> answers <strong>SYN-ACK</strong>: its own number <code>seq = y</code>, plus <code>ack = x + 1</code>,
              meaning “got your SYN”.
              <br />
              3. Alice replies <strong>ACK</strong>, <code>ack = y + 1</code>. Both sides are <strong>ESTABLISHED</strong>.
            </p>
            <p>
              Watch the state under each name: CLOSED → SYN_SENT → ESTABLISHED for Alice, LISTEN → SYN_RECEIVED → ESTABLISHED for the server. And note the
              cost: Alice’s first byte of data can only leave after one full <strong>round trip</strong> (RTT).
            </p>
          </>
        ),
        aside: (
          <Aside>
            The card on the right is the real TCP header of the latest segment: ports, sequence and acknowledgment numbers, flags and the receive
            window. SYNs also carry options, like the maximum segment size (MSS).
          </Aside>
        ),
        hud: ['elapsed', 'rtt'],
        legend: [L.synData, L.ack],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sudo tcpdump -t -n -S 'host 203.0.113.10 and port 443'
IP 198.51.100.42.51514 > 203.0.113.10.443: Flags [S],
!    seq 2873416419, win 64240,
    options [mss 1460,nop,nop,sackOK,nop,wscale 7], length 0
IP 203.0.113.10.443 > 198.51.100.42.51514: Flags [S.],
!    seq 1052773810, ack 2873416420, win 64240,
    options [mss 1460,nop,nop,sackOK,nop,wscale 7], length 0
IP 198.51.100.42.51514 > 203.0.113.10.443: Flags [.],
!    ack 1052773811, win 502, length 0`,
          note: '[S] is SYN, [S.] is SYN+ACK, [.] a plain ACK; -S prints absolute sequence numbers. win 502 is scaled by 2^7 (the wscale option): 64,256 bytes. Lines wrapped to fit.',
        },
      },
      {
        id: 'random-isn',
        title: 'Why start at a random number?',
        cfg: { view: 'seq', scenario: 'handshake', tcp: { total: 0 }, seq: { abs: true }, loop: 2.4, start: 0.7, seed: 3 },
        predict: { kind: 'handshake', rounds: 2, prompt: 'Which ack number goes in the reply?' },
        body: (
          <>
            <p>Why not simply start at 0? Because a connection’s numbers must never be mistaken for another’s.</p>
            <p>
              A delayed segment from an earlier connection between the same two ports could turn up late and land right inside the new one. Worse, if
              numbers were predictable, an attacker who can’t even see your traffic could forge segments that fit, injecting data or resetting the
              connection. A random <strong>initial sequence number (ISN)</strong> closes both holes.
            </p>
            <p>
              Each side picks its own ISN and must acknowledge the other’s. A SYN counts as one number, so the acknowledgment is always <em>ISN + 1</em>.
              The handshake now pauses before each reply: <strong>predict the ack number</strong>.
            </p>
          </>
        ),
        aside: (
          <Aside>
            Every connection gets fresh numbers: watch them change each round. tcpdump and Wireshark usually print <em>relative</em> numbers, counted
            from the ISN, and so does the rest of this lesson.
          </Aside>
        ),
        legend: [L.synData, L.ack],
        code: {
          title: 'net/core/secure_seq.c (simplified)',
          lang: 'c',
          code: `
u32 secure_tcp_seq(__be32 saddr, __be32 daddr,
                   __be16 sport, __be16 dport)
{
    /* a secret-keyed hash of the connection's 4-tuple... */
!    u32 hash = siphash_3u32(saddr, daddr,
!                            sport << 16 | dport, &net_secret);
    /* ...plus a clock that ticks every 64 ns */
!    return hash + (ktime_get_real_ns() >> 6);
}`,
          note: 'This is the recipe from RFC 6528. In 1994 Kevin Mitnick famously broke into a machine by guessing the predictable ISNs of the day.',
        },
      },
      {
        id: 'lost-syn',
        title: 'When the SYN goes missing',
        cfg: { view: 'seq', scenario: 'handshake', tcp: { total: 0 }, seq: { timers: ['syn', 'synack'], drop: ['syn', 'synack'] }, start: 0.7 },
        script: [{ at: 0.1, run: (s) => s.dropNext('syn') }],
        body: (
          <>
            <p>
              The very first segment can be lost too, and then there’s nothing to acknowledge. So Alice starts a <strong>timer</strong> when she sends the
              SYN. If no SYN-ACK arrives before it runs out, she sends the SYN again.
            </p>
            <p>
              Nothing has been measured yet, so the first timeout is a cautious <strong>1 second</strong> (RFC 6298), about ten round trips here. Each
              further failure doubles the wait: 1 s, 2 s, 4 s… The diagram fast-forwards through the waits.
            </p>
            <p>
              <strong>Your turn:</strong> click a SYN while it’s in flight to drop it. Drop several in a row to watch the backoff grow.
            </p>
          </>
        ),
        aside: (
          <Aside>
            The server guards its SYN-ACK the same way. On Linux, <code>net.ipv4.tcp_syn_retries</code> (default 6) caps the retries, which is why
            connecting to a dead address hangs for about two minutes before it fails.
          </Aside>
        ),
        extra: ({ sim, stepKey }) => (
          <ActionsCard
            key={stepKey}
            buttons={[
              { label: 'Lose 3 SYNs', icon: 'x', run: () => sim.replayWith([{ kind: 'syn', n: 3 }]), after: <>Three SYNs vanish in a row. Watch each wait double: 1 s, 2 s, 4 s. That’s 7 seconds before the handshake even starts.</> },
              { label: 'Lose 1 SYN', icon: 'x', run: () => sim.replayWith([{ kind: 'syn', n: 1 }]), after: <>One lost SYN costs a full second, about ten round trips here.</> },
              { label: 'Lose nothing', icon: 'replay', run: () => sim.replayWith([]), after: <>A clean handshake: one round trip. Click a SYN in flight to drop it yourself.</> },
            ]}
          />
        ),
        hud: ['syns', 'elapsed'],
        legend: [L.synData, L.ack, L.rtx, L.lost, L.timer],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sysctl net.ipv4.tcp_syn_retries
!net.ipv4.tcp_syn_retries = 6
# a SYN to a silent address is retried 6 times, each wait
# roughly double the last, before connect() fails with ETIMEDOUT`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'bytes',
    title: 'Counting bytes',
    steps: [
      {
        id: 'sequence-numbers',
        title: 'Sequence numbers count bytes',
        cfg: { view: 'seq', scenario: 'data', tcp: { ...FILE, fixedWnd: 2 }, seq: { strip: true }, loop: 2.6, start: 0.6 },
        body: (
          <>
            <p>
              The connection is open. Alice sends a small file of <strong>7,812 bytes</strong>, and TCP numbers every <strong>byte</strong> of the stream,
              not every packet. Counting from the ISN, the first data byte is number 1.
            </p>
            <p>
              Data travels in segments of at most 1,460 bytes, the <strong>MSS</strong>: a 1,500-byte Ethernet packet minus 20 bytes of IP header and 20
              of TCP header. A segment’s <code>seq</code> is the number of its first byte: 1, 1461, 2921…
            </p>
            <p>
              The server answers with ACKs that name the <strong>next byte it expects</strong>. <code>ack=1461</code> means “I have everything before 1461,
              send 1461 next.” The <Term k="strip">strip</Term> at the top is Alice’s view of her stream: blue segments are in flight, green ones are
              acknowledged.
            </p>
          </>
        ),
        hud: ['acked', 'inflight'],
        legend: [L.data, L.ack],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sudo tcpdump -t -n 'host 203.0.113.10 and port 443'
IP 198.51.100.42.51514 > 203.0.113.10.443:
!    Flags [P.], seq 1:1461, ack 1, win 502, length 1460
IP 198.51.100.42.51514 > 203.0.113.10.443:
!    Flags [P.], seq 1461:2921, ack 1, win 502, length 1460
IP 203.0.113.10.443 > 198.51.100.42.51514:
!    Flags [.], ack 1461, win 501, length 0`,
          note: 'seq 1:1461 means bytes 1 up to, not including, 1461. Alice’s segments also carry ack 1: every header acknowledges the other direction too. Lines wrapped to fit.',
        },
      },
      {
        id: 'predict-the-ack',
        title: 'Predict the ACK',
        cfg: { view: 'seq', scenario: 'data', tcp: { ...FILE, fixedWnd: 2 }, seq: { strip: true }, loop: 2.2, start: 0.6 },
        predict: { kind: 'ack', rounds: 3, prompt: 'Which ack number does the server send?' },
        body: (
          <>
            <p>
              The rule fits in one line: <strong>ack = seq + len</strong>. The ACK names the <em>next</em> byte wanted, not the last byte received.
            </p>
            <p>
              Your turn. The upload runs again, and as an ACK is about to leave, the stage freezes. Read the segment that just arrived and{' '}
              <strong>pick the ack number</strong>. Mind the last segment: the file ends with a 512-byte tail.
            </p>
          </>
        ),
        hud: ['acked'],
        legend: [L.data, L.ack],
        code: {
          title: 'Wireshark · Info column (trimmed)',
          lang: 'conf',
          code: `
!51514 → 443 [PSH, ACK] Seq=1 Len=1460
!443 → 51514 [ACK] Ack=1461
51514 → 443 [PSH, ACK] Seq=2921 Len=1460
443 → 51514 [ACK] Ack=4381`,
        },
      },
      {
        id: 'cumulative-acks',
        title: 'ACKs are cumulative',
        cfg: { view: 'seq', scenario: 'data', tcp: { fixedWnd: 4, delAck: true }, seq: { strip: true, drop: ['ack'] }, start: 0.5 },
        body: (
          <>
            <p>
              Because an ACK means “everything before this number”, each one also confirms everything earlier ACKs did. ACKs are{' '}
              <strong>cumulative</strong>, and that has two nice effects.
            </p>
            <p>
              The server doesn’t have to acknowledge every segment. Here it sends one ACK for every two, a common trick called <strong>delayed ACK</strong>:
              a single <code>ack=2921</code> covers two segments.
            </p>
            <p>
              And a lost ACK costs nothing, as long as a later one gets through in time. <strong>Try it:</strong> click green ACKs in flight to drop them.
              Watch the strip: the next ACK moves everything forward anyway.
            </p>
          </>
        ),
        aside: (
          <Aside>
            RFC 5681 lets a receiver hold an ACK for up to 500 ms, but it must acknowledge at least every second full-size segment. Linux holds them
            for much less, typically tens of milliseconds.
          </Aside>
        ),
        hud: ['acked', 'dropped', 'rtx'],
        legend: [L.data, L.ack, L.lost],
        code: {
          title: 'sender.js (pseudocode)',
          lang: 'js',
          code: `
// Alice, on every incoming ACK
function onAck(ack) {
!  if (ack > sndUna) {      // new data acknowledged
!    sndUna = ack;          // everything below ack is safe: forget it
    restartRetransmitTimer();
  }
}`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'loss',
    title: 'Loss and recovery',
    steps: [
      {
        id: 'retransmission-timer',
        title: 'The retransmission timer',
        cfg: { view: 'seq', scenario: 'data', tcp: { fixedWnd: 4, fastRetransmit: false }, seq: { strip: true, side: 'rto', drop: ['data'], timers: ['rto'] }, start: 0.5 },
        script: [{ at: 3.4, run: (s) => s.dropNext('data') }],
        body: (
          <>
            <p>
              What if a data segment vanishes? Alice keeps a <strong>retransmission timer</strong> (RTO) running for her oldest unacknowledged byte. Every
              ACK that moves things forward restarts it. If it ever runs out, she assumes the segment is lost and sends it again.
            </p>
            <p>
              A fixed timeout can’t work: 300 ms is forever inside a data center and too short over a satellite link. So TCP times every round trip and
              keeps a <strong>smoothed RTT</strong> (SRTT) and its <strong>variation</strong> (RTTVAR). The readout shows the math, live.
            </p>
            <p>
              Watch one segment get lost: the window fills, the strip stalls, the timer runs out, and the segment goes again. The yellow ACKs are
              duplicates; more about them next. Then <strong>try it:</strong> click any blue segment to drop it.
            </p>
          </>
        ),
        aside: (
          <Aside>
            RFC 6298 asks for a 1-second minimum; Linux uses 200 ms. After each timeout the RTO doubles, and a retransmitted segment is never timed,
            because nobody can tell which copy the ACK answers (Karn’s algorithm).
          </Aside>
        ),
        hud: ['rtt', 'rtx', 'timeouts'],
        legend: [L.data, L.ack, L.dup, L.rtx, L.lost, L.timer],
        code: {
          title: 'rto.js (RFC 6298)',
          lang: 'js',
          code: `
// on each RTT sample r, in ms
!rttvar = 0.75 * rttvar + 0.25 * Math.abs(srtt - r);
!srtt   = 0.875 * srtt + 0.125 * r;
!rto    = srtt + Math.max(4 * rttvar, 200); // Linux: 200 ms floor

// when the timer fires
retransmit(oldestUnacked);
rto = Math.min(rto * 2, 120000);            // back off`,
        },
      },
      {
        id: 'holes-and-duplicate-acks',
        title: 'Holes and duplicate ACKs',
        cfg: { view: 'seq', scenario: 'data', tcp: { fixedWnd: 5, fastRetransmit: false, rbuf: 8 }, seq: { strip: true, rbuf: true, drop: ['data'] }, start: 0.5 },
        script: [{ at: 2.8, run: (s) => s.dropNext('data') }],
        body: (
          <>
            <p>
              Now look at the <Term k="rbuf">server’s receive buffer</Term> when a segment goes missing. The segments behind it keep arriving and the server
              keeps them (blue), but it can’t hand them to the app: TCP promised an in-order stream, and there’s a <strong>hole</strong>.
            </p>
            <p>
              What should it acknowledge? An ACK can only say “everything before N”, so the server repeats the last in-order number, once for every segment
              that lands beyond the hole. These are <strong>duplicate ACKs</strong> (yellow).
            </p>
            <p>When the retransmission finally fills the hole, the ACK jumps over everything that was waiting, and the app gets it all at once.</p>
          </>
        ),
        aside: (
          <Aside>
            Modern TCP adds <strong>selective acknowledgments</strong> (SACK, RFC 2018): duplicate ACKs also list the blocks that arrived beyond the hole,
            so the sender resends exactly what’s missing.
          </Aside>
        ),
        hud: ['rtx', 'timeouts'],
        legend: [L.data, L.ack, L.dup, L.rtx, L.lost],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sudo tcpdump -t -n 'host 203.0.113.10 and port 443'
IP 203.0.113.10.443 > 198.51.100.42.51514:
!    Flags [.], ack 2921, win 501,
!    options [nop,nop,sack 1 {4381:5841}], length 0
IP 203.0.113.10.443 > 198.51.100.42.51514:
!    Flags [.], ack 2921, win 501,
!    options [nop,nop,sack 1 {4381:7301}], length 0`,
          note: 'Two duplicate ACKs for 2921. The SACK option adds that bytes 4381 to 7300 already arrived beyond the hole. Lines wrapped to fit.',
        },
      },
      {
        id: 'fast-retransmit',
        title: 'Fast retransmit',
        cfg: { view: 'seq', scenario: 'data', tcp: { fixedWnd: 5 }, seq: { strip: true, side: 'dup', drop: ['data'] }, start: 0.5 },
        script: [{ at: 2.8, run: (s) => s.dropNext('data') }],
        body: (
          <>
            <p>
              Those duplicates are a strong hint. If three segments made it past the hole, the missing one is almost certainly lost, not just late. So after{' '}
              <strong>three duplicate ACKs</strong> Alice resends right away instead of waiting for the timer. That’s <strong>fast retransmit</strong>.
            </p>
            <p>Compare with the last two steps: the hole is repaired in about one round trip instead of a full timeout.</p>
            <p>
              <strong>Try it:</strong> click segments to drop them, or raise the loss rate. Fast retransmit rescues most losses but not all: if the last
              segments of a burst are lost, nothing follows them, no duplicates come back, and only the timer can help.
            </p>
          </>
        ),
        aside: (
          <Aside>
            Why three and not one? Networks sometimes reorder packets, and one or two duplicates are often just that. Modern Linux also uses RACK (RFC
            8985), which spots losses by timing instead of counting duplicates.
          </Aside>
        ),
        extra: ({ sim, stepKey }) => (
          <SliderCard
            key={stepKey}
            poll={sim}
            sliders={[
              {
                label: 'Random loss',
                min: 0,
                max: 15,
                step: 1,
                initial: 0,
                format: (v) => `${v}%`,
                onChange: (v) => sim.setLoss(v / 100),
                ends: ['clean', 'awful Wi-Fi'],
              },
            ]}
            stats={() => (
              <>
                <Stat label="fast retransmits" value={sim.model?.stats.fastRtx ?? 0} />
                <Stat label="timeouts" value={sim.model?.stats.timeouts ?? 0} bad={(sim.model?.stats.timeouts ?? 0) > 0} />
              </>
            )}
          />
        ),
        hud: ['fastrtx', 'timeouts', 'rtx'],
        legend: [L.data, L.ack, L.dup, L.rtx, L.lost],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ netstat -s | grep -iE 'retrans|timeout'
    18432 segments retransmitted
!    9127 fast retransmits
    1043 retransmits in slow start
!    2210 other TCP timeouts`,
          note: 'Counters for the whole machine since boot. On a healthy server, fast retransmits far outnumber timeouts.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'flow',
    title: 'Flow control',
    steps: [
      {
        id: 'receive-window',
        title: 'Flow control: the receive window',
        cfg: { view: 'seq', scenario: 'data', tcp: { fixedWnd: 8, rbuf: 6, appRate: 6 }, seq: { strip: true, window: true, rbuf: true, win: true }, start: 0.5 },
        body: (
          <>
            <p>
              Now slow the receiver down. The server’s app reads data out of its <Term k="rbuf">receive buffer</Term> at its own pace, perhaps because it
              writes every photo to a slow disk. Data arriving faster than that piles up, and the buffer is finite.
            </p>
            <p>
              So every ACK also carries a <strong>receive window</strong> (<code>win</code>, or rwnd): how many more bytes the server can take right now.
              Alice never sends beyond it. On her <Term k="strip">strip</Term>, yellow blocks may go now; hatched ones are <strong>not yet allowed</strong>.
            </p>
            <p>
              That’s <strong>flow control</strong>: a fast sender can’t swamp a slow receiver. <strong>Try it:</strong> change how fast the app reads and
              watch the window open and close.
            </p>
          </>
        ),
        aside: (
          <Aside>
            The window field has only 16 bits (65,535 bytes max), far too little for fast links. The <strong>window scale</strong> option, agreed in the
            SYNs, multiplies it by up to 2<sup>14</sup>: that’s the <code>wscale 7</code> in the tcpdump output earlier.
          </Aside>
        ),
        extra: ({ sim, stepKey }) => (
          <SliderCard
            key={stepKey}
            poll={sim}
            sliders={[
              {
                label: 'Server app reads',
                min: 1,
                max: 40,
                step: 1,
                initial: 6,
                format: (v) => (v >= 40 ? 'instantly' : `${v} segments/s`),
                onChange: (v) => sim.setAppRate(v >= 40 ? Infinity : v),
                ends: ['sluggish', 'instant'],
              },
            ]}
            stats={() => <Stat label="rwnd" value={`${sim.model?.advWin() ?? 0} B`} bad={(sim.model?.advWin() ?? 1) === 0} />}
          />
        ),
        hud: ['rwnd', 'inflight'],
        legend: [L.data, L.ack, L.ctl],
        code: {
          title: 'terminal (server)',
          lang: 'shell',
          code: `
$ ss -tn 'sport = :443'
State  Recv-Q  Send-Q  Local Address:Port    Peer Address:Port
!ESTAB  8760    0       203.0.113.10:443      198.51.100.42:51514`,
          note: 'Recv-Q is data that arrived but the app hasn’t read yet: the full part of the receive buffer (6 × 1460 bytes here).',
        },
      },
      {
        id: 'zero-window',
        title: 'Zero window',
        cfg: { view: 'seq', scenario: 'data', tcp: { fixedWnd: 8, rbuf: 6, appRate: 12 }, seq: { strip: true, window: true, rbuf: true, win: true, timers: ['persist'] }, start: 0.5 },
        script: [{ at: 3.2, run: (s) => s.setAppStalled(true) }],
        body: (
          <>
            <p>
              What if the app stops reading altogether? The buffer fills to the brim and the server advertises <code>win=0</code>:{' '}
              <strong>send nothing</strong>. Alice stops.
            </p>
            <p>
              There’s a trap, though. When the app reads again, the server sends a <strong>window update</strong>, and if that one ACK is lost, each side
              waits for the other forever. So while the window is zero, Alice runs a <strong>persist timer</strong> and now and then sends a tiny{' '}
              <strong>window probe</strong> (violet). Each reply repeats the current window, until it opens.
            </p>
            <p>
              <strong>Try it:</strong> the app just stalled. Resume it, stall it again.
            </p>
          </>
        ),
        aside: (
          <Aside>
            Probes back off like retransmissions, each wait about double the last. A connection can sit at zero window for hours without breaking;
            that’s by design.
          </Aside>
        ),
        extra: ({ sim, stepKey }) => (
          <ActionsCard
            key={stepKey}
            buttons={[
              { label: 'Resume reading', icon: 'play', run: () => sim.setAppStalled(false), after: <>The app drains the buffer, the server sends a <strong>window update</strong>, and Alice picks up where she left off.</> },
              { label: 'Stall the app', icon: 'pause', run: () => sim.setAppStalled(true), after: <>Reading stops. Watch the buffer fill and the window shrink to zero.</> },
            ]}
          />
        ),
        hud: ['rwnd', 'probes'],
        legend: [L.data, L.ack, L.ctl, L.timer],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sudo tcpdump -t -n 'host 203.0.113.10 and port 443'
IP 203.0.113.10.443 > 198.51.100.42.51514:
!    Flags [.], ack 65161, win 0, length 0
IP 198.51.100.42.51514 > 203.0.113.10.443:
    Flags [.], ack 1, win 502, length 0     # window probe
IP 203.0.113.10.443 > 198.51.100.42.51514:
!    Flags [.], ack 65161, win 0, length 0
IP 203.0.113.10.443 > 198.51.100.42.51514:
!    Flags [.], ack 65161, win 128, length 0 # window update`,
          note: 'Linux’s probe is a bare ACK carrying an old sequence number, just to provoke a reply. Windows are scaled by 2^7. Lines wrapped to fit.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'congestion',
    title: 'Congestion control',
    steps: [
      {
        id: 'congestion',
        title: 'The network has a limit too',
        cfg: { view: 'pipe', tcp: { cc: 'none', fixedWnd: 30 }, pipe: { strip: true, chart: true }, start: 0.3 },
        body: (
          <>
            <p>
              Flow control protects the receiver. But between Alice and the server is a network shared with everyone else, and its slowest link, the{' '}
              <strong>bottleneck</strong>, carries only so much: here, Alice’s home uplink.
            </p>
            <p>
              Packets that arrive faster than the bottleneck can send them wait in the <Term k="queue">router’s queue</Term>, and when it’s full, new
              arrivals are dropped. With no brakes, Alice keeps 30 segments in flight while the path holds about 17 (9 on the wire, 8 in the queue). The
              extras are thrown away, and every packet waits behind a full queue.
            </p>
            <p>
              In 1986 this happened to the whole Internet: throughput between two Berkeley sites fell from 32 kbit/s to 40 bit/s as hosts kept resending
              into jammed routers. Van Jacobson’s fix was a second window, the <strong>congestion window</strong> (cwnd): the sender’s own guess of what
              the network can take. Alice sends up to <strong>min(cwnd, rwnd)</strong>. Turn it on.
            </p>
          </>
        ),
        extra: ({ sim, stepKey }) => (
          <ToggleCard
            key={stepKey}
            prompt="Congestion control:"
            options={[
              { label: 'Off', apply: () => sim.setCongestionControl(false), note: <>A fixed window of 30 segments. The queue is always full and a big share of what Alice sends is dropped.</> },
              {
                label: 'On (Reno)',
                apply: () => sim.setCongestionControl(true),
                note: <>cwnd starts small, grows while things go well and shrinks after a loss. Far fewer drops, and the queue gets breathing room.</>,
              },
            ]}
          />
        ),
        hud: ['goodput', 'loss', 'rtt'],
        mhud: ['goodput', 'loss'],
        legend: [L.data, L.ack, L.lost, L.queue, L.cwnd],
        code: {
          title: 'terminal (tc)',
          lang: 'shell',
          code: `
# this lesson's path on a Linux box: 50 ms of delay,
# a ~1 Mbit/s bottleneck, room for 8 packets in the queue
!tc qdisc add dev eth0 root handle 1: netem delay 50ms
!tc qdisc add dev eth0 parent 1:1 handle 10: \\
!    tbf rate 1mbit burst 1600 limit 11680`,
        },
      },
      {
        id: 'slow-start',
        title: 'Slow start',
        cfg: { view: 'pipe', tcp: { cc: 'reno', initCwnd: 1 }, pipe: { strip: true, chart: true }, start: 0.4 },
        body: (
          <>
            <p>
              A new connection knows nothing about the path, so cwnd starts small, here at one segment, and grows with every ACK:{' '}
              <strong>+1 segment per segment acknowledged</strong>. One segment brings back one ACK: cwnd is 2. Those two bring two ACKs: 4. Then 8, 16…
              cwnd <strong>doubles every round trip</strong>.
            </p>
            <p>
              It’s called <strong>slow start</strong>, which sounds odd for exponential growth. It’s slow compared with what TCP did before 1988: blast a
              whole window at once.
            </p>
            <p>
              Watch the <Term k="chart">chart</Term>. Doubling finds the limit within a few round trips, and then overshoots it: the first drop is only
              noticed a round trip later, when cwnd has climbed far past the red line, so a burst of packets is lost.
            </p>
          </>
        ),
        aside: (
          <Aside>
            Real stacks start at 10 segments (RFC 6928), not 1; we start at 1 so the doubling is easy to see. Linux’s default algorithm also uses
            HyStart, which watches for rising delay to leave slow start before the overshoot.
          </Aside>
        ),
        hud: ['cwnd', 'rtt', 'goodput'],
        mhud: ['cwnd', 'goodput'],
        legend: [L.data, L.ack, L.lost, L.queue, L.cwnd],
        code: {
          title: 'net/ipv4/tcp_cong.c (simplified)',
          lang: 'c',
          code: `
u32 tcp_slow_start(struct tcp_sock *tp, u32 acked)
{
!    u32 cwnd = min(tp->snd_cwnd + acked, tp->snd_ssthresh);

    acked -= cwnd - tp->snd_cwnd;  /* leftover past ssthresh */
    tp->snd_cwnd = cwnd;
    return acked;
}`,
        },
      },
      {
        id: 'congestion-avoidance',
        title: 'Congestion avoidance',
        cfg: { view: 'pipe', tcp: { cc: 'reno', initCwnd: 1, initSsthresh: 8 }, pipe: { strip: true, chart: true }, start: 0.4 },
        body: (
          <>
            <p>
              Once cwnd reaches the <strong>slow start threshold</strong> (ssthresh, the violet line), TCP switches to <strong>congestion avoidance</strong>:
              instead of +1 per ACK it adds <strong>+1 segment per round trip</strong>. Here ssthresh starts at 8, as if an earlier loss had set it.
            </p>
            <p>
              The curve bends from steep to a gentle slope: each round trip, TCP probes for just one more segment of room. The orange area shows why it has
              to stop somewhere. Anything above the <em>pipe</em> line isn’t moving: it’s waiting in the router’s queue, adding delay. When the queue is
              full, the next packet is dropped.
            </p>
          </>
        ),
        hud: ['cwnd', 'ssthresh', 'queue'],
        mhud: ['cwnd', 'ssthresh', 'queue'],
        legend: [L.data, L.ack, L.lost, L.queue, L.cwnd, L.ssthresh],
        code: {
          title: 'net/ipv4/tcp_cong.c (simplified)',
          lang: 'c',
          code: `
/* "In theory this is tp->snd_cwnd += 1 / tp->snd_cwnd" */
void tcp_cong_avoid_ai(struct tcp_sock *tp, u32 w, u32 acked)
{
!    tp->snd_cwnd_cnt += acked;     /* ACKed this round   */
!    if (tp->snd_cwnd_cnt >= w) {   /* a whole window?    */
!        tp->snd_cwnd_cnt -= w;
!        tp->snd_cwnd++;            /* +1 per round trip  */
    }
}`,
        },
      },
      {
        id: 'sawtooth',
        title: 'Loss and the sawtooth',
        cfg: { view: 'pipe', tcp: { cc: 'reno', initCwnd: 10 }, pipe: { strip: true, chart: true }, start: 0.4 },
        predict: { kind: 'cwnd', rounds: 2, prompt: 'What happens to cwnd now?' },
        script: [
          { at: 40, run: (s) => s.hiccup() },
          { at: 75, run: (s) => s.hiccup() },
        ],
        body: (
          <>
            <p>
              Sooner or later the queue overflows and a packet is dropped. TCP reads the loss as <strong>congestion</strong> and backs off. The question is
              how far.
            </p>
            <p>
              The stage freezes when TCP notices a loss: <strong>predict what happens to cwnd</strong>. The first loss shows up as three duplicate ACKs.
              Later a Wi-Fi hiccup swallows everything in flight, and the <strong>retransmission timer</strong> fires instead.
            </p>
            <p>
              Halve on loss, add one per round trip: that’s <strong>AIMD</strong> (additive increase, multiplicative decrease), and it draws the famous{' '}
              <strong>sawtooth</strong>. AIMD is also what makes TCP fair: flows sharing a bottleneck drift toward equal shares.
            </p>
          </>
        ),
        aside: (
          <Aside>
            This is Reno, the textbook algorithm. Linux has defaulted to <strong>CUBIC</strong> since 2006: it cuts to 70% and regrows along a cubic
            curve that races back toward the old maximum, then probes carefully. Google’s <strong>BBR</strong> (2016) measures the bottleneck bandwidth
            and minimum RTT and paces packets to match instead of waiting for losses. Compare all three in the playground.
          </Aside>
        ),
        hud: ['cwnd', 'ssthresh', 'goodput'],
        mhud: ['cwnd', 'ssthresh', 'goodput'],
        legend: [L.data, L.ack, L.lost, L.queue, L.cwnd, L.ssthresh],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sysctl net.ipv4.tcp_congestion_control
!net.ipv4.tcp_congestion_control = cubic
$ ss -ti dst 203.0.113.10
ESTAB  0  52560  198.51.100.42:51514  203.0.113.10:443
!    cubic wscale:7,7 rto:304 rtt:103.2/4.1 mss:1460
!    cwnd:12 ssthresh:9 bytes_acked:1832300 retrans:0/31`,
          note: 'ss -ti shows the live congestion state of every connection: algorithm, RTT (mean/variation), cwnd, ssthresh and retransmissions. Output wrapped to fit.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'closing',
    title: 'Closing the connection',
    steps: [
      {
        id: 'fin-and-ack',
        title: 'Closing: FIN and ACK',
        cfg: { view: 'seq', scenario: 'teardown', tcp: { total: 0, preBytes: 7812, closeDelay: 40 }, seq: { timers: ['timewait'] }, start: 0.9 },
        body: (
          <>
            <p>
              The upload is done. Either side can end the connection, and because TCP carries two independent streams, one each way, each side closes its
              own with a <strong>FIN</strong> (“finished”). Like a SYN, a FIN uses up one sequence number, so it’s acknowledged with +1.
            </p>
            <p>
              <Term k="client">Alice</Term> closes first and enters <strong>FIN_WAIT_1</strong>. The <Term k="server">server</Term> ACKs and enters{' '}
              <strong>CLOSE_WAIT</strong>: it may still send data of its own until its app closes too. Then it sends its own FIN (<strong>LAST_ACK</strong>),
              and Alice’s ACK finishes the job.
            </p>
            <p>
              Four segments. But look at who ends up in <strong>TIME_WAIT</strong>: the side that closed first. It lingers a while before the connection is
              truly gone. Why? Next step.
            </p>
          </>
        ),
        aside: (
          <Aside>
            Often the server’s ACK and FIN travel together in one segment, making it three. Either side can also abort with a <strong>RST</strong>{' '}
            (reset), which skips the goodbyes: the other end sees “connection reset by peer”.
          </Aside>
        ),
        hud: ['elapsed'],
        legend: [L.fin, L.ack, L.tw],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sudo tcpdump -t -n 'host 203.0.113.10 and port 443'
IP 198.51.100.42.51514 > 203.0.113.10.443:
!    Flags [F.], seq 7813, ack 1, win 502, length 0
IP 203.0.113.10.443 > 198.51.100.42.51514:
    Flags [.], ack 7814, win 501, length 0
IP 203.0.113.10.443 > 198.51.100.42.51514:
!    Flags [F.], seq 1, ack 7814, win 501, length 0
IP 198.51.100.42.51514 > 203.0.113.10.443:
    Flags [.], ack 2, win 502, length 0`,
          note: '[F.] is FIN+ACK. Alice’s FIN takes sequence number 7813, right after her 7,812 bytes, so the server acknowledges 7814. Lines wrapped to fit.',
        },
      },
      {
        id: 'time-wait',
        title: 'Why TIME_WAIT lingers',
        cfg: { view: 'seq', scenario: 'teardown', tcp: { total: 0, preBytes: 7812, closeDelay: 40, warpMin: 200 }, seq: { timers: ['timewait', 'fin'], drop: ['ack'] }, start: 0.9 },
        script: [{ at: 0.1, run: (s) => s.dropNext('ack', 'c') }],
        body: (
          <>
            <p>TIME_WAIT exists because the very last ACK can get lost, and whoever sends it can’t know.</p>
            <p>
              Watch: Alice’s final ACK is dropped. The server, still in LAST_ACK, times out and resends its FIN. Alice is in TIME_WAIT, so she still
              remembers the connection and simply acknowledges again. Had she already forgotten it, she’d answer with a reset, and the server would report
              an error on a perfectly good close.
            </p>
            <p>
              Waiting also lets stray segments from this connection die out before the same addresses and ports are reused. The rule is{' '}
              <strong>2 × MSL</strong> (maximum segment lifetime); Linux waits a fixed <strong>60 seconds</strong>, fast-forwarded here.
            </p>
          </>
        ),
        aside: (
          <Aside>
            A client opening thousands of short connections piles up TIME_WAIT sockets, each holding a port for a minute. Reusing connections (HTTP
            keep-alive, connection pools) is the usual cure.
          </Aside>
        ),
        extra: ({ sim, stepKey }) => (
          <ActionsCard
            key={stepKey}
            buttons={[
              { label: 'Replay, lose the final ACK', icon: 'x', run: () => sim.replayWith([{ kind: 'ack', from: 'c', n: 1 }]), after: <>The server’s FIN timer fires, it resends the FIN, and Alice, still in TIME_WAIT, acknowledges again. TIME_WAIT starts over.</> },
              { label: 'Replay, lose nothing', icon: 'replay', run: () => sim.replayWith([]), after: <>A clean close: four segments, then a minute of TIME_WAIT for Alice.</> },
            ]}
          />
        ),
        quiz: {
          question: 'Alice and the server both close. Which side waits in TIME_WAIT?',
          options: [
            { text: 'The side that sent the first FIN', correct: true, why: 'The active closer sends the final ACK, so it’s the one that must stay around in case that ACK is lost.' },
            { text: 'Always the server', why: 'It depends on who closes first. Busy servers often close first themselves, and then they collect the TIME_WAIT sockets.' },
            { text: 'Whichever side sends the last FIN', why: 'The side that sends the last FIN waits in LAST_ACK, not TIME_WAIT. It closes as soon as its FIN is acknowledged.' },
          ],
        },
        hud: ['elapsed'],
        legend: [L.fin, L.ack, L.rtx, L.lost, L.tw],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ss -tan state time-wait
Recv-Q  Send-Q  Local Address:Port    Peer Address:Port
!0       0       198.51.100.42:51514   203.0.113.10:443
0       0       198.51.100.42:51520   203.0.113.10:443`,
          note: 'net.ipv4.tcp_fin_timeout is often mistaken for the TIME_WAIT timer; it actually limits FIN_WAIT_2. Linux’s TIME_WAIT is fixed at 60 s.',
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
        cfg: { view: 'seq', scenario: 'lifecycle', tcp: { ...FILE, fixedWnd: 6 }, seq: { timers: ['timewait'] }, lose: [1], loop: 5, start: 0.7 },
        body: <p>A whole connection on one screen: the handshake, data with one loss repaired by fast retransmit, and the goodbye.</p>,
        extra: () => <CheatSheet />,
        legend: [L.synData, L.ack, L.dup, L.rtx, L.lost],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { view: 'pipe', tcp: { cc: 'reno', initCwnd: 10, rbuf: 64 }, pipe: { strip: true, chart: true, rbuf: true }, start: 0.3 },
        body: (
          <p>
            Everything in one sandbox. Change the loss rate, the round-trip time, how fast the receiver reads, and the congestion control algorithm. The{' '}
            <code>ss</code> output at the bottom follows the connection live.
          </p>
        ),
        extra: ({ sim, stepKey }) => <Playground key={stepKey} sim={sim} />,
        hud: ['cwnd', 'rtt', 'goodput', 'loss'],
        mhud: ['cwnd', 'goodput', 'loss'],
        legend: [L.data, L.ack, L.lost, L.queue, L.cwnd, L.ssthresh],
      },
    ],
  },
];
