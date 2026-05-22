import * as P from 'parsimmon'
import * as M from './model';
import { v4 as UUID } from "uuid";
import { tropusParser } from './TropusParser';
import { liedParser } from './LiedParser';
import { gesangParser } from './GesangParser';
import { sequenzParser } from './SequenzParser';
import { miscParser } from './MiscParser';
import { ordinariumRoot } from './OrdinariumsParser';

export const parsers = {
  Sequenz: sequenzParser(),
  Tropus: tropusParser(),
  Gesang: gesangParser(),
  Lied: liedParser(),
  Misc: miscParser(),
  Ordinariumsgesang: ordinariumRoot(),
}
