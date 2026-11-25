import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/database.js';
import { MIGRATIONS } from '../src/db/migrations.js';

describe('migrate', () => {
  it('brings an empty database to the newest version', () => {
    const db = new Database(':memory:');
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    db.close();
  });

  it('refuses a database of a newer program (a restored backup)', () => {
    const db = new Database(':memory:');
    db.pragma(`user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/install the same or a newer release/);
    db.close();
  });
});
