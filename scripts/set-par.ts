// Evaluates each puzzle's reference solution and writes its scores as par.
// Usage: npx tsx scripts/set-par.ts [puzzle-id ...]   (default: all puzzles with a reference)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../src/sim/index';
import { parsePuzzle } from '../src/shared/puzzle';

const dir = join(import.meta.dirname, '..', 'puzzles');
const only = process.argv.slice(2);
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const puzzle = parsePuzzle(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (!puzzle.reference || (only.length && !only.includes(puzzle.id))) continue;
  const r = evaluate(puzzle, puzzle.reference);
  if (!r.pass || r.scores.latency === null) {
    failed = true;
    console.error(`FAIL ${puzzle.id}`, JSON.stringify({ layout: r.layoutErrors, jams: r.jams, demands: r.demands }, null, 1));
    continue;
  }
  puzzle.par = { footprint: r.scores.footprint, cost: r.scores.cost, latency: r.scores.latency };
  writeFileSync(join(dir, file), JSON.stringify(puzzle, null, 2) + '\n');
  console.log(`ok   ${puzzle.id}  par ${JSON.stringify(puzzle.par)}`);
  (puzzle.alternates ?? []).forEach((alt, i) => {
    const a = evaluate(puzzle, alt);
    if (!a.pass) failed = true;
    console.log(`  alt ${i + 1}: ${a.pass ? 'pass' : 'FAIL'} ${JSON.stringify(a.scores)}${a.pass ? '' : ' ' + JSON.stringify({ jams: a.jams, demands: a.demands, layout: a.layoutErrors })}`);
  });
}
process.exit(failed ? 1 : 0);
