import type { ReactNode } from 'react';
import css from './lesson.module.css';

export function Prose({ children }: { children: ReactNode }) {
  return <div className={css.body}>{children}</div>;
}

export function Aside({ children }: { children: ReactNode }) {
  return <p className={css.aside}>{children}</p>;
}

export { css as lessonCss };
