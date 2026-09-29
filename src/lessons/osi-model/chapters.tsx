import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import type { ScriptEvent } from '@/lib/sim/Sim';
import { LAYERS, type LayerN } from './model';
import type { CardKind, HudKey } from './Overlay';
import type { DevId, OsiConfig, OsiSim, PredictKind } from './sim';

export const META = { slug: 'osi-model', code: 'NET-02', track: 'Networking', title: 'The OSI Model' };

export type Interaction = 'swap' | 'https' | 'inspect' | 'sort' | 'ttl' | 'break' | 'model' | 'playground' | 'cheatsheet' | 'hexdump';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<OsiConfig>;
  reset?: boolean;
  script?: ScriptEvent<OsiSim>[];
  predict?: { kind: PredictKind; needed: number; prompt: ReactNode };
  card?: CardKind;
  cardLayer?: LayerN;
  hud?: HudKey[];
  legend?: LegendItem[];
  callouts?: Callout[];
  focus?: LayerN[];
  focusDevs?: DevId[];
  peers?: boolean;
  wave?: boolean;
  code?: CodeSpec;
  quiz?: QuizSpec;
  interaction?: Interaction;
  clickRows?: DevId[];
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<OsiConfig>;
  steps: Step[];
}

const L = (n: LayerN, label: string, shape?: LegendItem['shape']): LegendItem => ({ label, color: LAYERS[n].color, shape: shape ?? 'square' });
const WRAP: LegendItem[] = [L(7, 'HTTP data'), L(4, 'TCP header'), L(3, 'IP header'), L(2, 'Ethernet header + FCS'), L(1, 'bits', 'dot')];
const FULL_TRIP = { from: 'alice.7', to: 'srv.7', loop: true };


export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'why-layers',
    title: 'Why layers?',
    cfg: { view: 'stack' },
    steps: [
      {
        id: 'one-request',
        title: 'One request, a stack of problems',
        reset: true,
        cfg: { trip: { ...FULL_TRIP, pace: 1.3, pause: 1.8 } },
        body: (
          <>
            <p>
              Alice types <code>curl http://shop.example/</code>. Her laptop now has to get 75 bytes of text to a server in another city, and get a page
              back.
            </p>
            <p>
              That one job hides a pile of smaller ones. Turn bits into electrical signals. Get them to the next box on the wire. Find a route across many
              networks. Resend anything that gets lost. Deliver it to the right program. Agree on what the bytes mean.
            </p>
            <p>
              Watch the request travel. It goes <strong>down</strong> <Term k="alice">Alice’s stack</Term>, growing at every step, crosses the wire as bits,
              then climbs <strong>up</strong> <Term k="srv">the server’s stack</Term>, shrinking back to the original 75 bytes. By the end of this lesson
              you’ll be able to read every block.
            </p>
            <Aside>
              The seven boxes are the <strong>OSI model</strong>: a map for talking about networks, not seven programs running on the laptop. On a real
              machine the program does layers 5 to 7, the OS kernel does 3 and 4, and the network card handles the signal. Layers 5 and 6 are dashed because
              on the internet they rarely exist as separate protocols.
            </Aside>
          </>
        ),
        hud: ['unit', 'size'],
        legend: WRAP,
      },
      {
        id: 'one-job-each',
        title: 'One job per layer',
        cfg: { trip: { ...FULL_TRIP, pause: 1.6 } },
        peers: true,
        body: (
          <>
            <p>
              The model splits the work into <strong>layers</strong>. Each layer solves one problem and only talks to the layers directly above and below it,
              through a simple interface. Real protocols bend that rule now and then: TCP’s checksum, for one, also covers the IP addresses.
            </p>
            <p>
              Each layer also has a twin on the other machine, its <strong>peer</strong>. <Term k="alice.4">TCP on Alice’s laptop</Term> talks to{' '}
              <Term k="srv.4">TCP on the server</Term> using the TCP protocol, as if a direct line ran between them. Those dashed lines are virtual. The real
              data always goes down, across the wire, and up.
            </p>
            <p>
              Notice where the peers are. Layers 4 to 7 only exist at the two ends. Layers 1 to 3 also run in every router on the way (switches stop at
              2), as you’ll see in chapter 4.
            </p>
            <Aside>
              OSI (Open Systems Interconnection) was published by the ISO in 1984, as part of a project to build a whole new family of protocols. The
              protocols lost to TCP/IP, which the internet runs on, but the seven-layer vocabulary stuck. Chapter 5 lines the two up.
            </Aside>
          </>
        ),
        legend: WRAP,
      },
      {
        id: 'swap-a-layer',
        title: 'Swap a layer, keep the rest',
        reset: true,
        cfg: { trip: { ...FULL_TRIP, pace: 1.2, pause: 1.4 } },
        interaction: 'swap',
        body: (
          <>
            <p>
              Layers pay off when something changes. Because every layer hides its details behind the same interface, you can replace one without touching
              the others.
            </p>
            <p>
              Try it below. Switch Alice to <strong>Wi-Fi</strong> and only her layers 1 and 2 change. Send an email with <strong>SMTP</strong> instead of
              fetching a page, and TCP, IP and Ethernet carry it without caring.
            </p>
            <p>That’s why the web didn’t need rewriting for Wi-Fi, 4G or fiber, and why new apps run on old networks.</p>
          </>
        ),
        hud: ['unit', 'size'],
        legend: WRAP,
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'seven-layers',
    title: 'Seven layers, top to bottom',
    cfg: { view: 'stack' },
    steps: [
      {
        id: 'application',
        title: '7 · Application: what the program says',
        reset: true,
        cfg: { trip: { from: 'alice.7', to: 'alice.7', delay: 0.4 } },
        focus: [7],
        card: 'layer',
        cardLayer: 7,
        body: (
          <>
            <p>
              Let’s walk down Alice’s stack one layer at a time. At the top is the <Term k="alice.7">application layer</Term>, where programs speak their
              own protocols: <strong>HTTP</strong> for the web, <strong>DNS</strong> for names, <strong>SMTP</strong> for mail, <strong>SSH</strong> for
              remote shells.
            </p>
            <p>
              The layer isn’t curl or Chrome. It’s the protocol they speak. Here that’s an HTTP request: 75 bytes of plain text asking <code>shop.example</code>{' '}
              for the page <code>/</code>. At this layer it’s just called <strong>data</strong>, or a message.
            </p>
            <Aside>
              To remember the order from the top: <em>All People Seem To Need Data Processing</em>. From the bottom: <em>Please Do Not Throw Sausage Pizza Away</em>.
            </Aside>
          </>
        ),
        code: {
          title: 'curl -v http://shop.example/',
          lang: 'shell',
          code: `
$ curl -v http://shop.example/
*   Trying 203.0.113.10:80...
* Connected to shop.example (203.0.113.10) port 80
!> GET / HTTP/1.1
!> Host: shop.example
!> User-Agent: curl/8.5.0
!> Accept: */*
>`,
          note: 'Before sending a byte of HTTP, curl already used two other protocols: DNS to find the address, and TCP to open a connection. Both have their own lessons.',
        },
        hud: ['unit', 'size'],
        legend: [L(7, 'HTTP data')],
      },
      {
        id: 'presentation-session',
        title: '6 and 5 · Presentation and session',
        reset: true,
        cfg: { trip: { from: 'alice.7', to: 'alice.5', loop: true, pause: 2, pace: 0.8 } },
        focus: [6, 5],
        card: 'layer',
        cardLayer: 6,
        interaction: 'https',
        body: (
          <>
            <p>
              The <Term k="alice.6">presentation layer</Term> makes sure both sides understand the bytes: character sets like UTF-8, formats like JSON or JPEG,
              compression, encryption. The <Term k="alice.5">session layer</Term> opens, keeps alive and closes a conversation.
            </p>
            <p>
              That’s why they’re drawn dashed: on the internet, layers 5 and 6 rarely exist as separate protocols. Their jobs happen inside the application
              and its libraries. So for plain HTTP, the request passes through both layers unchanged.
            </p>
            <p>
              Switch to <strong>HTTPS</strong> and watch layer 6. <strong>TLS</strong> encrypts the request and adds a 5-byte record header. It’s usually
              filed here, though some put it at layer 5 and many just say “between 4 and 7”.
            </p>
          </>
        ),
        code: {
          title: 'the response headers',
          lang: 'http',
          code: `
HTTP/1.1 200 OK
!Content-Type: text/html; charset=utf-8
!Content-Encoding: gzip
Content-Length: 3120`,
          note: 'Presentation-layer jobs, done by the application: HTTP headers declare the character set and the compression.',
        },
        hud: ['unit', 'size'],
        legend: [L(7, 'HTTP data'), L(6, 'TLS header')],
      },
      {
        id: 'transport',
        title: '4 · Transport: which program, and did it arrive?',
        reset: true,
        cfg: { trip: { from: 'alice.5', to: 'alice.4', delay: 0.5 } },
        focus: [4],
        card: 'layer',
        cardLayer: 4,
        body: (
          <>
            <p>
              A server runs many programs at once. The <Term k="alice.4">transport layer</Term> gets data from one program to another, using{' '}
              <strong>ports</strong>. Destination port 80 means “the web server”. Source port 51234 is a temporary port Alice’s OS picked for curl, so the reply
              can find its way back.
            </p>
            <p>
              <strong>TCP</strong> also makes delivery reliable. It numbers every byte, waits for acknowledgments, resends anything lost and restores the
              order. Its lightweight sibling <strong>UDP</strong> adds only ports, a length and a checksum: perfect when speed beats perfection, like DNS or a
              video call.
            </p>
            <p>
              The TCP header plus the data make a <strong>segment</strong>: 20 + 75 = 95 bytes. With UDP it’s called a <strong>datagram</strong>.
            </p>
          </>
        ),
        code: {
          title: 'ss -tn',
          lang: 'shell',
          code: `
$ ss -tn state established
Recv-Q Send-Q    Local Address:Port    Peer Address:Port
!0      0        198.51.100.23:51234   203.0.113.10:80`,
          note: 'The connection, as the OS sees it: two IP addresses and two ports. Those four numbers identify it.',
        },
        hud: ['unit', 'size'],
        legend: [L(7, 'HTTP data'), L(4, 'TCP header')],
      },
      {
        id: 'network',
        title: '3 · Network: addresses and routes',
        reset: true,
        cfg: { trip: { from: 'alice.4', to: 'alice.3', delay: 0.5 } },
        focus: [3],
        card: 'layer',
        cardLayer: 3,
        body: (
          <>
            <p>
              The <Term k="alice.3">network layer</Term> moves packets between networks, all the way across the internet. Its <strong>IP addresses</strong>{' '}
              name the two ends: Alice at <code>198.51.100.23</code>, the server at <code>203.0.113.10</code>. Routers read the destination to choose the next
              hop.
            </p>
            <p>
              The header also carries a <strong>TTL</strong> (time to live), a hop limit that every router counts down by one. At zero the packet is dropped,
              so a routing mistake can’t send a packet in circles forever. And <code>protocol 6</code> tells the receiver there’s TCP inside.
            </p>
            <p>
              Segment plus IP header makes a <strong>packet</strong>: 115 bytes.
            </p>
          </>
        ),
        code: {
          title: 'ip route',
          lang: 'shell',
          code: `
$ ip route
!default via 198.51.100.1 dev eth0
198.51.100.0/24 dev eth0 proto kernel scope link src 198.51.100.23`,
          note: 'Anything not on Alice’s own network goes to her default gateway, 198.51.100.1. Remember that for the next step.',
        },
        hud: ['unit', 'size'],
        legend: [L(7, 'HTTP data'), L(4, 'TCP header'), L(3, 'IP header')],
      },
      {
        id: 'data-link',
        title: '2 · Data link: the next hop on this wire',
        reset: true,
        cfg: { trip: { from: 'alice.3', to: 'alice.2', delay: 0.5 } },
        focus: [2],
        card: 'layer',
        cardLayer: 2,
        body: (
          <>
            <p>
              IP says where the packet is finally going. The <Term k="alice.2">data link layer</Term> only cares about the next hop, the next device on this
              local network. It wraps the packet in a <strong>frame</strong> addressed with <strong>MAC addresses</strong>, the hardware addresses of network
              cards.
            </p>
            <p>
              Look at the destination MAC: it’s the <strong>router’s</strong>, not the server’s. The server isn’t on Alice’s network, so the frame goes to her
              default gateway. Her laptop learned the router’s MAC with <strong>ARP</strong>, by asking the local network “who has 198.51.100.1?”
            </p>
            <p>
              This is the only layer that adds a trailer too: the <strong>FCS</strong>, a CRC-32 checksum of the whole frame. A receiver that computes a
              different value knows the frame was damaged and drops it. The kernel writes the header, but the network card computes the FCS as the frame
              leaves, so this one layer is split between the two.
            </p>
          </>
        ),
        code: {
          title: 'ip addr · ip neigh',
          lang: 'shell',
          code: `
$ ip addr show eth0
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
!    link/ether a6:4f:21:9c:3e:07 brd ff:ff:ff:ff:ff:ff
    inet 198.51.100.23/24 brd 198.51.100.255 scope global eth0
       valid_lft forever preferred_lft forever
$ ip neigh
!198.51.100.1 dev eth0 lladdr 0e:5a:c3:10:77:01 REACHABLE`,
          note: 'link/ether is Alice’s own MAC (layer 2), inet her IP (layer 3). ip neigh is the ARP cache: the gateway’s IP mapped to its MAC.',
        },
        hud: ['unit', 'size'],
        legend: [L(7, 'HTTP data'), L(4, 'TCP header'), L(3, 'IP header'), L(2, 'Ethernet header + FCS')],
      },
      {
        id: 'physical',
        title: '1 · Physical: bits become signals',
        reset: true,
        cfg: { trip: { from: 'alice.1', to: 'srv.1', loop: true, pause: 1.2, pace: 0.55 } },
        focus: [1],
        card: 'layer',
        cardLayer: 1,
        wave: true,
        body: (
          <>
            <p>
              The <Term k="alice.1">physical layer</Term> adds no header. It takes the finished frame and sends it as a signal: voltage on copper, pulses of
              light in fiber, radio waves for Wi-Fi. It deals in connectors, cables, frequencies and timing, and has no idea what a frame is.
            </p>
            <p>
              Watch the wire. The frame leaves as a stream of <strong>bits</strong>, colored here by the header they came from. First a{' '}
              <strong>preamble</strong> of alternating 1s and 0s so the receiver can lock onto the timing, then the Ethernet header, IP, TCP, the data, and
              the FCS last. Headers are simply the first bits on the wire.
            </p>
            <Aside>
              The square wave is simplified. Gigabit Ethernet on copper sends five-level symbols on all four wire pairs at once. And Ethernet sends each byte
              least significant bit first, which is why the bits look shuffled.
            </Aside>
          </>
        ),
        code: {
          title: 'ethtool eth0 (trimmed)',
          lang: 'shell',
          code: `
$ sudo ethtool eth0
Settings for eth0:
!    Speed: 1000Mb/s
    Duplex: Full
    Port: Twisted Pair
!    Link detected: yes`,
          note: 'At 1 Gb/s this 133-byte frame takes about 1.2 µs to send, counting the preamble and the gap after it.',
        },
        hud: ['unit', 'size'],
        legend: [L(1, 'preamble', 'dot'), L(2, 'Ethernet bits', 'dot'), L(3, 'IP bits', 'dot'), L(4, 'TCP bits', 'dot'), L(7, 'data bits', 'dot')],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'encapsulation',
    title: 'Encapsulation',
    cfg: { view: 'stack' },
    steps: [
      {
        id: 'wrap-send-unwrap',
        title: 'Wrap, send, unwrap',
        reset: true,
        cfg: { trip: { ...FULL_TRIP, pace: 1.05, pause: 2 } },
        body: (
          <>
            <p>
              Put it all together and you get <strong>encapsulation</strong>. Each layer takes whatever the layer above handed it, treats it as an opaque
              payload, and wraps it in its own header. Nobody opens anyone else’s envelope.
            </p>
            <p>
              The name changes with each wrapping: <strong>data</strong> at the top, a <strong>segment</strong> after TCP, a <strong>packet</strong> after IP,
              a <strong>frame</strong> after Ethernet, and finally <strong>bits</strong>. The general term for any of them is a PDU, a protocol data unit.
            </p>
            <p>
              At the server, <strong>decapsulation</strong> runs the same steps backwards: each layer reads its own header, strips it and passes the rest up.
              Here 58 bytes of headers carried 75 bytes of data.
            </p>
          </>
        ),
        interaction: 'hexdump',
        hud: ['unit', 'size', 'overhead'],
        legend: WRAP,
      },
      {
        id: 'open-the-headers',
        title: 'Open every header',
        reset: true,
        cfg: { trip: { from: 'alice.2', to: 'alice.2', delay: 0.3 } },
        card: 'inspect',
        interaction: 'inspect',
        clickRows: ['alice'],
        body: (
          <>
            <p>
              Your turn to look inside. The frame is parked at Alice’s <Term k="alice.2">data link layer</Term>, fully wrapped. <strong>Click any layer</strong>{' '}
              on the stage, or any colored block, to open its header.
            </p>
            <p>
              Below is the same frame the way <strong>Wireshark</strong> shows it: one line per layer, outermost first. Click a line to expand it. Every value
              is real, computed from this frame’s actual bytes, checksums included.
            </p>
            <Aside>Captures usually say 129 bytes, not 133: the network card checks and strips the 4-byte FCS before the capture tool sees the frame.</Aside>
          </>
        ),
        hud: ['unit', 'size'],
        legend: WRAP.slice(0, 4),
      },
      {
        id: 'who-adds-what',
        title: 'Your turn: who adds what?',
        reset: true,
        cfg: { trip: { from: 'alice.7', to: 'srv.1', loop: true, pause: 1, pace: 1.2 } },
        predict: { kind: 'headers', needed: 3, prompt: 'The data unit is about to enter the next layer down. What will that layer add?' },
        card: 'auto',
        body: (
          <>
            <p>
              The data unit will stop just before each of the lower layers. <strong>Predict what that layer adds</strong> before it goes in.
            </p>
            <p>No scrolling back up. If you miss one, the explanation tells you why, and the next trip gives you another go.</p>
          </>
        ),
        hud: ['unit', 'size'],
        legend: WRAP,
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'hop-by-hop',
    title: 'Hop by hop',
    cfg: { view: 'path' },
    steps: [
      {
        id: 'the-switch',
        title: 'A switch reads only layer 2',
        reset: true,
        cfg: { trip: { from: 'alice.1', to: 'rt.1', loop: true, pause: 1.4, pace: 0.9 } },
        card: 'auto',
        focusDevs: ['alice', 'sw'],
        body: (
          <>
            <p>
              Now follow the frame out into the network. First stop: a <Term k="sw">switch</Term>, the box that connects the machines on Alice’s local
              network.
            </p>
            <p>
              The switch climbs only to layer 2. It reads the <strong>destination MAC</strong>, looks it up in its <strong>MAC address table</strong>, and
              sends the frame out of the one port where that address lives: Gi0/8, toward the router. It never opens the packet inside, and changes nothing.
            </p>
            <p>
              Switches fill that table by themselves: every frame teaches them which port its <em>source</em> MAC lives behind. A frame for an unknown
              address gets flooded out of every other port.
            </p>
          </>
        ),
        code: {
          title: 'switch CLI (Cisco IOS)',
          lang: 'conf',
          code: `
switch> show mac address-table
          Mac Address Table
-------------------------------------------
Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
   1    a64f.219c.3e07    DYNAMIC     Gi0/1
   1    a211.5c02.9b44    DYNAMIC     Gi0/2
!   1    0e5a.c310.7701    DYNAMIC     Gi0/8`,
        },
        hud: ['unit', 'ttl'],
        legend: WRAP.slice(0, 4),
      },
      {
        id: 'the-router',
        title: 'A router reads layer 3, then re-frames',
        reset: true,
        cfg: { trip: { from: 'rt.1', to: 'srv.1', loop: true, pause: 2.6, pace: 0.8, delay: 0.6 } },
        card: 'auto',
        focusDevs: ['rt', 'srv'],
        body: (
          <>
            <p>
              Next stop: the <Term k="rt">router</Term> joining Alice’s network to the server’s. A router climbs one layer higher than a switch.
            </p>
            <p>
              At layer 2 it checks the frame is addressed to itself, then <strong>throws the frame away</strong>. At layer 3 it reads the destination IP,
              finds the best match in its <strong>routing table</strong> and counts the <strong>TTL</strong> down from 64 to 63. Then it wraps the packet in a{' '}
              <strong>brand-new frame</strong>: its own MAC as the source, the server’s as the destination.
            </p>
            <p>
              The IP addresses never change: they name the two ends of the whole journey. MAC addresses only name the two ends of one link, so they change at
              every hop.
            </p>
            <Aside>
              Most home routers also do NAT: they rewrite Alice’s private source address and port to their own public ones. That’s an extra job bolted onto
              the router, and it has its own lesson.
            </Aside>
          </>
        ),
        code: {
          title: 'tcpdump -e -v (trimmed)',
          lang: 'shell',
          code: `
# on Alice's laptop
!a6:4f:21:9c:3e:07 > 0e:5a:c3:10:77:01
!  (ttl 64, id 15389, proto TCP (6), length 115)
  198.51.100.23.51234 > 203.0.113.10.80
# on the server
!0e:5a:c3:10:77:02 > 52:54:00:8a:2f:d3
!  (ttl 63, id 15389, proto TCP (6), length 115)
  198.51.100.23.51234 > 203.0.113.10.80`,
          note: 'Same packet, two captures: new MACs, TTL one lower, identical IP addresses and ports.',
        },
        hud: ['unit', 'ttl'],
        legend: WRAP.slice(0, 4),
      },
      {
        id: 'switch-or-router',
        title: 'Your turn: switch or router?',
        reset: true,
        cfg: { trip: { from: 'alice.1', to: 'srv.4', loop: true, pause: 1.2, pace: 1.1 } },
        predict: { kind: 'hops', needed: 3, prompt: 'The frame is frozen at a device. What happens next?' },
        card: 'auto',
        body: (
          <>
            <p>Same journey, but now the frame freezes at each device and you call it before it happens.</p>
            <p>
              Keep two rules in mind. A <Term k="sw">switch</Term> reads the frame and nothing else. A <Term k="rt">router</Term> reads the packet, and every
              hop gets a fresh frame.
            </p>
          </>
        ),
        hud: ['unit', 'ttl'],
        legend: WRAP.slice(0, 4),
      },
      {
        id: 'up-the-stack',
        title: 'Up the stack at the other end',
        reset: true,
        cfg: { view: 'stack', trip: { from: 'srv.1', to: 'srv.7', loop: true, pause: 2.2, pace: 0.8 } },
        card: 'demux',
        focusDevs: ['srv'],
        body: (
          <>
            <p>
              At the server the frame climbs the stack, and each layer peels off its own header: <strong>decapsulation</strong>.
            </p>
            <p>
              Every header also says who gets the payload next. EtherType <code>0x0800</code> means “IPv4 inside”. IP protocol <code>6</code> means “TCP
              inside”. Destination port 80 picks the program: <Term k="srv.7">nginx</Term>, which has been waiting on that port.
            </p>
            <p>
              Each layer also checks the delivery is really for this machine: a frame for someone else’s MAC, or a packet for someone else’s IP, is dropped.
              Then nginx reads <code>GET /</code>, sends back a page, and the whole trip runs again in reverse.
            </p>
          </>
        ),
        code: {
          title: 'ss -ltnp on the server',
          lang: 'shell',
          code: `
$ sudo ss -ltnp
State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
!LISTEN  0       511     0.0.0.0:80          0.0.0.0:*          users:(("nginx",pid=812,fd=6))`,
          note: 'A program that listens on a port is what layer 4 delivers to. No listener means a reset, as you’ll see in chapter 6.',
        },
        hud: ['unit', 'size'],
        legend: WRAP.slice(0, 4),
      },
      {
        id: 'traceroute',
        title: 'TTL at work: traceroute',
        reset: true,
        cfg: { view: 'chain', trip: null },
        script: [{ at: 0.6, run: (s) => s.startTraceroute() }],
        card: 'trace',
        interaction: 'ttl',
        body: (
          <>
            <p>
              On the real internet there are many routers between Alice and the server. The TTL countdown powers a classic tool that finds them all:{' '}
              <strong>traceroute</strong>.
            </p>
            <p>
              It sends a probe with TTL 1. The first router counts it down to 0, drops it, and sends back an ICMP <strong>“time exceeded”</strong> message,
              revealing its address. TTL 2 dies at the second router, and so on, until a probe reaches the server itself.
            </p>
            <p>
              Now send your own. What’s the smallest TTL that makes it all the way to <code>shop.example</code>?
            </p>
            <Aside>
              Linux traceroute sends UDP probes to unused high ports (33434 and up), three per hop. The server answers with ICMP “port unreachable”, which is
              how traceroute knows it has arrived.
            </Aside>
          </>
        ),
        code: {
          title: 'traceroute -n shop.example',
          lang: 'shell',
          code: `
$ traceroute -n shop.example
traceroute to shop.example (203.0.113.10), 30 hops max, 60 byte packets
 1  198.51.100.1  0.412 ms  0.388 ms  0.371 ms
 2  192.0.2.1  8.123 ms  8.090 ms  8.211 ms
 3  192.0.2.33  11.706 ms  11.698 ms  11.652 ms
 4  192.0.2.66  14.310 ms  14.288 ms  14.301 ms
! 5  203.0.113.10  14.452 ms  14.447 ms  14.439 ms`,
        },
        hud: ['hops'],
        legend: [
          { label: 'probe', color: SIG.req },
          { label: 'ICMP reply', color: SIG.hc },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'models',
    title: 'Models and maps',
    cfg: { view: 'stack' },
    steps: [
      {
        id: 'tcp-ip',
        title: 'The four layers the internet runs on',
        reset: true,
        cfg: { trip: { ...FULL_TRIP, pause: 1.6 } },
        interaction: 'model',
        body: (
          <>
            <p>
              As chapter 1 warned, the internet doesn’t run on the OSI model. It runs on <strong>TCP/IP</strong>, designed in the 1970s, which has four
              layers. Flip the switch below to see how they line up.
            </p>
            <p>
              TCP/IP folds layers 5, 6 and 7 into one <strong>application</strong> layer, because in practice they all live inside the program. It calls
              layer 3 the <strong>internet</strong> layer and merges 1 and 2 into <strong>link</strong>. The bytes don’t change at all: same frame, fewer
              boxes.
            </p>
            <p>
              So why learn seven? OSI lost the protocol war but won the vocabulary. Engineers still say “layer 2 switch”, “layer 4 load balancer” and “layer
              7 firewall”.
            </p>
            <Aside>Some textbooks use a five-layer hybrid that splits link back into data link and physical. Same idea, different box count.</Aside>
          </>
        ),
        code: {
          title: 'client.py',
          lang: 'python',
          code: `
import socket

# The OS and the network card do layers 1-4 (TCP, IP, Ethernet)
!s = socket.create_connection(("shop.example", 80))
# Your program does 5-7: HTTP, plus TLS if you add it
!s.sendall(b"GET / HTTP/1.1\\r\\nHost: shop.example\\r\\n\\r\\n")
print(s.recv(4096))`,
        },
        hud: ['unit', 'size'],
        legend: WRAP,
      },
      {
        id: 'sort-it-out',
        title: 'Sort it out',
        reset: true,
        cfg: { view: 'single', trip: null },
        interaction: 'sort',
        clickRows: ['ref'],
        body: (
          <>
            <p>
              Time to file things where they belong. Twelve protocols, devices and addresses are coming. For each one, <strong>click the layer it lives at</strong>,
              on the stage or in the card below.
            </p>
            <p>Devices are named after the highest layer they read. That’s why people say “layer 2 switch” and “layer 3 router”.</p>
          </>
        ),
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'debugging',
    title: 'Debugging by layer',
    cfg: { view: 'path' },
    steps: [
      {
        id: 'bottom-up',
        title: 'Troubleshoot from the bottom up',
        reset: true,
        cfg: { trip: { ...FULL_TRIP, pause: 1.6, pace: 2.2 } },
        interaction: 'break',
        body: (
          <>
            <p>
              The model’s most practical use: when something breaks, check the layers from the bottom up. Is it plugged in (1)? Is the link up (2)? Is there
              an IP address and a route (3)? Is the port open (4)? Does the app answer (7)?
            </p>
            <p>
              Break things below and watch where the request dies. Each failure leaves a different fingerprint in Alice’s terminal, and the fingerprint tells
              you the layer.
            </p>
          </>
        ),
        code: {
          title: 'a bottom-up checklist',
          lang: 'shell',
          code: `
# 1-2  is the link up? (look for LOWER_UP)
ip link show eth0
# 3    can I reach the gateway? the server?
ping -c 3 198.51.100.1
ping -c 3 203.0.113.10
# 4    is anything listening on the port?
nc -vz shop.example 80
# 7    does DNS resolve? does HTTP answer?
dig +short shop.example
curl -I http://shop.example/`,
        },
        hud: ['status'],
        legend: [
          { label: 'ICMP error', color: SIG.hc },
          { label: 'TCP reset / HTTP error', color: SIG.err },
        ],
      },
      {
        id: 'name-that-layer',
        title: 'Name the broken layer',
        reset: true,
        cfg: { trip: null },
        predict: { kind: 'symptoms', needed: 3, prompt: 'Alice’s terminal shows this. Which layer is broken?' },
        body: (
          <>
            <p>
              Now the other way around. Alice’s terminal shows an error: <strong>name the broken layer</strong>, then watch the request fail right there.
            </p>
            <p>
              Read the tool, not just the words. <code>ip link</code> and <code>iw</code> report on links, <code>ping</code> on IP, and curl’s error tells you
              how far it got.
            </p>
          </>
        ),
        hud: ['status'],
        legend: [
          { label: 'ICMP error', color: SIG.hc },
          { label: 'TCP reset / HTTP error', color: SIG.err },
        ],
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
        reset: true,
        cfg: { view: 'stack', trip: { ...FULL_TRIP, pause: 1.6 } },
        interaction: 'cheatsheet',
        body: <p>The whole model on one page. The stage keeps the full trip running for reference.</p>,
        hud: ['unit', 'size'],
        legend: WRAP,
      },
      {
        id: 'playground',
        title: 'Playground',
        reset: true,
        cfg: { view: 'path', trip: { ...FULL_TRIP, pause: 1.4 } },
        interaction: 'playground',
        card: 'auto',
        body: (
          <p>
            Everything in one sandbox. Pick what Alice sends, how she’s connected and how you see it. Every header, checksum and bit on the stage is computed
            from the real bytes.
          </p>
        ),
        hud: ['unit', 'size', 'ttl'],
        legend: [L(7, 'data'), L(6, 'TLS'), L(4, 'TCP/UDP'), L(3, 'IP'), L(2, 'Ethernet/802.11')],
      },
    ],
  },
];
