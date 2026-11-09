import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { CIV_GLOSSARY, CIV_GLOSSARY_GROUPS, CIV_GLOSSARY_IDS } from '../../src/content/civ-glossary.ts';
import type { CivGlossaryEntry, CivGlossaryId } from '../../src/content/civ-glossary.ts';
import { SECTIONS } from '../../src/guide/sections.ts';
import { CIV6_SECTION_ID } from '../../src/guide/civ6.ts';

const text = (html: string) => html.replace(/<[^>]+>/g, '');
const entry = (id: CivGlossaryId): CivGlossaryEntry => CIV_GLOSSARY[id];
const spellings = (id: CivGlossaryId) => [entry(id).term, ...(entry(id).aliases ?? [])];

test('every glossary term appears in the handbook chapter it points to', () => {
  for (const id of CIV_GLOSSARY_IDS) {
    const section = SECTIONS.find(item => item.id === entry(id).section);
    expect(section, `${id} → section ${entry(id).section}`).toBeDefined();
    expect(section!.id, id).not.toBe(CIV6_SECTION_ID);
    expect(text(section!.title + section!.html), `${id}: “${entry(id).term}” in #${section!.id}`).toContain(entry(id).term);
    expect(CIV_GLOSSARY_GROUPS, id).toContain(entry(id).group);
    expect(entry(id).civ.length, id).toBeGreaterThan(0);
  }
  // Terms are unique, so the handbook table and the hover cards never disagree about a name.
  expect(new Set(CIV_GLOSSARY_IDS.map(id => entry(id).term)).size).toBe(CIV_GLOSSARY_IDS.length);
});

test('the handbook glossary lists every term once and follows the systems overview', () => {
  const index = SECTIONS.findIndex(section => section.id === CIV6_SECTION_ID);
  expect(SECTIONS[index - 1].id).toBe('systems');
  const glossary = SECTIONS[index];
  expect(glossary.html.match(/<tr>/g)!.length - 1).toBe(CIV_GLOSSARY_IDS.length);
  for (const id of CIV_GLOSSARY_IDS) {
    expect(glossary.html, id).toContain(`<strong>${entry(id).term}</strong>`);
    expect(glossary.html, id).toContain(`href="#${entry(id).section}"`);
  }
  // Every Civ VI term tagged on an overview row names a system that row describes.
  const overview = SECTIONS.find(section => section.id === 'systems')!.html;
  const rows = [...overview.matchAll(/<tr>(.*?)<\/tr>/g)].map(([, row]) => row).filter(row => row.includes('data-civ-terms'));
  expect(rows.length).toBeGreaterThanOrEqual(20);
  for (const row of rows) {
    const plain = text(row.replace(/<small class="civ-term"[^>]*>.*?<\/small>/, ''));
    for (const id of row.match(/data-civ-terms="([^"]+)"/)![1].split(' ') as CivGlossaryId[]) {
      expect(spellings(id).some(spelling => plain.includes(spelling)), `${plain.slice(0, 20)} ↔ ${id}`).toBe(true);
    }
  }
});

test('every in-game hint sits next to text that uses its term', () => {
  const directory = resolve(import.meta.dirname, '../../src/browser');
  const used = new Set<string>();
  for (const file of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
    readFileSync(resolve(directory, file), 'utf8').split('\n').forEach((line, row) => {
      for (const [, id] of line.matchAll(/civ(?:Hint|Aside)\('(\w+)'\)/g)) {
        expect(CIV_GLOSSARY_IDS, `${file}:${row + 1}`).toContain(id);
        expect(spellings(id as CivGlossaryId).some(spelling => line.includes(spelling)), `${file}:${row + 1} ${id}`).toBe(true);
        used.add(id);
      }
    });
  }
  // The hints cover the systems a Civ VI player looks for first.
  for (const id of ['charter', 'policyCard', 'government', 'era', 'discovery', 'phantom', 'overlord', 'district', 'nest', 'itemBall', 'wonder', 'faith']) expect(used, id).toContain(id);
});
