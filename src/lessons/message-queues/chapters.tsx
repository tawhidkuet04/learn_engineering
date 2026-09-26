import { ActionsCard, SliderCard, Stat, ToggleCard } from '@/components/lesson/cards';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import type { LessonMeta } from '@/components/lesson/LessonStage';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import { CheatSheet } from './CheatSheet';
import { SUBS } from './model';
import css from './mq.module.css';
import { Playground } from './Playground';
import type { Chapter } from './types';

export const META: LessonMeta = { slug: 'message-queues', code: 'SD-08', track: 'System design', title: 'Message Queues' };

const LG: Record<string, LegendItem> = {
  req: { label: 'request', color: SIG.req },
  res: { label: 'response', color: SIG.res },
  err: { label: 'error', color: SIG.err },
  msg: { label: 'message', color: SIG.req, shape: 'square' },
  ack: { label: 'delete (the ack)', color: SIG.res },
  poll: { label: 'idle worker, long-polling', color: SIG.hc, shape: 'line' },
  crash: { label: 'crash', color: SIG.err },
  poison: { label: 'poison message', color: SIG.err, shape: 'square' },
  event: { label: 'event copy', color: SIG.req, shape: 'square' },
  commit: { label: 'offset commit', color: SIG.hc, shape: 'small' },
  alice: { label: 'Alice’s events', color: SIG.pink, shape: 'square' },
  bob: { label: 'Bob’s', color: SIG.teal, shape: 'square' },
  carol: { label: 'Carol’s', color: SIG.lime, shape: 'square' },
  dave: { label: 'Dave’s', color: SIG.blue, shape: 'square' },
};

/** A message chip inside the narration. */
const M = ({ children, color = SIG.req, ghost }: { children: string; color?: string; ghost?: boolean }) => (
  <span className={`${css.chip} ${ghost ? css.chipGhost : ''}`} style={{ color }}>
    {children}
  </span>
);

const CHARGES = {
  mode: 'queue' as const,
  users: false,
  job: 'charge' as const,
  queue: 'charges',
  producer: 'checkout-api',
  producerSub: 'POST /checkout',
};

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'waiting',
    title: 'The trouble with waiting',
    cfg: { mode: 'sync', users: true, readout: 'waterfall', rate: 0.34 },
    steps: [
      {
        id: 'signup-the-slow-way',
        title: 'Signup, the slow way',
        reset: true,
        body: (
          <>
            <p>
              Alice signs up for your app. The <Term k="api">signup handler</Term> saves her to the database, then does the polite follow-up work: it sends a{' '}
              <strong>welcome email</strong>, makes a <strong>thumbnail</strong> of her avatar, and records the signup in <strong>analytics</strong>.
            </p>
            <p>
              It does all of it <strong>synchronously</strong>. Each call waits for the one before it, and only then does the handler answer. Watch the
              timeline under it: Alice stares at a spinner for about 1.6 seconds, waiting on work she doesn’t care about.
            </p>
            <Aside>The animation is slowed down so you can follow each call. The milliseconds in the readouts are what a real user would wait.</Aside>
          </>
        ),
        hud: ['signup', 'ok'],
        legend: [LG.req, LG.res],
        callouts: [{ target: 'api', text: <>answers only after <b>all three calls</b></>, dir: 'up' }],
        pCallouts: [],
        code: {
          title: 'signup.js',
          lang: 'js',
          code: `
app.post('/signup', async (req, res) => {
  const user = await db.users.insert(req.body);
!  await email.sendWelcome(user);     // ~600 ms
!  await thumbs.resize(user.avatar);  // ~800 ms
!  await analytics.track(user);       // ~120 ms
  res.status(201).json(user); // only now!
});`,
        },
      },
      {
        id: 'one-sick-service',
        title: 'One sick service breaks signup',
        reset: true,
        body: (
          <>
            <p>Now the email provider has a bad day. Break it with the buttons below.</p>
            <p>
              If it’s <strong>down</strong>, the call fails straight away and so does the whole signup, with a 500, even though Alice’s account was already
              saved. If it’s <strong>slow</strong>, every signup hangs until the HTTP client gives up after 3 seconds, then fails anyway.
            </p>
            <p>
              Thumbnails and analytics are perfectly healthy. It doesn’t matter. A synchronous request is only as reliable as <em>everything</em> it waits
              for, and as slow as all of it added up.
            </p>
          </>
        ),
        panel: (sim) => (
          <ToggleCard
            kicker="Break it"
            prompt="The email service is…"
            options={[
              { label: 'Healthy', apply: () => sim.setEmail('ok') },
              {
                label: 'Slow',
                apply: () => sim.setEmail('slow'),
                note: (
                  <>
                    Each signup now hangs for the full <strong>3-second timeout</strong>, then fails. Nobody asked the email service to be fast, but signup
                    inherited its slowness.
                  </>
                ),
              },
              {
                label: 'Down',
                apply: () => sim.setEmail('down'),
                note: (
                  <>
                    <strong>Every signup fails.</strong> Worse, the user row was already inserted, so when Alice tries again she gets “email already
                    taken”.
                  </>
                ),
              },
            ]}
          />
        ),
        hud: ['signup', 'ok', 'failed'],
        legend: [LG.req, LG.res, LG.err],
        code: {
          title: 'signup.js',
          lang: 'js',
          code: `
const user = await db.users.insert(req.body);
try {
!  await email.sendWelcome(user); // down or slow
} catch (err) {
!  return res.status(500).end();  // signup fails
}
// …but Alice’s row is already in the table`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'queue',
    title: 'Put a queue in between',
    cfg: { mode: 'queue', users: true, readout: 'waterfall', rate: 0.45, workers: 2, work: 1.9, visibility: 8, job: 'signup', queue: 'signups' },
    steps: [
      {
        id: 'answer-now-work-later',
        title: 'Answer now, work later',
        reset: true,
        cfg: { mode: 'sync' },
        body: (
          <>
            <p>
              The follow-up work doesn’t have to happen <em>before</em> Alice gets her answer. It just has to happen.
            </p>
            <p>
              So the <Term k="api">handler</Term> saves Alice, drops a short note into a <Term k="q">queue</Term>, a <strong>message</strong> saying
              “Alice signed up”, and answers right away. Separate <Term k="workers">worker</Term> processes take messages off the queue and do the email,
              thumbnail and analytics calls in the background.
            </p>
            <p>The handler is now a <strong>producer</strong> and the workers are <strong>consumers</strong>. Flip the switch and watch the signup time.</p>
            <Aside>
              One gap: if the handler crashes between saving Alice and sending the message, the job is lost. The <strong>transactional outbox</strong>{' '}
              closes it: write the message to a table in the same database transaction as the user, then relay it to the queue.
            </Aside>
          </>
        ),
        panel: (sim) => (
          <ToggleCard
            prompt="How does signup handle the follow-up work?"
            options={[
              { label: 'Call each service', apply: () => sim.setMode('sync') },
              {
                label: 'Use a queue',
                apply: () => sim.setMode('queue'),
                note: (
                  <>
                    Signup now takes about <strong>30 ms</strong> instead of 1.6 s. The same work still happens, in the workers, after Alice already has
                    her answer.
                  </>
                ),
              },
            ]}
          />
        ),
        hud: ['signup', 'ok', 'depth'],
        legend: [LG.req, LG.res, LG.msg],
        code: {
          title: 'signup.js',
          lang: 'js',
          code: `
app.post('/signup', async (req, res) => {
  const user = await db.users.insert(req.body);
!  await sqs.send(new SendMessageCommand({
!    QueueUrl: SIGNUPS_URL,
!    MessageBody: JSON.stringify({
!      type: 'UserSignedUp', userId: user.id }),
!  }));
  res.status(201).json(user); // ~30 ms
});`,
          note: 'Amazon SQS with the AWS SDK for JavaScript v3. RabbitMQ, Google Pub/Sub and friends look much the same.',
        },
      },
      {
        id: 'follow-one-message',
        title: 'Follow one message',
        reset: true,
        cfg: { users: false, tour: true, workers: 1, work: 3.2, visibility: 10, readout: 'tour', rate: 0 },
        script: [{ at: 0.6, run: (s) => s.tourSend() }],
        body: (
          <>
            <p>Let’s follow a single message through its whole life. The card rides along with it.</p>
            <p>
              The producer <strong>sends</strong> it, and the queue stores it as <strong>ready</strong>. Then a worker <strong>receives</strong> it, and here’s
              the surprise: the queue doesn’t delete it. It moves it to the <Term k="q">in-flight</Term> shelf, hides it from every other worker, and starts a{' '}
              <strong>visibility timeout</strong> (the violet bar under it).
            </p>
            <p>
              When the worker finishes, it <strong>deletes</strong> the message (the green dot). That delete is the <strong>acknowledgment</strong>, or{' '}
              <em>ack</em>: “done, you can forget this one.” Only then is it gone.
            </p>
            <Aside>
              SQS workers <strong>pull</strong>: an idle one keeps a <em>long poll</em> open (the dashed violet line), a receive request that waits up to
              20 seconds for a message. RabbitMQ pushes to subscribed consumers instead, capped by a prefetch limit.
            </Aside>
          </>
        ),
        legend: [LG.msg, LG.ack, LG.poll],
        code: {
          title: 'worker.js',
          lang: 'js',
          code: `
const { Messages = [] } = await sqs.send(
  new ReceiveMessageCommand({
    QueueUrl: SIGNUPS_URL,
    WaitTimeSeconds: 20,     // long poll
!    VisibilityTimeout: 30,   // hide it for 30 s
  }));
for (const msg of Messages) {
  await handleSignup(JSON.parse(msg.Body));
!  await sqs.send(new DeleteMessageCommand({
!    QueueUrl: SIGNUPS_URL,
!    ReceiptHandle: msg.ReceiptHandle, // the ack
!  }));
}`,
          note: 'The stage hides messages for 10 seconds to keep things moving. SQS defaults to 30.',
        },
      },
      {
        id: 'absorb-a-spike',
        title: 'Absorb a spike',
        reset: true,
        cfg: { rate: 0.4, workers: 2, work: 1.5, readout: 'none' },
        script: [{ at: 2.5, run: (s) => s.spike(24, 2.4) }],
        body: (
          <>
            <p>Your launch post hits the front page. 24 people sign up in about two seconds.</p>
            <p>
              Without the queue, all 24 signups would hammer the email and thumbnail services at the same moment. With it, the handler writes 24 messages
              and answers everyone in milliseconds. The <strong>queue depth</strong> jumps, and the two workers chew through the backlog at their own
              steady pace until it <strong>drains</strong>.
            </p>
            <p>
              That’s the queue as a <strong>buffer</strong>: bursty arrivals in, a smooth stream of work out. Send another spike and watch the signup time
              stay flat.
            </p>
          </>
        ),
        panel: (sim) => (
          <ActionsCard
            buttons={[
              {
                label: 'Send a spike of 24 signups',
                icon: 'bolt',
                run: () => sim.spike(24, 2.4),
                after: <>Depth jumps and the oldest message ages, but signup time barely moves. The workers drain the backlog at their own pace.</>,
              },
            ]}
          />
        ),
        hud: ['signup', 'depth', 'age'],
        legend: [LG.req, LG.res, LG.msg, LG.ack],
        callouts: [{ target: 'q', text: <>the queue <b>soaks up the burst</b></>, dir: 'up' }],
        pCallouts: [],
        code: {
          title: 'CloudWatch · AWS/SQS metrics',
          lang: 'conf',
          code: `
!ApproximateNumberOfMessagesVisible    # depth
ApproximateNumberOfMessagesNotVisible # in flight
!ApproximateAgeOfOldestMessage         # oldest`,
          note: 'The two numbers in the HUD, as SQS reports them.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'scale',
    title: 'Keeping up',
    cfg: { mode: 'queue', users: false, readout: 'none', job: 'signup', queue: 'signups', work: 1.5, jitter: 0.15 },
    steps: [
      {
        id: 'falling-behind',
        title: 'When workers fall behind',
        reset: true,
        cfg: { workers: 1, rate: 0.35 },
        body: (
          <>
            <p>A queue absorbs bursts. It can’t rescue you from a producer that’s <em>always</em> faster than its consumers.</p>
            <p>
              This <Term k="w1">worker</Term> spends about 2 seconds per message, receive plus work, so it finishes about{' '}
              <strong>0.5 messages a second</strong>. Drag the arrival rate past that. The depth and the <strong>age of the oldest message</strong>{' '}
              climb and never come back down: each job waits a little longer than the one before it.
            </p>
            <p>
              The rule: over any stretch of time, consumers must keep up with producers <strong>on average</strong>. The queue only smooths the peaks.
            </p>
          </>
        ),
        panel: (sim) => (
          <SliderCard
            poll={sim}
            sliders={[
              {
                label: 'Arrivals',
                min: 0.2,
                max: 1.6,
                step: 0.05,
                initial: 0.35,
                format: (v) => `${v.toFixed(2)} msg/s`,
                ends: ['calm', 'busy'],
                onChange: (v) => sim.setRate(v),
              },
            ]}
            stats={() => (
              <>
                <Stat label="depth" value={sim.depth()} bad={sim.depth() >= 8} />
                <Stat label="oldest" value={`${sim.oldestAge().toFixed(1)} s`} bad={sim.oldestAge() > 10} />
              </>
            )}
            done={() =>
              sim.depth() >= 10 ? (
                <>
                  <strong>That backlog will never drain.</strong> More arrive every second than one worker can finish. You need more workers.
                </>
              ) : null
            }
          />
        ),
        hud: ['in', 'out', 'depth', 'age'],
        legend: [LG.msg, LG.ack, LG.poll],
      },
      {
        id: 'competing-consumers',
        title: 'Competing consumers',
        reset: true,
        cfg: { workers: 1, rate: 0.8, backlog: 14 },
        body: (
          <>
            <p>
              The fix is almost boring: run more workers against the same queue. They <strong>compete</strong> for messages. Whichever worker is free
              takes the next one, and each message goes to exactly one of them.
            </p>
            <p>
              You start with a backlog of 14 and a single worker, while 0.8 new messages arrive every second. Add workers until the backlog drains. Each
              one adds about 0.5 messages a second of capacity, and they never need to know about each other. That’s <strong>horizontal scaling</strong>.
            </p>
            <Aside>Parallel workers finish messages in whatever order they finish them. Chapter 7 shows when that hurts.</Aside>
          </>
        ),
        panel: (sim) => (
          <SliderCard
            poll={sim}
            sliders={[{ label: 'Workers', min: 1, max: 6, step: 1, initial: 1, format: (v) => `${v}`, onChange: (v) => sim.setWorkers(v) }]}
            stats={() => (
              <>
                <Stat label="finishing" value={`${sim.rateOut().toFixed(1)}/s`} />
                <Stat label="depth" value={sim.depth()} bad={sim.depth() >= 12} />
              </>
            )}
            done={() =>
              sim.depth() <= 1 && sim.cfg.workers >= 2 && sim.m.processed >= 14 ? (
                <>
                  <strong>Backlog cleared.</strong> Two workers (about 1 msg/s) already outpace 0.8 arrivals; every extra one drains a backlog faster.
                </>
              ) : null
            }
          />
        ),
        hud: ['in', 'out', 'depth', 'workers'],
        legend: [LG.msg, LG.ack, LG.poll],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
!kubectl scale deploy/signup-worker --replicas=4
# each replica runs: receive → work → delete`,
        },
      },
      {
        id: 'backpressure',
        title: 'Backpressure and autoscaling',
        reset: true,
        cfg: { workers: 1, work: 1.3, rate: 0.45, maxDepth: 10 },
        script: [{ at: 2.5, run: (s) => s.spike(22, 2.2) }],
        body: (
          <>
            <p>
              Real queues have limits. This one holds at most <strong>10 ready messages</strong>. When a spike arrives faster than it drains, the queue{' '}
              <strong>rejects</strong> new messages and the producer has to tell users “try again in a moment” (a 503). The slow end pushing back on the
              fast end is called <strong>backpressure</strong>. It beats silently running out of memory.
            </p>
            <p>
              The better fix is capacity that follows the backlog. Turn on <strong>autoscaling</strong>: a controller watches the depth, adds a worker per
              3 waiting messages, and removes them once it’s quiet. Then send another spike.
            </p>
            <Aside>
              SQS has no length limit, but messages expire after the retention period (4 days by default), and a long backlog is still a long wait. Alert
              on the <strong>age of the oldest message</strong>, not just the depth.
            </Aside>
          </>
        ),
        panel: (sim) => (
          <>
            <ToggleCard
              prompt="Autoscale workers on queue depth"
              options={[
                { label: 'Off', apply: () => sim.update({ autoscale: false }) },
                {
                  label: 'On',
                  apply: () => sim.update({ autoscale: true }),
                  note: <>Workers appear as the depth grows and leave once it’s been quiet for a few seconds.</>,
                },
              ]}
            />
            <ActionsCard kicker="Then" buttons={[{ label: 'Send a spike', icon: 'bolt', run: () => sim.spike(22, 2.2) }]} />
          </>
        ),
        hud: ['depth', 'age', 'rejected', 'workers'],
        legend: [LG.msg, LG.ack, LG.err],
        code: {
          title: 'rabbitmq · publisher.js',
          lang: 'js',
          code: `
await channel.assertQueue('signups', {
  durable: true,
  arguments: {
!    'x-max-length': 10,   // ready messages
    // when it’s full, refuse new ones:
!    'x-overflow': 'reject-publish',
  },
});
// publisher confirms turn a refusal into a nack`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'guarantees',
    title: 'Crashes and duplicates',
    cfg: { ...CHARGES, workers: 2, work: 2.4, jitter: 0.12, visibility: 6, restart: 3.5, rate: 0.42, clickWorkers: true, readout: 'ledger' },
    steps: [
      {
        id: 'a-worker-dies',
        title: 'A worker dies mid-message',
        reset: true,
        cfg: { predict: 'crash' },
        predict: { needed: 1, prompt: 'The worker crashed after receiving the message but before deleting it. What happens to the message?' },
        body: (
          <>
            <p>
              Time to raise the stakes. This queue carries <strong>charges</strong>: “charge order 1041, $35.” The table under the queue shows every charge
              that actually went through.
            </p>
            <p>
              Workers crash: out of memory, a bad deploy, a machine pulled out from under them. When the stage pauses, a worker has just died halfway
              through a message it received. <strong>What happens to that message?</strong>
            </p>
            <Aside>
              Set the timeout longer than your slowest job (long jobs can extend it with <code>ChangeMessageVisibility</code>). RabbitMQ has no timer
              here: it requeues unacked messages when the consumer’s connection drops.
            </Aside>
          </>
        ),
        hud: ['processed', 'inflight', 'redelivered'],
        legend: [LG.msg, LG.ack, LG.crash],
        callouts: [{ target: 'q#shelf', text: <>hidden, with a <b>timer</b></>, dir: 'up' }],
        pCallouts: [],
        code: {
          title: 'create-queue.js',
          lang: 'js',
          code: `
await sqs.send(new CreateQueueCommand({
  QueueName: 'charges',
  Attributes: {
    // received, not deleted? back in 30 s
!    VisibilityTimeout: '30',
  },
}));`,
        },
      },
      {
        id: 'charged-twice',
        title: 'Charged twice?',
        reset: true,
        seed: 11,
        cfg: { predict: 'double', rate: 0.3 },
        predict: { needed: 1, prompt: 'This worker charged the card, then crashed before deleting the message. What happens next?' },
        body: (
          <>
            <p>That redelivery saved the job. Now the nasty version of the same crash.</p>
            <p>
              This time the worker gets further. It charges the card, the charge lands in the table, and the worker dies a moment before its delete. The
              message is still in flight, with its timer running. <strong>Will the customer pay twice?</strong>
            </p>
          </>
        ),
        hud: ['charges', 'dupes', 'redelivered'],
        legend: [LG.msg, LG.ack, LG.crash],
        code: {
          title: 'worker.js',
          lang: 'js',
          code: `
for (const msg of Messages) {
  const order = JSON.parse(msg.Body);
!  await charges.create(order);  // money moves
!  // crash here and the delete never happens
  await sqs.send(new DeleteMessageCommand({
    QueueUrl, ReceiptHandle: msg.ReceiptHandle,
  }));
}`,
        },
      },
      {
        id: 'idempotent-consumers',
        title: 'Make repeats harmless',
        reset: true,
        seed: 11,
        script: [{ at: 0.8, run: (s) => s.armCrash(0.8) }],
        body: (
          <>
            <p>
              What you just saw is <strong>at-least-once delivery</strong>, the default in SQS, RabbitMQ and Kafka alike: a message is never lost, but it
              can arrive more than once. You can’t stop the repeat, so make it <strong>harmless</strong>.
            </p>
            <p>
              An operation is <strong>idempotent</strong> if doing it twice has the same effect as doing it once. Give the charges table a unique key on
              the order id, and a second insert for the same order simply does nothing.
            </p>
            <p>
              A worker is about to crash right after charging, unprotected: watch the table. Then switch the unique key on and crash another one.
            </p>
            <Aside>
              Dedupe on something stable. The message id catches redeliveries; a business key like the order id also catches a producer that sent the
              same order twice. Calling an outside payment API? Send an idempotency key (Stripe’s <code>Idempotency-Key</code> header) and it drops the
              repeat for you.
            </Aside>
          </>
        ),
        panel: (sim) => (
          <>
            <ToggleCard
              prompt="Unique key on order_id"
              options={[
                { label: 'Off', apply: () => sim.setIdempotent(false) },
                {
                  label: 'On',
                  apply: () => sim.setIdempotent(true),
                  note: <>A redelivered charge now finds its order id taken and becomes a no-op. The worker still deletes the message.</>,
                },
              ]}
            />
            <ActionsCard kicker="Break it" buttons={[{ label: 'Crash a worker right after it charges', icon: 'power', run: () => sim.armCrash(0.8) }]} />
          </>
        ),
        hud: ['charges', 'dupes', 'skipped'],
        legend: [LG.msg, LG.ack, LG.crash],
        code: {
          title: 'worker.js',
          lang: 'js',
          code: `
async function handleCharge(msg) {
  const o = JSON.parse(msg.Body);
!  await db.query(
!    \`INSERT INTO charges (order_id, amount)
!     VALUES ($1, $2)
!     ON CONFLICT (order_id) DO NOTHING\`,
!    [o.orderId, o.amount]);  // repeat → no-op
  await deleteMessage(msg);  // ack either way
}`,
        },
      },
      {
        id: 'delivery-guarantees',
        title: 'At-most-once, at-least-once, exactly-once',
        reset: true,
        seed: 5,
        cfg: { idempotent: true },
        body: (
          <>
            <p>
              <em>When</em> a worker acks decides what you’re promised.
            </p>
            <p>
              <strong>Ack after the work</strong>, as so far: a crash brings the message back. Nothing is lost, repeats happen. That’s{' '}
              <strong>at-least-once</strong>.
            </p>
            <p>
              <strong>Ack before the work</strong>: the message is deleted on arrival, so a crash loses the work for good. That’s{' '}
              <strong>at-most-once</strong>: fine for a metrics ping, awful for a payment. Flip it and crash a worker.
            </p>
            <p>
              <strong>Exactly-once</strong>? A crash can land between any two steps, so no queue can promise it alone. You build{' '}
              <em>effectively once</em> instead: at-least-once plus an idempotent consumer, the setup you now have.
            </p>
            <Aside>
              SQS FIFO queues drop duplicate sends within a 5-minute window, and Kafka transactions give exactly-once from topic to topic. A side effect
              outside the broker, like a card charge, still needs idempotency.
            </Aside>
          </>
        ),
        panel: (sim) => (
          <>
            <ToggleCard
              prompt="When does the worker delete (ack)?"
              options={[
                { label: 'After the work', apply: () => sim.setAckBefore(false), note: <>At-least-once: a crash means a retry, and idempotency makes the retry safe.</> },
                {
                  label: 'Before the work',
                  apply: () => sim.setAckBefore(true),
                  note: <>At-most-once: the message is gone before the work starts. Crash a worker now and that charge never happens.</>,
                },
              ]}
            />
            <ActionsCard kicker="Break it" buttons={[{ label: 'Crash a worker mid-message', icon: 'power', run: () => sim.armCrash(0.3) }]} />
          </>
        ),
        hud: ['processed', 'lost', 'dupes'],
        legend: [LG.msg, LG.ack, LG.crash],
        code: {
          title: 'rabbitmq · worker.js',
          lang: 'js',
          code: `
channel.consume('charges', async (msg) => {
  const order = JSON.parse(String(msg.content));
  await handleCharge(order);
!  channel.ack(msg);    // after the work
}, { noAck: false });  // → at-least-once

!// { noAck: true } = acked on delivery
!// → at-most-once`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'poison',
    title: 'Poison messages',
    cfg: { ...CHARGES, workers: 2, work: 1.8, jitter: 0.12, visibility: 4, restart: 3, rate: 0.4, idempotent: true, readout: 'none' },
    steps: [
      {
        id: 'the-message-that-always-fails',
        title: 'The message that always fails',
        reset: true,
        cfg: { dlq: false },
        script: [{ at: 1.2, run: (s) => s.sendPoison() }],
        body: (
          <>
            <p>
              One day a message arrives with <code>&quot;amount&quot;: &quot;twenty&quot;</code>, a typo from an old client. The worker throws on it. Every
              single time.
            </p>
            <p>
              The failed worker never deletes it, so after the timeout it’s back, another worker grabs it, throws, and around it goes. Watch the dots on{' '}
              <M color={SIG.err}>red</M>: that’s its <strong>receive count</strong>, climbing forever. Each lap burns a worker’s time, and in a FIFO queue it
              would also hold up every message behind it in its group.
            </p>
            <p>
              This is a <strong>poison message</strong>. Retrying can’t fix it, because the problem is in the message, not the moment.
            </p>
          </>
        ),
        hud: ['poison', 'out', 'depth'],
        legend: [LG.msg, LG.poison, LG.ack],
        code: {
          title: 'worker.js',
          lang: 'js',
          code: `
function parseCharge(body) {
  const { orderId, amount } = JSON.parse(body);
!  if (typeof amount !== 'number')
!    throw new TypeError(\`bad amount: \${amount}\`);
  return { orderId, amount };
}`,
        },
      },
      {
        id: 'dead-letter-queue',
        title: 'Dead-letter queues',
        reset: true,
        cfg: { dlq: true, maxReceives: 3 },
        script: [{ at: 1.2, run: (s) => s.sendPoison() }],
        body: (
          <>
            <p>
              The standard fix is a <strong>dead-letter queue</strong> (DLQ): a side queue for messages that failed too often. This one takes a message
              once it has been received <strong>3 times</strong> without a delete.
            </p>
            <p>
              The poison message gets its three tries, then drops into <Term k="dlq">charges-dlq</Term> and stops wasting workers. Everything else keeps
              flowing.
            </p>
            <p>
              A DLQ is not a trash can. Alert when anything lands in it, find the bug, deploy the fix, then <strong>redrive</strong> the messages back to
              the main queue. Try the whole loop below.
            </p>
            <Aside>
              Teams often add <strong>backoff</strong> too: wait longer after each failure, so a flaky dependency gets time to recover. RabbitMQ quorum
              queues cap retries with a <code>delivery-limit</code>, the same idea as <code>maxReceiveCount</code>.
            </Aside>
          </>
        ),
        panel: (sim) => (
          <ActionsCard
            buttons={[
              { label: 'Send a poison message', icon: 'bolt', run: () => sim.sendPoison() },
              {
                label: 'Deploy the fix',
                icon: 'check',
                run: () => sim.deployFix(),
                after: <>Workers now parse “twenty” correctly. The messages already in the DLQ are still parked there.</>,
              },
              {
                label: 'Redrive the DLQ',
                icon: 'replay',
                run: () => sim.redrive(),
                after: <>Parked messages go back to the main queue. If the fix is deployed, they succeed this time.</>,
              },
            ]}
          />
        ),
        hud: ['dlq', 'out', 'depth'],
        legend: [LG.msg, LG.poison, LG.ack],
        callouts: [{ target: 'dlq', text: <>failed 3 times: <b>parked, not lost</b></>, dir: 'left' }],
        pCallouts: [],
        code: {
          title: 'setup-dlq.js',
          lang: 'js',
          code: `
await sqs.send(new SetQueueAttributesCommand({
  QueueUrl: CHARGES_URL,
  Attributes: {
!    RedrivePolicy: JSON.stringify({
!      deadLetterTargetArn: CHARGES_DLQ_ARN,
!      maxReceiveCount: '3',  // then → DLQ
!    }),
  },
}));`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'fanout',
    title: 'Fan-out with pub/sub',
    cfg: { mode: 'fanout', producer: 'signup-api', producerSub: 'POST /signup', rate: 0.5, readout: 'none', subs: SUBS },
    steps: [
      {
        id: 'one-event-many-subscribers',
        title: 'One event, many subscribers',
        reset: true,
        body: (
          <>
            <p>
              Back to signups. Our queue carried jobs, which meant the handler had to know every piece of follow-up work. Adding a fraud check would mean
              editing signup code again.
            </p>
            <p>
              <strong>Publish/subscribe</strong> flips that around. The handler <strong>publishes</strong> one event, <code>UserSignedUp</code>, to an{' '}
              <Term k="ex">exchange</Term> (a <em>topic</em> in SNS or Kafka). Every interested service <strong>binds</strong> its own queue to it and gets
              its own copy. Watch <M>1</M> land in all three queues.
            </p>
            <p>The producer no longer knows or cares who is listening. That’s <strong>fan-out</strong>.</p>
          </>
        ),
        hud: ['backlogs'],
        legend: [LG.event, LG.ack, LG.poll],
        callouts: [{ target: 'ex', text: <>one publish, <b>a copy per queue</b></>, dir: 'down' }],
        pCallouts: [],
        code: {
          title: 'rabbitmq · amqplib',
          lang: 'js',
          code: `
// producer: publish once
await ch.assertExchange('user.events', 'fanout');
!ch.publish('user.events', '', Buffer.from(json));

// each subscriber: its own queue, bound
await ch.assertQueue('email');
!await ch.bindQueue('email', 'user.events', '');
ch.consume('email', async (msg) => {
  await sendWelcomeEmail(msg);
!  ch.ack(msg);
});`,
        },
      },
      {
        id: 'independent-subscribers',
        title: 'Subscribers don’t wait for each other',
        reset: true,
        body: (
          <>
            <p>
              Each subscriber drains its own queue at its own speed. Slow down <Term k="w:analytics">analytics</Term>: its backlog grows while email and
              thumbnails don’t notice a thing. A subscriber could be down for an hour, and its queue would simply hold its copies until it came back.
            </p>
            <p>
              Now add a new subscriber, a fraud check, by binding one more queue. You don’t touch the signup code at all. Notice it only gets events
              published <em>after</em> it subscribed: a queue can’t hold messages from before it existed.
            </p>
          </>
        ),
        panel: (sim) => (
          <>
            <ToggleCard
              kicker="Break it"
              prompt="The analytics worker is…"
              options={[
                { label: 'Normal', apply: () => sim.setSlowSub(null) },
                { label: 'Slow (3×)', apply: () => sim.setSlowSub('analytics'), note: <>Only the analytics backlog grows. The other subscribers are unaffected.</> },
              ]}
            />
            <ActionsCard
              buttons={[
                {
                  label: 'Add a fraud-check subscriber',
                  icon: 'plus',
                  run: () => sim.addSubscriber(),
                  after: <>A new queue, bound to the same exchange. Its first message is the next event published, not an old one.</>,
                },
              ]}
            />
          </>
        ),
        hud: ['backlogs'],
        legend: [LG.event, LG.ack, LG.poll],
        code: {
          title: 'terminal · Amazon SNS + SQS',
          lang: 'shell',
          code: `
!aws sns subscribe --protocol sqs \\
!  --topic-arn "$USER_EVENTS_TOPIC_ARN" \\
!  --notification-endpoint "$FRAUD_QUEUE_ARN"`,
          note: 'The same fan-out as a managed service: an SNS topic delivering a copy into each subscribed SQS queue.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'order',
    title: 'Order and partitions',
    steps: [
      {
        id: 'order-breaks',
        title: 'Why order breaks',
        reset: true,
        cfg: {
          mode: 'queue',
          users: false,
          job: 'plan',
          queue: 'account-events',
          producer: 'account-api',
          producerSub: 'PATCH /plan',
          workers: 2,
          work: 1.6,
          jitter: 0.5,
          rate: 0.15,
          readout: 'plans',
        },
        body: (
          <>
            <p>
              Competing consumers have a catch. Alice upgrades to Pro and changes her mind a moment later: two events for one user,{' '}
              <M color={SIG.pink}>A1</M> “plan = pro”, then <M color={SIG.pink}>A2</M> “plan = free”.
            </p>
            <p>
              Two workers take them in parallel. <Term k="w1">worker-1</Term> hits a slow patch on A1, worker-2 finishes A2 first, and then A1 lands last
              and <strong>overwrites the newer value</strong>. The users table says Pro. Alice gets billed for a plan she canceled.
            </p>
            <p>
              Many consumers on one queue give you <strong>no order between messages</strong>. SQS standard queues don’t even promise to deliver them in
              order in the first place.
            </p>
          </>
        ),
        hud: ['stale', 'processed'],
        legend: [LG.alice, LG.bob, LG.carol, LG.dave],
        code: {
          title: 'SQS FIFO · one fix',
          lang: 'js',
          code: `
await sqs.send(new SendMessageCommand({
  QueueUrl: ACCOUNT_EVENTS_FIFO_URL, // .fifo
  MessageBody: JSON.stringify(change),
!  MessageGroupId: change.userId,  // per user
  MessageDeduplicationId: change.id,
}));`,
          note: 'A FIFO queue won’t hand out a group’s next message while an earlier one is still in flight. Different groups still run in parallel.',
        },
      },
      {
        id: 'partitions-and-keys',
        title: 'Partitions and keys',
        reset: true,
        cfg: { mode: 'log', producer: 'account-api', producerSub: 'user events', partitions: 3, rate: 0.5, work: 1.3, jitter: 0.2, readout: 'hash', predict: 'partition' },
        predict: { needed: 2, prompt: 'Which partition will this event be appended to?' },
        body: (
          <>
            <p>
              Log-based brokers like <strong>Kafka</strong> build ordering in. A topic is split into <strong>partitions</strong>, append-only logs where
              each record gets the next <strong>offset</strong> (the small numbers). The producer picks a partition by hashing a <strong>key</strong>,
              here the user id: <code>partition = hash(key) mod 3</code>.
            </p>
            <p>
              Same key, same partition, every time. Each partition is read by one consumer in a group, in offset order. So Alice’s events stay in order while
              different users run in parallel. <strong>Predict where each event lands</strong>: pick a button or click a partition.
            </p>
            <Aside>Kafka’s default partitioner uses a murmur2 hash of the key bytes. We just add up the character codes so you can do the math.</Aside>
          </>
        ),
        hud: ['lag'],
        legend: [LG.alice, LG.bob, LG.carol, LG.dave],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
!kafka-topics --bootstrap-server localhost:9092 \\
!  --create --topic user-events \\
!  --partitions 3 --replication-factor 3`,
        },
      },
      {
        id: 'consumer-groups-and-offsets',
        title: 'Consumer groups and offsets',
        reset: true,
        cfg: { mode: 'log', producer: 'account-api', producerSub: 'user events', partitions: 3, rate: 0.55, work: 1.4, jitter: 0.2, readout: 'offsets', clickWorkers: true },
        body: (
          <>
            <p>
              A log differs from a queue in one big way: <strong>reading doesn’t delete</strong>. A <strong>consumer group</strong> just remembers a{' '}
              <strong>committed offset</strong> per partition, “everything before this is done”. Those are the triangles under the logs.
            </p>
            <p>
              <strong>Crash a consumer</strong>: the group <em>rebalances</em>, another member takes over its partition and resumes from the committed
              offset, so a record that was mid-flight is processed again. At-least-once, again.
            </p>
            <p>
              <strong>Add a consumer</strong> when all three are up: the 4th sits idle, because a partition belongs to one consumer per group.{' '}
              <strong>Start a new group</strong>: analytics reads the same records from offset 0, at its own pace. Click a consumer on the stage to crash
              or restart it.
            </p>
            <Aside>
              Need more than 3 consumers working? Add partitions: <code>kafka-topics … --alter --partitions 6</code>. Careful: that
              changes which partition each key maps to, for new events. Consumer <strong>lag</strong> is the log’s version of queue depth: alert on it.
            </Aside>
          </>
        ),
        panel: (sim) => (
          <ActionsCard
            buttons={[
              {
                label: 'Crash billing-2',
                icon: 'power',
                run: () => sim.crashConsumer('c:billing-2'),
                after: <>Its partition moves to a survivor, which starts from the last committed offset.</>,
              },
              {
                label: 'Add a consumer',
                icon: 'plus',
                run: () => sim.addConsumer('billing'),
                after: <>The group rebalances. A consumer beyond the number of partitions gets nothing to read.</>,
              },
              {
                label: 'Start an analytics group',
                icon: 'replay',
                run: () => sim.startGroup('analytics', SIG.heavy),
                after: <>A second group with its own offsets, reading every partition from offset 0.</>,
              },
            ]}
          />
        ),
        hud: ['lag', 'lagA'],
        legend: [LG.alice, LG.bob, LG.carol, LG.dave, LG.commit],
        code: {
          title: 'consumer.properties',
          lang: 'conf',
          code: `
!group.id=billing
!enable.auto.commit=false   # commit after work
auto.offset.reset=earliest # new group: offset 0`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    cfg: { ...CHARGES, readout: 'none', restart: 3, visibility: 5, jitter: 0.25, poisson: true },
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        reset: true,
        seed: 3,
        cfg: { workers: 3, work: 1.6, rate: 0.95, crashRate: 0.1, poisonRate: 0.05, dlq: true, idempotent: true },
        body: (
          <p>
            Everything in one picture: a queue buffering work, three competing workers, crashes ending in redelivery, idempotent charges that make
            repeats harmless, and a dead-letter queue catching poison. Nobody gets charged twice.
          </p>
        ),
        extra: <CheatSheet />,
        hud: ['in', 'out', 'depth', 'dupes', 'dlq'],
        legend: [LG.msg, LG.poison, LG.ack, LG.crash],
      },
      {
        id: 'playground',
        title: 'Playground',
        reset: true,
        seed: 9,
        cfg: { workers: 2, work: 1.6, rate: 0.8, crashRate: 0, poisonRate: 0, dlq: false, idempotent: false, clickWorkers: true },
        body: (
          <p>
            Your queue, your rules. Push the traffic, crash things, add poison, and pick the guarantees. Click a worker on the stage to crash or
            restart it. The config at the bottom follows your settings.
          </p>
        ),
        panel: (sim, cfg) => <Playground sim={sim} initial={cfg} />,
        hud: ['in', 'out', 'depth', 'age', 'dupes', 'dlq'],
        legend: [LG.msg, LG.poison, LG.ack, LG.crash],
      },
    ],
  },
];
