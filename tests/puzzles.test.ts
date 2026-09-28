import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePuzzle } from '../src/shared/puzzle';
import { evaluate } from '../src/sim/index';

// Every committed puzzle with a reference solution must pass, and its par must match.
describe('puzzle references', () => {
  const dir = new URL('../puzzles/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const puzzle = parsePuzzle(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    if (!puzzle.reference) continue;
    it(`${puzzle.id} reference passes at par`, () => {
      const r = evaluate(puzzle, puzzle.reference!);
      expect(r.layoutErrors).toEqual([]);
      expect(r.jams).toEqual([]);
      expect(r.pass).toBe(true);
      expect(r.scores).toEqual(puzzle.par);
    });
    (puzzle.alternates ?? []).forEach((alt, i) => {
      it(`${puzzle.id} alternate ${i + 1} passes`, () => {
        const r = evaluate(puzzle, alt);
        expect(r.layoutErrors).toEqual([]);
        expect(r.jams).toEqual([]);
        expect(r.pass).toBe(true);
      });
    });
  }
});
