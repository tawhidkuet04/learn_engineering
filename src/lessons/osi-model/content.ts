import type { LayerN } from './model';

/* ------------------------------------------------------------------ */
/* Sorting game: where does each thing live?                           */
/* ------------------------------------------------------------------ */

export interface SortItem {
  id: string;
  label: string;
  accept: LayerN[];
  /** The layer the tag is filed under on the stage */
  home: LayerN;
  why: string;
}

export const SORT_ITEMS: SortItem[] = [
  { id: 'router', label: 'Router', accept: [3], home: 3, why: 'A router reads IP addresses to pick the next hop: layer 3.' },
  { id: 'http', label: 'HTTP', accept: [7], home: 7, why: 'HTTP is what the browser and the web server say to each other: layer 7.' },
  { id: 'switch', label: 'Switch', accept: [2], home: 2, why: 'A switch forwards frames by MAC address and never opens the packet: layer 2.' },
  { id: 'port', label: 'Port 443', accept: [4], home: 4, why: 'Ports pick the program on a machine. They live in the TCP or UDP header: layer 4.' },
  { id: 'cable', label: 'Ethernet cable', accept: [1], home: 1, why: 'A cable only carries signals. Pins, voltages and connectors are layer 1.' },
  { id: 'ip', label: 'IP address', accept: [3], home: 3, why: 'IP addresses identify machines across networks: layer 3.' },
  { id: 'tcp', label: 'TCP', accept: [4], home: 4, why: 'TCP adds ports, sequence numbers and retransmission: layer 4.' },
  { id: 'mac', label: 'MAC address', accept: [2], home: 2, why: 'MAC addresses only matter on the local link. They sit in the frame header: layer 2.' },
  { id: 'dns', label: 'DNS', accept: [7], home: 7, why: 'DNS is an application protocol (usually over UDP port 53): layer 7.' },
  { id: 'tls', label: 'TLS', accept: [6, 5], home: 6, why: 'TLS encrypts data for the application. It is usually filed under layer 6 (some say 5). It doesn’t fit neatly.' },
  { id: 'udp', label: 'UDP', accept: [4], home: 4, why: 'UDP is the no-frills transport: ports, length, checksum. Layer 4.' },
  { id: 'hub', label: 'Hub', accept: [1], home: 1, why: 'A hub just repeats the electrical signal out of every port. It understands nothing: layer 1.' },
];

/* ------------------------------------------------------------------ */
/* Debugging: symptoms and where they come from                        */
/* ------------------------------------------------------------------ */

export type BreakKind = 'cable' | 'wifi' | 'route' | 'port' | 'tls' | 'dns' | 'app500';

export interface Symptom {
  id: BreakKind;
  cmd: string;
  out: string[];
  layer: LayerN;
  accept: LayerN[];
  why: string;
}

export const SYMPTOMS: Symptom[] = [
  {
    id: 'cable',
    cmd: 'ip link show eth0',
    out: ['2: eth0: <NO-CARRIER,BROADCAST,MULTICAST,UP>', '    mtu 1500 state DOWN'],
    layer: 1,
    accept: [1],
    why: 'NO-CARRIER means no signal on the wire at all. A cable is unplugged or broken: layer 1.',
  },
  {
    id: 'dns',
    cmd: 'curl http://shop.example/',
    out: ['curl: (6) Could not resolve host: shop.example'],
    layer: 7,
    accept: [7],
    why: 'curl never got an IP address for the name, so nothing was even sent. DNS is layer 7.',
  },
  {
    id: 'port',
    cmd: 'curl http://shop.example/',
    out: ['curl: (7) Failed to connect to shop.example', '    port 80 after 14 ms: Connection refused'],
    layer: 4,
    accept: [4],
    why: 'The server’s TCP answered with a reset: the machine is reachable, but nothing listens on port 80. Layer 4.',
  },
  {
    id: 'route',
    cmd: 'ping -c 1 203.0.113.10',
    out: ['From 198.51.100.1 icmp_seq=1', '    Destination Net Unreachable'],
    layer: 3,
    accept: [3],
    why: 'The router (198.51.100.1) has no route to that network, so it sent an ICMP error back. Routing is layer 3.',
  },
  {
    id: 'wifi',
    cmd: 'iw dev wlan0 link',
    out: ['Not connected.'],
    layer: 2,
    accept: [2],
    why: 'The radio works, but the laptop isn’t associated with an access point, so there is no link to send frames on. Layer 2.',
  },
  {
    id: 'tls',
    cmd: 'curl https://shop.example/',
    out: ['curl: (60) SSL certificate problem:', '    certificate has expired'],
    layer: 6,
    accept: [6, 5],
    why: 'Packets flowed fine, but TLS refused the server’s certificate. TLS is usually filed under layer 6.',
  },
  {
    id: 'app500',
    cmd: 'curl -i http://shop.example/',
    out: ['HTTP/1.1 500 Internal Server Error'],
    layer: 7,
    accept: [7],
    why: 'A 500 means layers 1 to 6 all worked: the request arrived and the app itself failed. Layer 7.',
  },
];

/* ------------------------------------------------------------------ */
/* traceroute                                                          */
/* ------------------------------------------------------------------ */

export interface TraceHop {
  id: string;
  ip: string;
  name: string;
  ms: [number, number, number];
}

export const TRACE_HOPS: TraceHop[] = [
  { id: 'c.r1', ip: '198.51.100.1', name: 'Alice’s router', ms: [0.412, 0.388, 0.371] },
  { id: 'c.r2', ip: '192.0.2.1', name: 'ISP edge', ms: [8.123, 8.09, 8.211] },
  { id: 'c.r3', ip: '192.0.2.33', name: 'ISP core', ms: [11.706, 11.698, 11.652] },
  { id: 'c.r4', ip: '192.0.2.66', name: 'data center', ms: [14.31, 14.288, 14.301] },
  { id: 'c.srv', ip: '203.0.113.10', name: 'shop.example', ms: [14.452, 14.447, 14.439] },
];
