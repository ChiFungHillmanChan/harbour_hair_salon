import type { PluralMessage } from '../format';
import type { en } from './en';

/** The English tree is the schema every other language must match exactly. */
export type Messages = typeof en;
export type Namespace = keyof Messages;

/** Same keys as English; plural forms may differ (Chinese has only `other`). */
export type Localized<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends PluralMessage ? PluralMessage : Localized<T[K]>;
};
