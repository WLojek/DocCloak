export type { RegexRule, PiiDomain, RegionCode } from './types.ts';

import type { RegexRule } from './types.ts';
import { rules as universal } from './universal.ts';
import { rules as us } from './regions/us.ts';
import { rules as gb } from './regions/gb.ts';
import { rules as pl } from './regions/pl.ts';
import { rules as de } from './regions/de.ts';
import { rules as fr } from './regions/fr.ts';
import { rules as es } from './regions/es.ts';
import { rules as pt } from './regions/pt.ts';
import { rules as se } from './regions/se.ts';
import { rules as no } from './regions/no.ts';
import { rules as jp } from './regions/jp.ts';
import { rules as cn } from './regions/cn.ts';

export const ALL_REGEX_RULES: RegexRule[] = [
  ...universal,
  ...us,
  ...gb,
  ...pl,
  ...de,
  ...fr,
  ...es,
  ...pt,
  ...se,
  ...no,
  ...jp,
  ...cn,
];
