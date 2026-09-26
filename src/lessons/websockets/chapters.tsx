import type { ReactNode } from 'react';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import { FRAMES, FRAME_ORDER, type FrameKind } from './frames';
import { EMPTY, PIPE } from './sim';
import type { Chapter } from './types';

export const META = { slug: 'websockets', code: 'NET-08', track: 'Networking', title: 'WebSockets' };

const LG: Record<string, LegendItem> = {
  req: { label: 'HTTP request', color: SIG.req },
  res: { label: 'HTTP response', color: SIG.res },
  msgs: { label: 'response with messages', color: SIG.res },
  empty: { label: 'empty response', color: EMPTY },
  frame: { label: 'WebSocket frame', color: SIG.req, shape: 'square' },
  event: { label: 'event on the stream', color: SIG.res, shape: 'square' },
  ping: { label: 'ping / pong', color: SIG.hc, shape: 'small' },
  pipe: { label: 'open WebSocket', color: PIPE, shape: 'line' },
  stream: { label: 'open event stream', color: PIPE, shape: 'line' },
  pub: { label: 'Redis pub/sub', color: SIG.hc },
  close: { label: 'close frame', color: SIG.hc, shape: 'small' },
  lost: { label: 'lost in transit', color: SIG.err },
  send: { label: 'Alice sends', color: SIG.warn, shape: 'line' },
  atServer: { label: 'reaches the server', color: SIG.pink, shape: 'square' },
  app: { label: 'an app picking a transport', color: SIG.warn },
};

const FRAME_NOTES: Record<FrameKind, ReactNode> = {
  'hello-c': (
    <>
      The RFC&apos;s own example. The browser masks every byte: <code>0x48</code> (&ldquo;H&rdquo;) XOR <code>0x37</code> = <code>0x7f</code>. Six
      bytes of header carry five bytes of text.
    </>
  ),
  'hello-s': <>The same message from the server: no mask, no key, just two bytes of header.</>,
  json: (
    <>
      126 in the length field means &ldquo;the real length is in the next 2 bytes&rdquo;: <code>0x012c</code> = 300.
    </>
  ),
  binary: (
    <>
      Opcode 2 is binary. 127 means an 8-byte length follows: <code>0x0186a0</code> = 100,000 bytes. The payload starts with the PNG signature.
    </>
  ),
  ping: <>A control frame: opcode 9 and no payload. The browser answers it with a pong (opcode 10) on its own.</>,
  close: (
    <>
      Opcode 8 starts the closing handshake. The first two payload bytes are a status code: <code>0x03e8</code> = 1000, a normal closure.
    </>
  ),
};

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'http-only-answers',
    title: 'HTTP only answers',
    cfg: { view: 'chat', layout: 'relay', mode: 'http', people: ['alice', 'bob'], receivers: ['bob'], prefill: true },
    steps: [
      {
        id: 'alice-sends-a-message',
        title: 'Alice sends, Bob waits',
        cfg: { inspect: ['post'] },
        script: [
          { at: 0.9, run: (s) => s.chat('alice', 'Lunch at noon?') },
          { at: 8, run: (s) => s.chat('alice', 'Usual place') },
        ],
        body: (
          <>
            <p>
              <Term k="alice">Alice</Term> and <Term k="bob">Bob</Term> are chatting in a web app. Alice types a message and hits send. Her browser
              does what browsers do: it makes an <strong>HTTP request</strong>, <code>POST /messages</code>. The <Term k="srv1">server</Term> stores
              the message and answers <code>201 Created</code>.
            </p>
            <p>
              Now look at <Term k="bob">Bob&apos;s window</Term>. Nothing new. The message is sitting on the server, and the server has no way to hand
              it over.
            </p>
            <p>
              That&apos;s the deal HTTP makes: the <strong>client always speaks first</strong>. A browser sends a request, the server sends back exactly
              one response, and that exchange is over. A server can&apos;t start a new one on its own.
            </p>
          </>
        ),
        hud: ['waiting', 'oldest'],
        readouts: ['mailbox'],
        strip: 'mailbox',
        legend: [LG.req, LG.res],
        callouts: [{ target: 'bob', text: <>no request open, <b>nothing arrives</b></>, dir: 'down', landOnly: true }],
        code: {
          title: 'chat.js · Alice’s browser',
          lang: 'js',
          code: `
!await fetch('/messages', {
!  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ room: 42, text: 'Lunch at noon?' }),
});
// 201 Created. Bob's browser hears nothing.`,
        },
      },
      {
        id: 'when-does-bob-see-it',
        title: 'When does Bob see it?',
        cfg: { inspect: ['get'] },
        script: [{ at: 0.8, run: (s) => s.chat('alice', 'Lunch at noon?') }],
        predict: { kind: 'bobsees', needed: 1, prompt: 'When will Bob see Alice’s message?' },
        body: (
          <>
            <p>
              Same moment, replayed. Alice&apos;s message is stored on the <Term k="srv1">server</Term>. Bob&apos;s browser loaded the chat page a
              while ago, and that request finished long ago. Right now there is no request from Bob anywhere.
            </p>
            <p>
              <strong>Predict</strong> what happens next. The animation waits for your answer.
            </p>
          </>
        ),
        actions: {
          afterPredict: true,
          prompt: 'Now drive Bob’s browser yourself:',
          buttons: [
            {
              label: 'Check for messages',
              icon: 'replay',
              run: (s) => s.bobAsk(),
              after: (
                <>
                  <code>GET /messages?after=…</code> returns everything newer than the last message Bob saw, or an empty list. A refresh button,
                  basically. Nobody wants to chat like that.
                </>
              ),
            },
            { label: 'Alice sends another', icon: 'arrowRight', run: (s) => s.chat('alice') },
          ],
        },
        hud: ['waiting', 'oldest', 'reqs'],
        readouts: ['mailbox'],
        strip: 'mailbox',
        legend: [LG.req, LG.msgs, LG.empty],
        code: {
          title: 'the only way to get news',
          lang: 'http',
          code: `
!GET /messages?room=42&after=17 HTTP/1.1
Host: chat.example

HTTP/1.1 200 OK
Content-Type: application/json

![{"id":18,"from":"alice","text":"Lunch at noon?"}]`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'faking-push',
    title: 'Faking push over HTTP',
    cfg: { view: 'chat', layout: 'relay', people: ['alice', 'bob'], receivers: ['bob'], prefill: true },
    steps: [
      {
        id: 'short-polling',
        title: 'Short polling: ask, ask again',
        cfg: { mode: 'short', interval: 3, inspect: ['poll'], auto: { from: ['alice'], min: 3.5, max: 7.5, first: 1.8 } },
        interval: true,
        body: (
          <>
            <p>
              The oldest trick: Bob&apos;s browser just keeps asking. Every few seconds it sends <code>GET /messages?after=…</code> and the server
              answers right away with whatever is new. Usually that&apos;s nothing.
            </p>
            <p>
              This is <strong>short polling</strong>. It works everywhere, but you have to pick an interval, and both choices hurt. Poll rarely and a
              message can sit on the server for a whole interval. Poll often and most answers come back empty: every gray dot is a full HTTP request,
              headers and cookies included, that your server handled for nothing.
            </p>
            <p>
              <strong>Drag the slider</strong> and watch the two numbers trade places.
            </p>
            <Aside>
              Network trips are slowed down so you can follow them. On a real network each trip takes tens of milliseconds, so the delay in polling
              comes almost entirely from the interval.
            </Aside>
          </>
        ),
        hud: ['reqs', 'empty', 'avg', 'worst'],
        readouts: ['mailbox'],
        legend: [LG.req, LG.msgs, LG.empty],
        code: {
          title: 'poll.js',
          lang: 'js',
          code: `
let after = 17;   // id of the newest message we have
!setInterval(async () => {
!  const res = await fetch(\`/messages?room=42&after=\${after}\`);
  for (const m of await res.json()) {     // usually []
    render(m);
    after = m.id;
  }
!}, 3000);`,
        },
      },
      {
        id: 'long-polling',
        title: 'Long polling: hold the line',
        cfg: { mode: 'long', inspect: ['lp'], auto: { from: ['alice'], min: 4, max: 8, first: 3 } },
        body: (
          <>
            <p>
              <strong>Long polling</strong> flips the timing. Bob&apos;s browser sends the same kind of request, but the server doesn&apos;t answer
              until it has something to say. It <strong>holds the request open</strong>, the dashed line, for as long as it takes.
            </p>
            <p>
              The moment Alice&apos;s message lands, the server answers the waiting request, and Bob&apos;s browser immediately sends the next one.
              Delivery takes about one trip instead of up to a whole interval, and almost nothing comes back empty.
            </p>
            <p>
              It&apos;s still HTTP, though. Every message costs a full request and response with all their headers, the server keeps a parked request
              for every waiting user, and messages that land between one answer and the next request must be buffered, which is what the{' '}
              <code>after</code> cursor is for.
            </p>
            <Aside>
              Servers answer an empty <code>204</code> after 20 to 30 seconds even with no news, because proxies and load balancers give up on
              requests that hang for too long.
            </Aside>
          </>
        ),
        hud: ['reqs', 'empty', 'avg', 'worst'],
        readouts: ['mailbox'],
        legend: [LG.req, LG.msgs, LG.empty],
        code: {
          title: 'long-poll.js',
          lang: 'js',
          code: `
let after = 17;
while (true) {
!  const res = await fetch(\`/poll?room=42&after=\${after}\`);   // hangs until news
  if (res.status === 204) continue;          // timed out empty: ask again
  for (const m of await res.json()) {
    render(m);
    after = m.id;
  }
!}                                           // …and immediately ask again`,
        },
      },
      {
        id: 'server-sent-events',
        title: 'Server-Sent Events: a one-way stream',
        cfg: { mode: 'sse', open: 'connect', receivers: ['alice', 'bob'], inspect: ['sse', 'sse200', 'event'], auto: { from: ['alice', 'bob'], min: 3.2, max: 6, first: 4.6 } },
        body: (
          <>
            <p>
              Browsers have a built-in way to receive a stream: <strong>Server-Sent Events</strong> (SSE). The page calls{' '}
              <code>new EventSource(&apos;/events&apos;)</code>, which sends an ordinary GET. The server answers <code>200 OK</code> with{' '}
              <code>Content-Type: text/event-stream</code>, and then simply <strong>never finishes the response</strong>.
            </p>
            <p>
              Whenever there&apos;s news, the server writes another event into that open response: a few lines of text ending in a blank line. No
              polling at all, and messages arrive about one trip after they reach the server. If the stream drops, the browser reconnects by itself and
              sends <code>Last-Event-ID</code> so the server can fill the gap.
            </p>
            <p>
              The catch is in the name: it&apos;s <strong>one-way</strong>. When Bob replies, his browser still makes a separate <code>POST</code>{' '}
              for every message.
            </p>
            <Aside>
              Over HTTP/1.1, browsers allow only about six connections per server, and every open stream holds one, across all tabs. HTTP/2 carries
              many streams on one connection, which removes that limit.
            </Aside>
          </>
        ),
        hud: ['reqs', 'avg'],
        readouts: ['stream'],
        legend: [LG.req, LG.event, LG.stream],
        callouts: [{ target: 'pipe:bob', text: <>a response that <b>never ends</b></>, dir: 'up', landOnly: true }],
        code: {
          title: 'events.js',
          lang: 'js',
          code: `
!const events = new EventSource('/events?room=42');
!events.onmessage = (e) => render(JSON.parse(e.data));

// replies still go the old way
fetch('/messages', { method: 'POST', body: JSON.stringify(msg) });`,
        },
        code2: {
          title: 'what the server writes',
          lang: 'http',
          code: `
HTTP/1.1 200 OK
!Content-Type: text/event-stream
Cache-Control: no-cache

!id: 18
!data: {"from":"alice","text":"Lunch at noon?"}

id: 19
data: {"from":"bob","text":"Sounds good"}
`,
        },
      },
      {
        id: 'race',
        title: 'Race them side by side',
        cfg: { view: 'race', interval: 3 },
        race: true,
        body: (
          <>
            <p>
              Here are the three approaches on one clock, receiving the same messages from Alice. Each lane is a sequence diagram turned on its side:
              Bob&apos;s browser on the bottom line, the server on the top, time flowing to the right.
            </p>
            <p>
              <Term k="lane:short">Short polling</Term> zigzags constantly, mostly for nothing. <Term k="lane:long">Long polling</Term> asks once and
              waits, answering only when there&apos;s news. The <Term k="lane:ws">WebSocket</Term> lane never asks at all: the connection is already
              open, and each message crosses it the moment it reaches the server.
            </p>
            <p>
              <strong>Send a few messages yourself</strong> and compare the delays under each lane. Then drag the polling interval.
            </p>
            <Aside>Server-Sent Events would draw the same line as the WebSocket lane here: pushes from the server travel over one open response.</Aside>
          </>
        ),
        legend: [
          { label: 'request', color: SIG.req },
          { label: 'data', color: SIG.res },
          { label: 'empty', color: EMPTY },
          LG.send,
          { label: 'at the server', color: SIG.pink, shape: 'square' },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'handshake',
    title: 'The upgrade handshake',
    cfg: { view: 'chat', layout: 'relay', mode: 'ws', people: ['alice', 'bob'], open: 'all', closed: ['bob'], slowHandshake: true, prefill: true },
    steps: [
      {
        id: 'ask-to-upgrade',
        title: 'Ask to switch protocols',
        cfg: { inspect: ['upgrade', '101'] },
        script: [{ at: 0.6, run: (s) => s.connect('bob') }],
        predict: { kind: 'status', needed: 1, prompt: 'Which status code does the server send back?' },
        focus: ['bob', 'srv1'],
        body: (
          <>
            <p>
              A WebSocket starts life as an ordinary HTTP request. When Bob&apos;s page runs{' '}
              <code>new WebSocket(&apos;wss://chat.example/ws&apos;)</code>, the browser opens a TCP connection (plus TLS, because of the{' '}
              <code>wss://</code>) and sends a <code>GET</code> with a few extra headers.
            </p>
            <p>
              <code>Upgrade: websocket</code> and <code>Connection: Upgrade</code> ask the server to switch this connection to a different protocol.{' '}
              <code>Sec-WebSocket-Key</code> is 16 random bytes, base64-encoded, and <code>Sec-WebSocket-Version: 13</code> names the version from RFC
              6455, the WebSocket standard.
            </p>
            <p>
              Because it starts as plain HTTP, it goes through the same port (443), proxies and cookies as the rest of the site. <strong>Predict the
              reply.</strong>
            </p>
          </>
        ),
        legend: [LG.req, LG.res, LG.pipe],
        code: {
          title: 'chat.js · Bob’s browser',
          lang: 'js',
          code: `
!const ws = new WebSocket('wss://chat.example/ws');
ws.onopen = () => console.log('connected');   // runs after the handshake`,
        },
        code2: {
          title: 'what the browser sends',
          lang: 'http',
          code: `
GET /ws HTTP/1.1
Host: chat.example
!Upgrade: websocket
!Connection: Upgrade
!Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
!Sec-WebSocket-Version: 13
Origin: https://chat.example`,
        },
      },
      {
        id: 'switching-protocols',
        title: '101 Switching Protocols',
        cfg: { inspect: ['101'], showAccept: true },
        script: [
          { at: 0.4, run: (s) => s.connect('bob') },
          { at: 7.6, run: (s) => s.chat('bob', 'Hi! Finally online') },
          { at: 9.6, run: (s) => s.chat('alice', 'Welcome back') },
        ],
        focus: ['bob', 'srv1', 'pipe:bob'],
        body: (
          <>
            <p>
              The server agrees with <strong>101 Switching Protocols</strong>. It&apos;s the one status code that says: this HTTP exchange is over,
              and from the next byte on, the connection belongs to another protocol.
            </p>
            <p>
              <code>Sec-WebSocket-Accept</code> proves the server really understood. It glues a fixed GUID from the RFC onto Bob&apos;s key, hashes the
              result with SHA-1 and base64-encodes it. The browser does the same math and refuses the connection if the answers differ, so a server or
              cache that merely replays an old HTTP response can&apos;t fake a handshake.
            </p>
            <p>
              Then the part that matters: <strong>the connection stays open</strong>. No more requests and responses. The same TCP connection now
              carries WebSocket messages, in both directions, for as long as both sides want.
            </p>
            <Aside>
              The accept hash isn&apos;t security: anyone can compute it. Authenticate the upgrade request like any other (the browser sends its
              cookies with it) and check the <code>Origin</code> header, because the same-origin policy doesn&apos;t stop other sites from opening
              WebSockets to your server.
            </Aside>
          </>
        ),
        readouts: ['accept'],
        strip: 'accept',
        legend: [LG.req, LG.res, LG.frame, LG.pipe],
        code: {
          title: 'server.js',
          lang: 'js',
          code: `
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';   // fixed by RFC 6455
!const accept = createHash('sha1')
!  .update(req.headers['sec-websocket-key'] + GUID)
!  .digest('base64');          // 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='`,
        },
        code2: {
          title: 'what the server answers',
          lang: 'http',
          code: `
!HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
!Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`,
        },
      },
      {
        id: 'one-connection',
        title: 'One connection, start to finish',
        cfg: { view: 'seq' },
        body: (
          <>
            <p>
              Here&apos;s the whole life of Bob&apos;s connection as a sequence diagram, time running down. First the usual setup: a TCP handshake,
              then TLS because the URL says <code>wss://</code>. Then exactly one HTTP exchange, the upgrade request and the 101.
            </p>
            <p>
              After that there are no requests and no responses, only <strong>frames</strong>. Either side sends whenever it wants, and two frames
              can even cross in flight (watch <code>typing…</code> and <code>new message</code>). That&apos;s what <strong>full duplex</strong> means.
            </p>
            <p>
              The setup costs about three round trips, once. The browser&apos;s <code>readyState</code> goes from <code>CONNECTING</code> to{' '}
              <code>OPEN</code> when the 101 checks out, and every message after that rides the open connection until someone sends a close frame.
            </p>
          </>
        ),
        code: {
          title: 'chat.js',
          lang: 'js',
          code: `
const ws = new WebSocket('wss://chat.example/ws');

!ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room: 42 }));
!ws.onmessage = (e) => render(JSON.parse(e.data));
ws.onclose = (e) => console.log('closed with code', e.code);

!sendButton.onclick = () => ws.send(JSON.stringify({ type: 'say', text: input.value }));`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'frames',
    title: 'Frames, both ways',
    cfg: { view: 'chat', layout: 'relay', mode: 'ws', people: ['alice', 'bob'], open: 'all', prefill: true },
    steps: [
      {
        id: 'full-duplex',
        title: 'Talk at the same time',
        cfg: { inspect: ['frame'], auto: { from: ['alice', 'bob'], min: 4, max: 7, first: 2.4 } },
        body: (
          <>
            <p>
              Now <Term k="alice">Alice</Term> and <Term k="bob">Bob</Term> both hold an open WebSocket to the <Term k="srv1">server</Term>. When
              Alice&apos;s message arrives as a frame, the server writes it straight into Bob&apos;s connection. No polling, no parked request:
              one trip in, one trip out.
            </p>
            <p>
              And it goes both ways at once. Try <strong>Both at once</strong>: the two frames pass each other inside the pipes, and neither side
              waits its turn. That&apos;s <strong>full duplex</strong>.
            </p>
            <p>
              Each frame adds just a few bytes of framing, where an HTTP request carries hundreds of bytes of headers. That&apos;s why apps happily send
              tiny messages like &ldquo;Bob is typing…&rdquo; or a cursor position 30 times a second over a WebSocket.
            </p>
          </>
        ),
        actions: {
          prompt: 'Send some messages yourself:',
          buttons: [
            { label: 'Send as Alice', icon: 'arrowRight', run: (s) => s.chat('alice') },
            { label: 'Send as Bob', icon: 'arrowLeft', run: (s) => s.chat('bob') },
            {
              label: 'Both at once',
              icon: 'bolt',
              run: (s) => {
                s.chat('alice');
                s.chat('bob');
              },
              after: <>Two frames, opposite directions, same moment. With HTTP one of them would have to wait for a request to answer.</>,
            },
          ],
        },
        hud: ['delivered', 'avg', 'reqs'],
        legend: [LG.frame, LG.pipe],
        callouts: [{ target: 'pipe:alice', text: <><b>both directions</b> at once</>, dir: 'down', landOnly: true }],
        code: {
          title: 'server.js · the ws library',
          lang: 'js',
          code: `
import { WebSocketServer, WebSocket } from 'ws';
const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
!  ws.on('message', (data, isBinary) => {
!    for (const client of wss.clients) {           // relay to everyone
!      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
!    }
  });
});`,
        },
      },
      {
        id: 'frame-anatomy',
        title: 'Inside a frame',
        cfg: { view: 'frame', frame: 'hello-c' },
        toggle: {
          prompt: 'Pick a frame to take apart:',
          initial: 0,
          options: FRAME_ORDER.map((k) => ({ label: FRAMES[k].label, apply: (s) => s.setFrame(k), note: FRAME_NOTES[k] })),
        },
        body: (
          <>
            <p>
              Every WebSocket message travels as one or more <strong>frames</strong>, and the header is tiny: 2 bytes for a short message, 14 at the
              very most. Pick a frame and read it bit by bit.
            </p>
            <p>
              <Term k="field:fin">FIN</Term> marks the last frame of a message (big messages can be split into fragments). The{' '}
              <Term k="field:opcode">opcode</Term> says what the frame is: 1 text, 2 binary, 8 close, 9 ping, 10 pong. The{' '}
              <Term k="field:len">payload length</Term> takes 7 bits: up to 125 fits right there, 126 means &ldquo;read the next 2 bytes&rdquo;,
              127 means &ldquo;read the next 8&rdquo;.
            </p>
            <p>
              Frames from the browser are always <Term k="field:mask">masked</Term>: XORed with 4 random bytes that travel in the header. It&apos;s not
              encryption, since the key is right there. It stops a malicious page from crafting bytes that a confused proxy in the middle might
              mistake for an HTTP request and cache. Frames from the server are never masked.
            </p>
          </>
        ),
        legend: [LG.frame, LG.ping, LG.pipe],
        callouts: [{ target: 'field:opcode', text: <>opcode: <b>what kind of frame</b></>, dir: 'up', landOnly: true }],
        code: {
          title: 'RFC 6455 §5.7, byte by byte',
          lang: 'c',
          code: `
// "Hello" from the browser, masked
!0x81 0x85                  // FIN=1, opcode=1 (text) | MASK=1, len=5
!0x37 0xfa 0x21 0x3d        // masking key
0x7f 0x9f 0x4d 0x51 0x58    // 'H' ^ 0x37 = 0x7f, 'e' ^ 0xfa = 0x9f, ...

// "Hello" from the server
0x81 0x05 0x48 0x65 0x6c 0x6c 0x6f`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'keep-alive',
    title: 'Keeping it alive',
    cfg: {
      view: 'chat',
      layout: 'infra',
      mode: 'ws',
      people: ['alice', 'bob'],
      open: 'all',
      lb: true,
      lbName: 'proxy',
      heartbeat: true,
      pingEvery: 3,
      prefill: true,
    },
    steps: [
      {
        id: 'heartbeats',
        title: 'Ping, pong',
        cfg: { idle: 8 },
        toggle: {
          prompt: 'Heartbeat:',
          initial: 0,
          options: [
            {
              label: 'On · ping every 3 s',
              apply: (s) => s.setHeartbeat(true),
              note: <>Every ping and pong is traffic, so the proxy&apos;s idle timers never get near the limit.</>,
            },
            {
              label: 'Off',
              apply: (s) => s.setHeartbeat(false),
              note: (
                <>
                  Nobody is typing, so nothing crosses the proxy. When a timer hits 8 seconds the proxy cuts the connection, the browser sees it
                  close (code <code>1006</code>), reconnects, and the clock starts again.
                </>
              ),
            },
          ],
        },
        body: (
          <>
            <p>
              An open connection can go quiet for minutes while nobody types. Quiet is a problem, because the boxes in between, like{' '}
              <Term k="lb">proxies</Term>, load balancers and NAT routers, keep a timer per connection and <strong>close connections that stay idle</strong>{' '}
              too long.
            </p>
            <p>
              The fix is a <strong>heartbeat</strong>. Every so often the <Term k="srv1">server</Term> sends a <strong>ping</strong> frame (opcode 9)
              and the browser answers with a <strong>pong</strong> (opcode 10), automatically. Each one counts as traffic, and a ping that never gets
              its pong tells the server the other side is gone.
            </p>
            <p>
              <strong>Turn the heartbeat off</strong> and watch the proxy&apos;s timers run out.
            </p>
            <Aside>
              Timers are shortened here. Real servers ping every 20 to 30 seconds, comfortably inside the 60-second defaults of nginx&apos;s{' '}
              <code>proxy_read_timeout</code> and AWS load balancers&apos; idle timeout.
            </Aside>
          </>
        ),
        hud: ['pings', 'closes'],
        readouts: ['idle'],
        strip: 'idle',
        legend: [LG.ping, LG.pipe],
        callouts: [{ target: 'lb', text: <>closes connections <b>idle for 8 s</b></>, dir: 'up', landOnly: true }],
        code: {
          title: 'server.js · heartbeat',
          lang: 'js',
          code: `
wss.on('connection', (ws) => {
  ws.isAlive = true;
!  ws.on('pong', () => { ws.isAlive = true; });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
!    if (!ws.isAlive) return ws.terminate();   // no pong since the last ping
    ws.isAlive = false;
!    ws.ping();
  });
}, 30_000);`,
        },
      },
      {
        id: 'silent-death',
        title: 'When a connection dies silently',
        cfg: { idle: 0, auto: { from: ['alice'], min: 2.6, max: 4.2, first: 1.6 } },
        actions: {
          prompt: 'Break it:',
          buttons: [
            {
              label: 'Cut Bob’s network',
              icon: 'power',
              run: (s) => s.cutNet('bob'),
              after: (
                <>
                  No close frame gets out, so both ends still think the connection is open, and Alice&apos;s messages vanish on the way. Watch the
                  heartbeat catch it from both sides, then the retries back off: 1, 2, 4 seconds…
                </>
              ),
            },
            {
              label: 'Restore it',
              icon: 'replay',
              run: (s) => s.restoreNet('bob'),
              after: (
                <>
                  The next retry gets through: a fresh handshake, then <code>resume after #…</code>, and the server replays everything Bob missed
                  (the ↻ bubbles).
                </>
              ),
            },
          ],
        },
        body: (
          <>
            <p>
              Connections don&apos;t always end politely. When Bob&apos;s train goes into a tunnel, or a router along the way reboots, no close frame
              gets through. The <Term k="srv1">server</Term> still thinks Bob is connected, <Term k="bob">Bob&apos;s browser</Term> still thinks its
              connection is open, and frames sent into it simply vanish.
            </p>
            <p>
              Heartbeats catch this from both ends. The server sees a ping go unanswered and terminates the connection. Bob&apos;s side notices it
              hasn&apos;t heard a heartbeat in too long and gives up on it too.
            </p>
            <p>
              Then the client <strong>reconnects with exponential backoff</strong>: wait about 1 s, then 2, 4, 8, up to a cap, with random{' '}
              <strong>jitter</strong> so that thousands of clients don&apos;t all reconnect in the same instant. Once back in, it tells the server the
              last message it saw, and the server <strong>resends everything it missed</strong>.
            </p>
            <Aside>
              Browsers answer protocol pings automatically but hide them from JavaScript, so page code can&apos;t use them to watch its own
              connection. Libraries like Socket.IO send heartbeats as ordinary messages instead, and that&apos;s the kind Bob&apos;s side watches
              here.
            </Aside>
          </>
        ),
        hud: ['bob', 'missed', 'resynced'],
        readouts: ['client'],
        strip: 'client',
        legend: [LG.frame, LG.ping, LG.lost, LG.pipe],
        code: {
          title: 'chat.js · reconnect and resync',
          lang: 'js',
          code: `
let attempt = 0, lastId = 0;

function connect() {
!  const ws = new WebSocket(\`wss://chat.example/ws?after=\${lastId}\`);
  let watchdog;
  const heard = () => {                  // the server sends a heartbeat every 25 s
    clearTimeout(watchdog);
    watchdog = setTimeout(() => { ws.onclose = null; ws.close(); retry(); }, 35_000);
  };
  ws.onopen = () => { attempt = 0; heard(); };
  ws.onmessage = (e) => { heard(); const m = JSON.parse(e.data); lastId = m.id; render(m); };
  ws.onclose = () => { clearTimeout(watchdog); retry(); };
}

function retry() {
!  const delay = Math.min(30_000, 1000 * 2 ** attempt++);
!  setTimeout(connect, delay * (0.5 + Math.random() / 2));   // backoff + jitter
}`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'scaling',
    title: 'Scaling out',
    cfg: { view: 'chat', layout: 'infra', mode: 'ws', people: ['alice', 'carol', 'bob', 'dave'], servers: 2, open: 'all' },
    steps: [
      {
        id: 'one-server-per-socket',
        title: 'Every socket lives on one server',
        cfg: { lb: true, lbName: 'load balancer', open: 'connect' },
        actions: {
          prompt: 'Ship a new version of ws-1:',
          buttons: [
            {
              label: 'Restart ws-1',
              icon: 'power',
              run: (s) => s.restartServer('srv1'),
              after: (
                <>
                  ws-1 closes its sockets with code <code>1001</code> (going away). Its users reconnect through the load balancer, which sends them to
                  ws-2, the only server up. When ws-1 returns it sits empty: long-lived connections <strong>don&apos;t rebalance by themselves</strong>.
                </>
              ),
            },
          ],
        },
        body: (
          <>
            <p>
              One server can hold a lot of WebSockets, but not unlimited. Every open connection is a <strong>socket</strong>: a file descriptor on the
              server plus memory for buffers and your app&apos;s state, whether the user is chatting or idle. Big deployments raise the file-descriptor
              limit and still spread users over many servers.
            </p>
            <p>
              So you put a <Term k="lb">load balancer</Term> in front, as with any web app. The difference: it makes a choice <strong>once</strong>,
              when the upgrade request arrives. After that the connection is pinned to that server for minutes or hours, so the load balancer must
              pass the <code>Upgrade</code> headers through and allow long idle times.
            </p>
            <p>
              <strong>Try a deploy</strong>: restart <Term k="srv1">ws-1</Term> and watch where its users go.
            </p>
          </>
        ),
        hud: ['conns'],
        readouts: ['conns'],
        strip: 'conns',
        legend: [LG.req, LG.res, LG.close, LG.pipe],
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
upstream chat_backend {
    least_conn;
    server 10.0.1.11:8080;   # ws-1
    server 10.0.1.12:8080;   # ws-2
}

location /ws {
    proxy_pass http://chat_backend;
!    proxy_http_version 1.1;
!    proxy_set_header Upgrade $http_upgrade;
!    proxy_set_header Connection "upgrade";
!    proxy_read_timeout 3600s;
}`,
          note: 'Without the Upgrade and Connection headers, nginx drops them (they are hop-by-hop) and the handshake fails.',
        },
        code2: {
          title: 'shell · on each chat server',
          lang: 'shell',
          code: `
$ ulimit -n              # open files (sockets) allowed per process
1024
!$ ulimit -n 1048576      # raise it, or set LimitNOFILE in the systemd unit`,
        },
      },
      {
        id: 'different-servers',
        title: 'Alice and Bob on different servers',
        cfg: { lb: false, auto: { from: ['alice', 'dave', 'carol', 'bob'], min: 3.2, max: 4.6, first: 1.5 } },
        predict: { kind: 'split', needed: 3, prompt: 'Who receives the message?' },
        body: (
          <>
            <p>
              The load balancer spread four friends over two servers: <Term k="alice">Alice</Term> and <Term k="carol">Carol</Term> on{' '}
              <Term k="srv1">ws-1</Term>, <Term k="bob">Bob</Term> and <Term k="dave">Dave</Term> on <Term k="srv2">ws-2</Term>. They&apos;re all in
              the same chat room. (The load balancer is still there; it&apos;s hidden to keep the picture simple.)
            </p>
            <p>
              The chat code hasn&apos;t changed. When a message arrives, the server looks up the room&apos;s sockets <strong>in its own memory</strong>{' '}
              and writes the message to each of them. The readout shows what each server knows.
            </p>
            <p>
              <strong>Predict</strong> who gets each message.
            </p>
          </>
        ),
        hud: ['delivered'],
        readouts: ['conns'],
        strip: 'conns',
        legend: [LG.frame, LG.pipe],
        code: {
          title: 'server.js',
          lang: 'js',
          code: `
const rooms = new Map();   // room id → Set of sockets, in THIS process only

function broadcast(room, msg) {
!  for (const ws of rooms.get(room) ?? []) ws.send(msg);   // local sockets only
}`,
        },
      },
      {
        id: 'redis-backplane',
        title: 'A backplane: Redis pub/sub',
        cfg: { lb: false, redis: true, backplane: true, auto: { from: ['alice', 'dave', 'carol', 'bob'], min: 3.2, max: 4.6, first: 1.2 } },
        toggle: {
          prompt: 'Redis pub/sub between the servers:',
          initial: 0,
          options: [
            { label: 'On', apply: (s) => s.setBackplane(true), note: <>Every message goes out through Redis and comes back to every server.</> },
            {
              label: 'Off',
              apply: (s) => s.setBackplane(false),
              note: <>Back to islands: each message only reaches people on the sender&apos;s server. Watch the Delivered counter fall behind.</>,
            },
          ],
        },
        body: (
          <>
            <p>
              The fix is to let the servers talk. Each one <strong>subscribes</strong> to a channel per room in <Term k="redis">Redis</Term>. When a
              message arrives, a server doesn&apos;t deliver it directly. It <strong>publishes</strong> it to <code>room:42</code>, and Redis hands a
              copy to every subscribed server, including the one that sent it. Each server then writes it to its own local sockets.
            </p>
            <p>
              Now it doesn&apos;t matter which server anyone landed on. Redis acts as a <strong>backplane</strong>, and you can add chat servers freely:
              each new one just subscribes too.
            </p>
            <Aside>
              Redis Pub/Sub is fire-and-forget: a server that&apos;s briefly cut off from Redis misses those messages. Chat apps usually store messages
              in a database as well (that&apos;s what reconnecting clients resync from), or use a durable log such as Redis Streams, Kafka or NATS
              JetStream.
            </Aside>
          </>
        ),
        hud: ['delivered', 'published'],
        readouts: ['redis', 'conns'],
        strip: 'redis',
        legend: [LG.frame, LG.pub, LG.pipe],
        code: {
          title: 'redis-cli',
          lang: 'shell',
          code: `
# every chat server, at startup
!SUBSCRIBE room:42

# the server that receives Alice's message
!PUBLISH room:42 '{"from":"alice","text":"Lunch at noon?"}'
(integer) 2      # subscribers that got it: ws-1 and ws-2`,
        },
        code2: {
          title: 'server.js · node-redis',
          lang: 'js',
          code: `
const pub = createClient();
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);

!await sub.subscribe('room:42', (msg) => broadcast('room:42', msg));   // local sockets

ws.on('message', (data) => {
!  pub.publish('room:42', data.toString());    // not broadcast() directly
});`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'choosing',
    title: 'Choosing a transport',
    cfg: { view: 'choose' },
    steps: [
      {
        id: 'when-to-use-what',
        title: 'Which one should you use?',
        body: (
          <>
            <p>
              <Term k="leaf:ws">WebSockets</Term> are the right tool when <strong>both sides talk often and latency matters</strong>: chat, multiplayer
              games, collaborative editors, trading screens.
            </p>
            <p>
              If only the server talks, as with notifications, live scores, progress bars or an AI model streaming its answer,{' '}
              <Term k="leaf:sse">Server-Sent Events</Term> are simpler. They&apos;re plain HTTP, so they reuse your cookies, auth and HTTP/2
              connections, and reconnection is built in. (Just make sure proxies don&apos;t buffer the stream.)
            </p>
            <p>
              Everything else, which is most of an app, should stay <Term k="leaf:http">plain HTTP</Term>: stateless requests that any server can
              answer and any cache can store. Even polling is fine when updates are rare and a minute of delay doesn&apos;t matter.
            </p>
            <Aside>
              HTTP/2 and HTTP/3 don&apos;t replace WebSockets: they carry many requests over one connection, but every response still answers a
              request. (HTTP/2 server push only preloaded files into the browser cache, and browsers have dropped it.) WebSockets can also run over
              HTTP/2 (RFC 8441), and WebTransport over HTTP/3 is the newer option for games and media.
            </Aside>
          </>
        ),
        legend: [LG.app],
        quiz: {
          question: 'A news site shows live sports scores to millions of readers. Scores change every few seconds; readers never send anything back. Which fits best?',
          options: [
            { text: 'Short polling every second', why: 'Millions of readers each asking every second is millions of mostly empty requests per second, and scores still arrive late.' },
            {
              text: 'Server-Sent Events',
              correct: true,
              why: 'Only the server talks, so a one-way stream is enough. It stays plain HTTP, reconnects by itself, and works through standard proxies and CDNs.',
            },
            { text: 'WebSockets', why: 'It works, but you pay for two-way, stateful connections that readers never use. SSE is the simpler fit for one-way pushes.' },
            { text: 'Long polling', why: 'Better than short polling, but every score update costs a full request per reader. SSE streams them over one response.' },
          ],
        },
        code: {
          title: 'three tools',
          lang: 'js',
          code: `
// the server pushes, the browser only listens
!const scores = new EventSource('/scores');

// both sides talk, often and fast
!const match = new WebSocket('wss://play.example/match/7');

// everything else
!const order = await fetch('/orders', { method: 'POST', body });`,
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
          view: 'chat',
          layout: 'infra',
          mode: 'ws',
          people: ['alice', 'carol', 'bob', 'dave'],
          servers: 2,
          open: 'all',
          redis: true,
          backplane: true,
          heartbeat: true,
          pingEvery: 4,
          prefill: true,
          auto: { from: ['alice', 'bob', 'dave', 'carol'], min: 2.4, max: 3.8, first: 1 },
        },
        body: (
          <p>
            Everything in one picture: four people on two servers, heartbeats ticking, and every message fanned out through Redis to whichever server
            holds each recipient&apos;s socket.
          </p>
        ),
        cheat: true,
        hud: ['delivered', 'avg'],
        readouts: ['redis'],
        legend: [LG.frame, LG.pub, LG.ping, LG.pipe],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: {
          view: 'chat',
          layout: 'relay',
          mode: 'ws',
          people: ['alice', 'bob'],
          open: 'connect',
          heartbeat: true,
          pingEvery: 3,
          interval: 3,
          auto: { from: ['alice'], min: 6, max: 10, first: 4 },
        },
        body: (
          <p>
            All the knobs in one place. Switch transports and compare the delays, send messages as either person, cut Bob&apos;s network, and split the
            chat over two servers. Then try the challenges.
          </p>
        ),
        playground: true,
        hud: ['reqs', 'empty', 'avg', 'delivered'],
      },
    ],
  },
];
