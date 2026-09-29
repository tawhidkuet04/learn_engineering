import CHECKS from '@/content/checks.json';
import { softwareList } from '@/content/software';
import { testedCard, OG_SIZE } from '@/og/card';

export const alt = 'How the lessons are tested: checked against the real software';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const dynamic = 'force-static';

export default function Image() {
  const checks = CHECKS.checks;
  const lessons = new Set(checks.map((c) => c.lesson)).size;
  const programs = softwareList(checks.map((c) => c.software));
  return testedCard(checks.length, lessons, programs, checks.every((c) => c.pass));
}
