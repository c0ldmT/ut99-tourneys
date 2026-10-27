import { describe, expect, it } from 'vitest';
import { hubShape, udtAreaOf, udtAreas } from '../src/app/core/udt-areas';

describe('Dream Team areas and the hub shape (decision 228)', () => {
  it('finds the area of a page', () => {
    expect(udtAreaOf('/udt')).toBeNull();
    expect(udtAreaOf('/udt/team?bot=x')).toBe('team');
    expect(udtAreaOf('/udt/bot/abc')).toBe('team');
    expect(udtAreaOf('/udt/league/day')).toBe('league');
    expect(udtAreaOf('/udt/packs#craft')).toBe('packs');
    expect(udtAreaOf('/udt/table')).toBe('cups');
    expect(udtAreaOf('/udt/squads/u1')).toBe('trans');
  });

  it('has the league only while it shows', () => {
    expect(udtAreas(true).map((a) => a.id)).toEqual(['team', 'league', 'packs', 'cups', 'trans']);
    expect(udtAreas(false).map((a) => a.id)).toEqual(['team', 'packs', 'cups', 'trans']);
  });

  it('cuts a square with a flat top and a pentagon with a corner on top', () => {
    const c = { x: 0, y: 0 };
    const sq = hubShape(4, c, 10);
    // Segment 0 is the top edge: its outward direction points up.
    expect(sq.segments[0]!.normal.x).toBeCloseTo(0);
    expect(sq.segments[0]!.normal.y).toBeCloseTo(-1);
    const pent = hubShape(5, c, 10);
    expect(Math.min(...pent.corners.map((p) => p.y))).toBeCloseTo(-10);
    // Upper left, upper right, lower right, bottom, lower left.
    const n = pent.segments.map((s) => s.normal);
    expect(n[0]!.x).toBeLessThan(0);
    expect(n[1]!.x).toBeGreaterThan(0);
    expect(n[3]!.y).toBeCloseTo(1);
  });
});
