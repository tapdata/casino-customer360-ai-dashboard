import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BSON } from 'mongodb';
import { loadSeed } from '../scripts/demo-seed.mjs';

test('Git demo seed has 23 checked, anonymized collections', () => {
  const seed = loadSeed('seed/demo');
  assert.equal(seed.collections.length, 23);
  assert.ok(seed.collections.every(collection => collection.count > 0));
  const text = seed.collections.map(collection => readFileSync(`seed/demo/${collection.file}`)).join(' ');
  assert.doesNotMatch(text, /Chan Wai Ming|Lau Ka Ho|Wong Mei Ling|casinoCardNo|passportHash/);
});

test('demo seed keeps BSON dates and identifiers usable by MongoDB', () => {
  const seed = loadSeed('seed/demo');
  const profile = seed.collections.find(collection => collection.name === 'patron_profiles');
  assert.ok(profile.documents[0]._id);
  assert.ok(profile.documents[0].updatedAt instanceof BSON.BSONSymbol || profile.documents[0].updatedAt instanceof Date || profile.documents[0].updatedAt?._bsontype === 'date');
});
