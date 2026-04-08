export type { RegexRule, PiiDomain, RegionCode } from './types.ts';

import type { RegexRule } from './types.ts';
import { rules as universal } from './universal.ts';
import { rules as gb } from './regions/gb.ts';
import { rules as pl } from './regions/pl.ts';
import { rules as de } from './regions/de.ts';
import { rules as fr } from './regions/fr.ts';
import { rules as es } from './regions/es.ts';
import { rules as pt } from './regions/pt.ts';
import { rules as se } from './regions/se.ts';
import { rules as no } from './regions/no.ts';
import { rules as it } from './regions/it.ts';
import { rules as nl } from './regions/nl.ts';
import { rules as be } from './regions/be.ts';
import { rules as at } from './regions/at.ts';
import { rules as ch } from './regions/ch.ts';
import { rules as ie } from './regions/ie.ts';
import { rules as dk } from './regions/dk.ts';
import { rules as fi } from './regions/fi.ts';
import { rules as us } from './regions/us.ts';

export const ALL_REGEX_RULES: RegexRule[] = [
  ...universal,
  ...gb,
  ...pl,
  ...de,
  ...fr,
  ...es,
  ...pt,
  ...se,
  ...no,
  ...it,
  ...nl,
  ...be,
  ...at,
  ...ch,
  ...ie,
  ...dk,
  ...fi,
  ...us,
];
