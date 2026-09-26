import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import type { Chapter } from './types';

export const META = { slug: 'nat', code: 'NET-07', track: 'Networking', title: 'IP, Subnets & NAT' };

const LG: Record<string, LegendItem> = {
  req: { label: 'request', color: SIG.req },
  res: { label: 'response', color: SIG.res },
  frame: { label: 'frame', color: SIG.req },
  reply: { label: 'reply frame', color: SIG.res },
  arp: { label: 'ARP', color: SIG.hc, shape: 'square' },
  inbound: { label: 'inbound from Carol', color: SIG.heavy },
  drop: { label: 'dropped', color: SIG.err, shape: 'ring' },
  stun: { label: 'STUN / signaling', color: SIG.hc },
  peer: { label: 'peer-to-peer', color: SIG.req },
  net: { label: 'network bits', color: SIG.blue, shape: 'square' },
  host: { label: 'host bits', color: SIG.lime, shape: 'square' },
  prefix: { label: 'network prefix', color: SIG.blue, shape: 'square' },
  iid: { label: 'interface ID', color: SIG.lime, shape: 'square' },
  priv: { label: 'private (RFC 1918)', color: SIG.teal, shape: 'square' },
};

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'addresses',
    title: 'Addresses',
    cfg: { view: 'bits', rows: ['addr'], prefix: 24 },
    steps: [
      {
        id: 'thirty-two-bits',
        title: 'An address is 32 bits',
        cfg: { flip: true, places: true },
        body: (
          <>
            <p>
              Every device on a network has an <strong>IP address</strong>. IPv4, the version most of the internet still runs on, uses a plain{' '}
              <strong>32-bit number</strong>. Nobody wants to read 11000000101010000000000100010111, so we cut it into four 8-bit{' '}
              <strong>octets</strong> and write each one in decimal, with dots in between: 192.168.1.23.
            </p>
            <p>
              An octet runs from 00000000 (0) to 11111111 (255). Read it like any number: each position is worth twice the one on its right, 128 64 32
              16 8 4 2 1. So 11000000 is 128 + 64 = 192.
            </p>
            <p>
              <strong>Your turn:</strong> click any bit to flip it and watch its octet change. An address really is just a number: this one is
              3,232,235,799.
            </p>
          </>
        ),
        hint: 'Click any bit to flip it',
        hintDone: (s) => s.lastFlip != null,
        actions: {
          buttons: [
            {
              label: 'All ones',
              run: (s) => s.setAddr('255.255.255.255'),
              after: <>Every bit set: 255.255.255.255, the largest possible address. 255 is as high as eight bits go.</>,
            },
            {
              label: 'All zeros',
              run: (s) => s.setAddr('0.0.0.0'),
              after: <>0.0.0.0, the smallest. Software uses it to mean “any address” or “no address yet”.</>,
            },
            { label: 'Back to 192.168.1.23', icon: 'replay', run: (s) => s.setAddr('192.168.1.23') },
          ],
        },
        hud: ['bits', 'addrs'],
        side: ['octet'],
        strip: 'octet',
        code: {
          title: 'python3',
          lang: 'python',
          code: `
>>> import ipaddress
>>> ip = ipaddress.ip_address('192.168.1.23')
!>>> int(ip)
3232235799
>>> f'{int(ip):032b}'
'11000000101010000000000100010111'`,
        },
      },
      {
        id: 'running-out',
        title: 'Only 4.3 billion of them',
        cfg: { view: 'map', map: 'fill' },
        body: (
          <>
            <p>
              32 bits give 2³² = <strong>4,294,967,296</strong> addresses. In 1981, when IPv4 was standardized, that sounded endless.
            </p>
            <p>
              This map is the entire IPv4 space. Each square is a <strong>/8 block</strong>: every address that starts with the same first octet, 16,777,216
              of them. Some are <Term k="map:reserved">reserved</Term> (127 is loopback, 224–239 multicast, 240–255 “future use”), leaving about 3.7
              billion for public use. That&apos;s less than one per person on Earth, never mind one per phone, laptop, TV and doorbell.
            </p>
            <p>
              <strong>IANA</strong>, which hands blocks to the five regional registries, gave out its last ones on 3 February 2011, and the registries ran
              dry over the following decade. Today IPv4 addresses are bought and sold, for tens of dollars each.
            </p>
            <Aside>
              The order the map fills in is illustrative, except the finale: 39 and 106 went to APNIC in January 2011, then the last five, one per
              registry, on 3 February.
            </Aside>
          </>
        ),
        hud: ['addrs', 'free'],
        side: ['pool'],
        strip: 'pool',
        code: {
          title: 'IANA IPv4 registry (excerpt)',
          lang: 'conf',
          code: `
# Prefix  Designation  Date     Status
039/8     APNIC        2011-01  ALLOCATED
106/8     APNIC        2011-01  ALLOCATED
!102/8     AFRINIC      2011-02  ALLOCATED
!103/8     APNIC        2011-02  ALLOCATED
!104/8     ARIN         2011-02  ALLOCATED
!179/8     LACNIC       2011-02  ALLOCATED
!185/8     RIPE NCC     2011-02  ALLOCATED`,
          note: 'After these five, IANA had no unallocated IPv4 /8 blocks left.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'subnets',
    title: 'Subnets',
    cfg: { view: 'bits', prefix: 24 },
    steps: [
      {
        id: 'network-and-host',
        title: 'Network part, host part',
        cfg: { rows: ['addr', 'mask', 'net'], andAnim: true },
        body: (
          <>
            <p>
              An IP address has two parts. The first bits name the <Term k="bits:net">network</Term>, like a street. The rest name the{' '}
              <Term k="bits:host">host</Term>, a house on that street. Everything on your home network shares the first 24 bits, 192.168.1, and only the
              last 8 differ.
            </p>
            <p>
              The split is written after a slash: 192.168.1.23<strong>/24</strong>. That&apos;s <strong>CIDR notation</strong>, and 24 is the{' '}
              <strong>prefix length</strong>. Older tools write the same thing as a <strong>subnet mask</strong>: 24 one-bits then 8 zero-bits, which is
              255.255.255.0.
            </p>
            <p>
              To find an address&apos;s network, <strong>AND</strong> it with the mask, bit by bit: a 1 survives only where the mask has a 1. The host
              bits are wiped to zero, and what&apos;s left is the <strong>network address</strong>, 192.168.1.0.
            </p>
          </>
        ),
        side: ['prefix'],
        strip: 'prefix',
        legend: [LG.net, LG.host],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ip addr show wlan0
3: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP
    link/ether 00:00:5e:00:53:23 brd ff:ff:ff:ff:ff:ff
!    inet 192.168.1.23/24 brd 192.168.1.255 scope global dynamic wlan0`,
          note: 'macOS prints the same thing with the mask in hex: inet 192.168.1.23 netmask 0xffffff00 broadcast 192.168.1.255',
        },
      },
      {
        id: 'slide-the-prefix',
        title: 'Slide the prefix',
        cfg: { rows: ['addr', 'mask', 'net', 'bcast'], prefix: 26 },
        prefixCard: true,
        body: (
          <>
            <p>
              <strong>Drag the prefix.</strong> Each bit you move from the network side to the host side doubles the size of the subnet: a /24 holds 256
              addresses, a /23 512, a /16 65,536.
            </p>
            <p>
              Two addresses in every subnet are taken. All host bits 0 is the <strong>network address</strong>, the name of the subnet itself. All host
              bits 1 is the <strong>broadcast address</strong>, which reaches every host on it. That&apos;s why a /24 has 254 usable addresses, .1 to
              .254.
            </p>
            <p>
              The split doesn&apos;t have to land on a dot. A /26 cuts a /24 into four subnets of 64: .0, .64, .128 and .192. That&apos;s where the
              odd-looking mask 255.255.255.192 comes from.
            </p>
            <Aside>
              A /31 has no room for a network and a broadcast address, so point-to-point links may use both of its addresses as hosts (RFC 3021). A /32
              names exactly one host.
            </Aside>
          </>
        ),
        side: ['prefix'],
        strip: 'prefix',
        legend: [LG.net, LG.host],
        code: {
          title: 'python3',
          lang: 'python',
          code: `
>>> net = ipaddress.ip_network('192.168.1.0/26')
>>> net.netmask, net.broadcast_address
(IPv4Address('255.255.255.192'), IPv4Address('192.168.1.63'))
!>>> net.num_addresses
64`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'delivery',
    title: 'Delivering a packet',
    cfg: { view: 'net', topo: 'home', devices: ['laptop', 'phone', 'tv'], hosts: ['server'] },
    steps: [
      {
        id: 'on-my-network',
        title: 'Same network: deliver it directly',
        cfg: { scenario: 'arp', focus: ['laptop', 'phone', 'tv', 'router'], midY: 0.46 },
        inspect: true,
        body: (
          <>
            <p>
              Your laptop wants to send a packet to the <Term k="tv">TV</Term> at 192.168.1.40. Every host first asks one question: is the destination on{' '}
              <strong>my network</strong>? It ANDs the destination with its own mask: 192.168.1.40 AND 255.255.255.0 = 192.168.1.0, the laptop&apos;s own
              network. So the TV is a neighbor, reachable directly over the same Wi-Fi or Ethernet. No router needed.
            </p>
            <p>
              But a local network doesn&apos;t deliver by IP address. It delivers <strong>frames</strong> to a <strong>MAC address</strong>, the hardware
              address of each network card. To learn the TV&apos;s, the laptop broadcasts an <strong>ARP</strong> request to everyone on the{' '}
              <Term k="bus">LAN</Term>: “Who has 192.168.1.40? Tell 192.168.1.23.” Only the TV answers. The laptop caches the answer and sends its frames
              straight there.
            </p>
            <Aside>
              The MAC addresses here come from the range reserved for documentation (RFC 7042). IPv6 replaces ARP with Neighbor Discovery, which does the
              same job.
            </Aside>
          </>
        ),
        side: ['laptop'],
        strip: 'laptop',
        legend: [LG.arp, LG.frame, LG.reply],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sudo tcpdump -n -t -i wlan0 arp
ARP, Request who-has 192.168.1.40 tell 192.168.1.23, length 28
!ARP, Reply 192.168.1.40 is-at 00:00:5e:00:53:40, length 28

$ ip neigh
!192.168.1.40 dev wlan0 lladdr 00:00:5e:00:53:40 REACHABLE`,
        },
      },
      {
        id: 'the-default-gateway',
        title: 'Everywhere else: the gateway',
        cfg: { scenario: 'gateway' },
        inspect: true,
        body: (
          <>
            <p>
              Now the laptop sends to a <Term k="server">web server</Term> at 198.51.100.20. AND with the mask gives 198.51.100.0: not my network. The laptop
              can&apos;t reach it directly, so it hands the packet to its <strong>default gateway</strong>, the <Term k="router">router</Term> at
              192.168.1.1, whose job is moving packets between networks.
            </p>
            <p>
              Look at the frame. The <strong>MAC</strong> destination is the router, but the <strong>IP</strong> destination is still the server. The
              laptop ARPs for the gateway, never for the server. IP addresses name the two ends; MAC addresses only carry the packet across one link, and
              change at every hop.
            </p>
            <p>
              The router checks its <strong>routing table</strong> and takes the most specific route that matches. For anything outside the home, that&apos;s
              the <strong>default route</strong>, 0.0.0.0/0, which matches every address and points at the ISP. Every router along the way repeats the
              same lookup.
            </p>
          </>
        ),
        side: ['laptop', 'rt'],
        strip: 'laptop',
        legend: [LG.arp, LG.frame, LG.res],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ip route
!default via 192.168.1.1 dev wlan0 proto dhcp
192.168.1.0/24 dev wlan0 proto kernel scope link

$ ip route get 198.51.100.20
!198.51.100.20 via 192.168.1.1 dev wlan0 src 192.168.1.23
$ ip route get 192.168.1.40
192.168.1.40 dev wlan0 src 192.168.1.23`,
          note: 'Only the non-local destination goes "via" the gateway.',
        },
      },
      {
        id: 'direct-or-gateway',
        title: 'Direct, or via the gateway?',
        cfg: { scenario: 'predict-gw', devices: ['laptop', 'tv', 'guest'], timeout: 600, midY: 0.46 },
        predict: { kind: 'gw', needed: 3, prompt: 'Is the destination on the laptop’s own network?' },
        body: (
          <>
            <p>
              <strong>Your turn.</strong> The laptop has packets for different addresses, and its prefix changes between questions. For each one, decide:
              is the destination on the laptop&apos;s own network (<strong>deliver directly</strong>) or somewhere else (<strong>send it to the gateway</strong>)?
            </p>
            <p>
              Do what the laptop does: keep the first <em>prefix</em> bits of both addresses and compare them. With /24 that&apos;s the first three octets.
              With /16 it&apos;s only the first two. With /26 the top two bits of the last octet count too, so write that octet out in binary.
            </p>
          </>
        ),
        side: ['laptop'],
        strip: 'laptop',
        legend: [LG.req],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'private',
    title: 'Private addresses',
    steps: [
      {
        id: 'private-ranges',
        title: 'Addresses every home reuses',
        cfg: { view: 'map', map: 'private' },
        body: (
          <>
            <p>
              Here&apos;s the trick that kept IPv4 alive. RFC 1918 (1996) set aside three blocks as <strong>private addresses</strong>:{' '}
              <Term k="map:10">10.0.0.0/8</Term>, <Term k="map:172">172.16.0.0/12</Term> and <Term k="map:192">192.168.0.0/16</Term>. Anyone can use them
              inside their own network without asking anyone.
            </p>
            <p>
              Your router runs a <strong>DHCP</strong> server that leases these addresses to your devices, along with the mask and the gateway. That&apos;s
              how the laptop got 192.168.1.23. Millions of other laptops have the very same address right now, and that&apos;s fine, because of one rule:
              private addresses are <strong>never routed on the public internet</strong>. Internet routers simply have no route for them.
            </p>
            <p>So a home, or a whole company, can number thousands of devices without using up a single public address. But then how do they reach the internet at all?</p>
          </>
        ),
        side: ['ranges'],
        strip: 'ranges',
        legend: [LG.priv],
        quiz: {
          question: 'Which of these addresses is private (RFC 1918)?',
          options: [
            { text: '172.32.0.5', why: '172.16.0.0/12 covers only 172.16.x.x to 172.31.x.x. 172.32 is outside it, so this is an ordinary public address.' },
            { text: '192.168.50.1', correct: true, why: 'Anything in 192.168.0.0/16 is private, whatever the third octet.' },
            { text: '11.0.0.1', why: 'Only 10.0.0.0/8 is private. 11.x.x.x is public space.' },
            { text: '100.64.1.1', why: 'Close: 100.64.0.0/10 is reserved too, but as shared space for ISPs (chapter 7), not by RFC 1918.' },
          ],
        },
        code: {
          title: 'router: /etc/dnsmasq.conf',
          lang: 'conf',
          code: `
# lease .10 to .250 for 12 hours (the mask
# comes from the LAN interface: /24)
!dhcp-range=192.168.1.10,192.168.1.250,12h
dhcp-option=option:router,192.168.1.1
dhcp-option=option:dns-server,192.168.1.1`,
        },
      },
      {
        id: 'no-way-home',
        title: 'A reply with no way home',
        cfg: { view: 'net', topo: 'two', hosts: ['server'], scenario: 'no-nat', timeout: 600 },
        inspect: true,
        body: (
          <>
            <p>
              Here are two homes. <Term k="laptop">Alice&apos;s laptop</Term> and <Term k="bob">Bob&apos;s laptop</Term> both got 192.168.1.23 from their
              routers. No conflict: the two networks never see each other.
            </p>
            <p>
              Now suppose the routers simply forwarded packets unchanged. Alice&apos;s request, with source 192.168.1.23, might even reach the{' '}
              <Term k="server">server</Term>. But the reply is addressed to 192.168.1.23, and the internet has no route to it. And if it did: which
              192.168.1.23? Alice&apos;s, Bob&apos;s, or one of the millions of others?
            </p>
            <p>The reply dies in the middle of the internet. A private address can send, but it can&apos;t be answered. It needs a public address to hide behind.</p>
            <Aside>In practice many ISPs already drop packets with private source addresses as they leave a customer (source filtering, BCP 38).</Aside>
          </>
        ),
        legend: [LG.req, LG.res, LG.drop],
        code: {
          title: 'route-views.routeviews.org',
          lang: 'shell',
          code: `
# a public view of the internet's routing table
route-views> show ip bgp 192.168.1.23
!% Network not in table`,
          note: 'Route Views collects BGP routes from networks all over the world. Not one of them announces a route to private space.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'nat',
    title: 'Network address translation',
    cfg: { view: 'net', topo: 'home', devices: ['laptop', 'phone', 'tv'], hosts: ['server'] },
    steps: [
      {
        id: 'rewrite-the-source',
        title: 'The router rewrites the source',
        cfg: { scenario: 'rewrite', timeout: 600 },
        inspect: true,
        body: (
          <>
            <p>
              The fix is <strong>network address translation</strong>, NAT. Your <Term k="router">router</Term> has two addresses: 192.168.1.1 on the home
              network, and one <strong>public</strong> address from your ISP, 203.0.113.7, on the internet side.
            </p>
            <p>
              Besides two addresses, every TCP or UDP packet carries two <strong>ports</strong>, 16-bit numbers that tell a host&apos;s conversations apart.
              The server listens on 443 (HTTPS); the laptop picked 51000 for its end of this one.
            </p>
            <p>
              As the packet passes through, the router <strong>rewrites the source</strong> from 192.168.1.23:51000 to its public address and a port of
              its choosing, 203.0.113.7:40001, and records the pair in its <Term k="router:nat">NAT table</Term>. The <Term k="server">server</Term> sees
              an ordinary public address it can answer. It has no idea your laptop exists.
            </p>
            <Aside>
              Which public port gets picked is up to the router. Linux keeps the device&apos;s own port when it&apos;s free and changes it only on a clash;
              many routers pick from their own range, as this one does.
            </Aside>
          </>
        ),
        side: ['nat', 'server'],
        strip: 'nat',
        legend: [LG.req, LG.res],
        code: {
          title: 'router: iptables',
          lang: 'shell',
          code: `
# source NAT for everything leaving eth0 (WAN)
!iptables -t nat -A POSTROUTING -o eth0 \\
!  -j MASQUERADE
# and forward packets between the ports at all
sysctl -w net.ipv4.ip_forward=1`,
          note: 'MASQUERADE is source NAT to whatever address eth0 has right now. Home routers do exactly this.',
        },
      },
      {
        id: 'and-back-again',
        title: '…and rewrites the reply back',
        cfg: { scenario: 'reply', timeout: 600 },
        inspect: true,
        body: (
          <>
            <p>
              The server answers the address it saw, 203.0.113.7:40001. The reply reaches your router, which looks up port 40001 in its NAT table, finds the
              laptop&apos;s row, and <strong>rewrites the destination</strong> back to 192.168.1.23:51000.
            </p>
            <p>
              The laptop believes it talked straight to 198.51.100.20. The server believes it talked to 203.0.113.7. Only the router knows both sides. It
              rewrites every packet of the connection, in both directions, and fixes up the checksums as it goes.
            </p>
            <p>
              A row describes a whole conversation, not just a port. On Linux a packet for :40001 only matches if it comes from 198.51.100.20:443, the
              address the laptop was talking to.
            </p>
          </>
        ),
        side: ['nat', 'server'],
        strip: 'nat',
        legend: [LG.req, LG.res],
        code: {
          title: 'router: conntrack',
          lang: 'shell',
          code: `
$ sudo conntrack -L -p tcp
tcp  6 431999 ESTABLISHED
  # the packet as the laptop sent it
!  src=192.168.1.23 dst=198.51.100.20
!    sport=51000 dport=443
  # the reply the router expects back
!  src=198.51.100.20 dst=203.0.113.7
!    sport=443 dport=40001
  [ASSURED] mark=0 use=1`,
          note: 'One entry per connection, wrapped here for readability. 431999 is the seconds left before it expires.',
        },
      },
      {
        id: 'many-devices',
        title: 'Many devices, one address',
        cfg: { scenario: 'many', timeout: 26 },
        body: (
          <>
            <p>
              Now the whole household is online. Each new connection gets its own row and its own public port, so one public address carries thousands of
              conversations at once. Since ports get rewritten too, the proper name is <strong>NAPT</strong> (network address and port translation) or
              PAT. Everyone just says NAT.
            </p>
            <p>
              Look at the first two rows: the <Term k="laptop">laptop</Term> and the <Term k="phone">phone</Term> both picked source port 51000. No problem.
              The router gives them different public ports, so their replies can&apos;t be confused.
            </p>
            <p>
              Rows don&apos;t live forever. When a connection closes or goes quiet for too long, the router forgets it: watch the idle bars run down. Apps
              that hold a connection open for hours send small keepalive packets so their row survives.
            </p>
            <Aside>
              Ports are 16 bits, so a public address has about 64,000 per protocol. A router can reuse one public port for connections to different
              destinations, so the practical limit is higher.
            </Aside>
          </>
        ),
        hud: ['devices', 'public', 'mappings'],
        side: ['nat'],
        strip: 'nat',
        legend: [LG.req, LG.res],
        code: {
          title: 'router: conntrack timeouts',
          lang: 'shell',
          code: `
$ cd /proc/sys/net/netfilter
$ cat nf_conntrack_udp_timeout
!30
$ cat nf_conntrack_tcp_timeout_established
!432000`,
          note: 'Linux defaults: an idle UDP mapping lasts 30 seconds, an established TCP connection 5 days.',
        },
      },
      {
        id: 'what-the-server-sees',
        title: 'What does the server see?',
        cfg: { scenario: 'predict-nat', hosts: ['server', 'carol'], timeout: 600 },
        inspect: true,
        predict: { kind: 'nat', needed: 3, prompt: 'Predict what the router does with the waiting packet.' },
        body: (
          <>
            <p>
              <strong>Your turn.</strong> Packets will stop at the router before it translates them. Use the NAT table to predict what happens next: the
              address the server will see, which device a reply belongs to, what the router does when ports clash.
            </p>
            <p>
              Two rules cover everything. Going <strong>out</strong>, the router swaps the private source for its public address and a port, and records
              the pair. Coming <strong>in</strong>, it looks the destination port up in the table and reverses the swap, or drops the packet if there&apos;s
              no row.
            </p>
          </>
        ),
        side: ['nat', 'server'],
        strip: 'nat',
        legend: [LG.req, LG.res, LG.inbound],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'inbound',
    title: 'The catch: inbound',
    cfg: { view: 'net', topo: 'home', devices: ['laptop', 'phone', 'tv'], hosts: ['server', 'carol'] },
    steps: [
      {
        id: 'knock-knock',
        title: 'Nobody asked for this packet',
        cfg: { scenario: 'inbound', timeout: 60 },
        inspect: true,
        body: (
          <>
            <p>
              NAT works because the inside <strong>starts</strong> the conversation: the outgoing packet creates the row that lets the reply back in. Now
              flip it around.
            </p>
            <p>
              Your laptop runs a small web server on port 8080, and your friend <Term k="carol">Carol</Term> wants to open it. She can&apos;t use
              192.168.1.23, which is private, so she aims at your public address: 203.0.113.7:8080. <strong>Try it.</strong>
            </p>
            <p>
              The router looks for a row with outside port 8080, finds none, and drops the packet. That&apos;s why hosting a game, a camera or a website
              at home doesn&apos;t just work. As a side effect NAT blocks unsolicited inbound traffic, so it&apos;s often mistaken for a firewall. It
              isn&apos;t one: that protection is an accident of how it keeps its table.
            </p>
          </>
        ),
        actions: {
          prompt: 'Carol opens http://203.0.113.7:8080.',
          buttons: [
            {
              label: 'Connect from the internet',
              icon: 'arrowRight',
              run: (s) => s.carolConnect(),
              after: (
                <>
                  Dropped at the router again. No row for port 8080 means no idea which device, if any, should get it. Carol&apos;s browser just waits
                  and times out.
                </>
              ),
            },
          ],
        },
        hud: ['inbound', 'drops'],
        side: ['nat', 'carol'],
        strip: 'nat',
        legend: [LG.req, LG.res, LG.inbound, LG.drop],
        code: {
          title: "Carol's terminal",
          lang: 'shell',
          code: `
$ nc -vz -w 5 203.0.113.7 8080
!nc: connect to 203.0.113.7 port 8080 (tcp) timed out: Operation now in progress`,
        },
      },
      {
        id: 'port-forwarding',
        title: 'Port forwarding',
        cfg: { scenario: 'forward', timeout: 60 },
        inspect: true,
        hint: 'Add the rule, then connect',
        hintDone: (s) => s.hasForward(),
        body: (
          <>
            <p>
              The fix is to write the row yourself. A <strong>port forward</strong> is a permanent row in the NAT table: anything arriving on port 8080
              goes to 192.168.1.23:8080.
            </p>
            <p>
              <strong>Add the rule, then have Carol connect again.</strong> This time the router rewrites the <strong>destination</strong> on the way in,
              tracks the connection like any other, and rewrites the source of the laptop&apos;s replies on the way out.
            </p>
            <p>
              Two practical notes. Give the laptop a fixed address with a DHCP reservation, or one day the forward will point at the wrong device. And apps
              can open forwards themselves through <strong>UPnP</strong> or <strong>NAT-PMP/PCP</strong>. Game consoles do. Convenient, but it also means
              any program on your network can open a door.
            </p>
          </>
        ),
        actions: {
          buttons: [
            {
              label: 'Add port forward :8080',
              icon: 'plus',
              run: (s) => s.addForward(true),
              after: <>A static row appears: port 8080, from anyone, to 192.168.1.23:8080. Now let Carol connect.</>,
            },
            {
              label: 'Connect from the internet',
              icon: 'arrowRight',
              run: (s) => s.carolConnect(),
              after: <>With the rule, the router rewrites the destination on the way in. Without it, the packet dies at the router.</>,
            },
            { label: 'Remove the rule', icon: 'minus', run: (s) => s.removeForward() },
          ],
        },
        hud: ['inbound'],
        side: ['nat', 'carol'],
        strip: 'nat',
        legend: [LG.inbound, LG.res, LG.drop],
        code: {
          title: 'router: iptables',
          lang: 'shell',
          code: `
# WAN port 8080 → the laptop's port 8080
!iptables -t nat -A PREROUTING -i eth0 \\
!  -p tcp --dport 8080 \\
!  -j DNAT --to-destination 192.168.1.23:8080
# and let the forwarded traffic through
iptables -A FORWARD -i eth0 -p tcp \\
  -d 192.168.1.23 --dport 8080 -j ACCEPT`,
        },
      },
      {
        id: 'hole-punching',
        title: 'Peer to peer: punching a hole',
        cfg: { topo: 'two', hosts: ['server', 'stun'], scenario: 'p2p', timeout: 600 },
        inspect: true,
        body: (
          <>
            <p>
              Video calls and games want two devices, each behind its own NAT, to talk directly. Neither router accepts unsolicited packets, so both sides
              have to “start” the conversation.
            </p>
            <p>
              First, each asks a <Term k="stun">STUN server</Term> “what address do you see me as?” and learns its public mapping: Alice is
              203.0.113.7:40001. They swap these through the app&apos;s <Term k="server">server</Term>. Then both send straight to the other&apos;s public
              address. Alice&apos;s first packet dies at Bob&apos;s router, but on its way out it added a row to <em>her</em> router. So when Bob&apos;s packet
              arrives, it looks like a reply and gets in. Now both routers have a row: the <strong>hole is punched</strong>.
            </p>
            <p>
              If a router picks a new public port for every destination (a <strong>symmetric NAT</strong>), the address STUN saw is useless to the peer.
              Then the call falls back to relaying every packet through a <strong>TURN</strong> server. WebRTC&apos;s <strong>ICE</strong> tries all of
              these paths automatically.
            </p>
          </>
        ),
        side: ['p2p', 'nat', 'natB'],
        strip: 'p2p',
        legend: [LG.stun, LG.peer, LG.res, LG.drop],
        code: {
          title: 'call.js',
          lang: 'js',
          code: `
const pc = new RTCPeerConnection({
  iceServers: [
!    { urls: 'stun:stun.example.org:3478' },
!    { urls: 'turn:turn.example.org:3478',
!      username: 'alice', credential: 's3cret' },
  ],
});`,
          note: 'ICE gathers host, server-reflexive (from STUN) and relay (TURN) candidates, then keeps the best pair that works.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'beyond',
    title: 'Beyond one NAT',
    steps: [
      {
        id: 'carrier-grade-nat',
        title: 'NAT on top of NAT',
        cfg: { view: 'net', topo: 'cgnat', devices: ['laptop', 'phone'], hosts: ['server', 'carol'], scenario: 'cgnat', forward: true, timeout: 600 },
        inspect: true,
        body: (
          <>
            <p>
              ISPs ran short of IPv4 too. Many of them, and most mobile networks, don&apos;t give your router a public address at all. They put it
              behind their own, much bigger NAT: <strong>carrier-grade NAT</strong> (CGNAT), shared by hundreds or thousands of customers.
            </p>
            <p>
              Your router&apos;s WAN address then comes from <strong>100.64.0.0/10</strong>, a block RFC 6598 reserved for exactly this, and every packet
              is translated twice: 192.168.1.23 becomes 100.64.12.34 at home, then 203.0.113.99 at the <Term k="cgnat">ISP</Term>.
            </p>
            <p>
              The tell-tale sign: the WAN address on your router&apos;s status page doesn&apos;t match what <code>curl ifconfig.me</code> reports. And your
              port forward is now useless, because the ISP&apos;s NAT drops the inbound connection before it ever reaches you. <strong>Try it.</strong>
            </p>
          </>
        ),
        actions: {
          prompt: 'Your router forwards :8080 to the laptop. Carol connects to 203.0.113.99:8080.',
          buttons: [
            {
              label: 'Connect from the internet',
              icon: 'arrowRight',
              run: (s) => s.carolConnect(),
              after: <>Dropped at the ISP&apos;s NAT. The port forward on your own router never even sees the packet.</>,
            },
          ],
        },
        side: ['nat', 'cgnat'],
        strip: 'cgnat',
        legend: [LG.req, LG.res, LG.inbound, LG.drop],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ curl ifconfig.me
!203.0.113.99
# …but the router's status page says: WAN 100.64.12.34`,
        },
      },
      {
        id: 'ipv6',
        title: 'IPv6: an address for everything',
        cfg: { view: 'bits', v6: true },
        body: (
          <>
            <p>
              The real fix is more addresses. <strong>IPv6</strong> addresses are <strong>128 bits</strong> long: 2¹²⁸ ≈ 3.4 × 10³⁸ of them. That&apos;s
              enough for every device on Earth to have its own public address many times over, so there&apos;s nothing to share and nothing to translate.
            </p>
            <p>
              They&apos;re written as eight groups of four hex digits. Leading zeros are dropped, and one run of zero groups can shrink to <code>::</code>,
              so 2001:0db8:0000:0000:0000:0000:0000:0001 is just 2001:db8::1. (2001:db8::/32 is reserved for documentation.)
            </p>
            <p>
              Your ISP gives your home a whole prefix, often a /56 or a /64. Each network inside gets a /64: the first 64 bits are the{' '}
              <Term k="v6:net">network prefix</Term>, and each device picks its own 64-bit <Term k="v6:host">interface ID</Term>. The router just routes.
              What NAT did by accident, blocking unsolicited inbound connections, an IPv6 router does on purpose with a stateful firewall.
            </p>
            <Aside>
              More than 40% of users now reach Google over IPv6. IPv4 and IPv6 will run side by side (“dual stack”) for years, which is why NAT isn&apos;t
              going anywhere soon.
            </Aside>
          </>
        ),
        hud: ['v6'],
        side: ['v6'],
        strip: 'v6',
        legend: [LG.prefix, LG.iid],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ip -6 addr show wlan0
!  inet6 2001:db8:4f3a:10:8d1c:4b2e:9a07:5e13/64
       scope global dynamic
  inet6 fe80::8d1c:4b2e:9a07:5e13/64 scope link
$ curl -6 ifconfig.me
!2001:db8:4f3a:10:8d1c:4b2e:9a07:5e13`,
          note: 'The address the world sees is the laptop’s own. Nothing rewrote it.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    cfg: { view: 'net', topo: 'home', devices: ['laptop', 'phone', 'tv'], hosts: ['server', 'carol'] },
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { scenario: 'cheat', forward: true, timeout: 30 },
        body: (
          <p>
            Everything in one picture: three devices sharing one public address through the NAT table, and a port forward that lets Carol reach the
            laptop&apos;s web server.
          </p>
        ),
        cheat: true,
        side: ['nat', 'carol'],
        strip: 'nat',
        legend: [LG.req, LG.res, LG.inbound],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { scenario: 'play', timeout: 30 },
        body: (
          <p>
            All the knobs in one place. Switch devices on and off, add or remove the port forward, let Carol knock, and change how long the router
            remembers an idle mapping. The TV streams video: its server pushes a packet every 8 seconds to the address it saw. Then try the challenges.
          </p>
        ),
        playground: true,
        hud: ['devices', 'mappings', 'drops'],
        side: ['nat', 'carol'],
        strip: 'nat',
        legend: [LG.req, LG.res, LG.inbound, LG.drop],
      },
    ],
  },
];
