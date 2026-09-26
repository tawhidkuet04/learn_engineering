import type { ComponentType } from 'react';
import LoadBalancingLesson from './load-balancing/LoadBalancingLesson';

/** Interactive lesson component for every live topic, keyed by slug. */
export const LESSONS: Record<string, ComponentType> = {
  'load-balancing': LoadBalancingLesson,
};
