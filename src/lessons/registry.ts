import type { ComponentType } from 'react';
import TemplateLesson from './_template/Lesson';
import LoadBalancingLesson from './load-balancing/LoadBalancingLesson';
import CachingLesson from './caching/Lesson';
import CdnLesson from './cdn/Lesson';
import ConsistentHashingLesson from './consistent-hashing/Lesson';
import ReplicationLesson from './replication/Lesson';
import ShardingLesson from './sharding/Lesson';
import RateLimitingLesson from './rate-limiting/Lesson';
import MessageQueuesLesson from './message-queues/Lesson';
import CapLesson from './cap/Lesson';
import LifeOfARequestLesson from './life-of-a-request/Lesson';
import OsiModelLesson from './osi-model/Lesson';
import TcpLesson from './tcp/Lesson';
import DnsLesson from './dns/Lesson';
import TlsLesson from './tls/Lesson';
import HttpVersionsLesson from './http-versions/Lesson';
import NatLesson from './nat/Lesson';
import WebsocketsLesson from './websockets/Lesson';
import ProcessesThreadsLesson from './processes-threads/Lesson';
import EventLoopLesson from './event-loop/Lesson';
import HashTablesLesson from './hash-tables/Lesson';
import StackHeapLesson from './stack-heap/Lesson';
import GarbageCollectionLesson from './garbage-collection/Lesson';
import CpuCachesLesson from './cpu-caches/Lesson';
import RaceConditionsLesson from './race-conditions/Lesson';
import BigOLesson from './big-o/Lesson';

/** Interactive lesson component for every topic, keyed by slug. */
export const LESSONS: Record<string, ComponentType> = {
  'load-balancing': LoadBalancingLesson,
  'caching': CachingLesson,
  'cdn': CdnLesson,
  'consistent-hashing': ConsistentHashingLesson,
  'replication': ReplicationLesson,
  'sharding': ShardingLesson,
  'rate-limiting': RateLimitingLesson,
  'message-queues': MessageQueuesLesson,
  'cap': CapLesson,
  'life-of-a-request': LifeOfARequestLesson,
  'osi-model': OsiModelLesson,
  'tcp': TcpLesson,
  'dns': DnsLesson,
  'tls': TlsLesson,
  'http-versions': HttpVersionsLesson,
  'nat': NatLesson,
  'websockets': WebsocketsLesson,
  'processes-threads': ProcessesThreadsLesson,
  'event-loop': EventLoopLesson,
  'hash-tables': HashTablesLesson,
  'stack-heap': StackHeapLesson,
  'garbage-collection': GarbageCollectionLesson,
  'cpu-caches': CpuCachesLesson,
  'race-conditions': RaceConditionsLesson,
  'big-o': BigOLesson,
};

/** Kit demo for lesson authors; only served in development. */
export const DEV_LESSONS: Record<string, ComponentType> = { 'kit-demo': TemplateLesson };
