/**
 * Regional Pokédex checker (docs/design/roster-v25.md §4.2): draws the regional Pokédex for many seeds with the game's own
 * `drawRegionalDex` / `deriveRosterTables` and reports content gaps, constraint coverage, variety, inclusion rates and recruit slots.
 *
 *   node tools/regional-dex.ts --eras simple --seeds 1-1000 [--size 48] [--leaders rotation|none|oak,misty] [--show 31] [--gaps] [--json out.json]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REGIONAL_CONTENT } from '../src/content/units.ts';
import type { SpeciesId } from '../src/content/units.ts';
import { deriveRosterTables, dexMaxGeneration, drawRegionalDex, evolutionLines, REGIONAL_DEX_RULES } from '../src/content/regional-dex.ts';
import type { RegionalDexDraw } from '../src/content/regional-dex.ts';
import { RECRUIT_SLOTS } from '../src/content/recruit-slots.ts';
import { CLASS_NATIVE_TYPES } from '../src/content/unit-classes.ts';
import { LEADER_IDS, isLeaderId } from '../src/content/leaders.ts';
import type { LeaderId } from '../src/content/leaders.ts';
import type { EraProgression } from '../src/content/eras.ts';
import type { TypeId } from '../src/content/species.ts';
import { TYPE_NAMES } from '../src/content/type-names.ts';
import { parseSeeds, splitFlags } from './balance-run.ts';

export type RegionalDexOptions = { mode: EraProgression; seeds: number[]; size?: number; leaders: 'rotation' | 'none' | LeaderId[]; show?: number; gapsOnly?: boolean };
const USAGE = 'Usage: node tools/regional-dex.ts --eras simple|full --seeds 1-1000 [--size 48] [--leaders rotation|none|oak,misty,...] [--show 31] [--gaps] [--json out.json]';
const ROLES = ['melee', 'ranged', 'fast', 'scout', 'siege', 'air', 'naval'] as const;
const ROLE_NAMES: Record<string, string> = { melee: '近战', ranged: '远程', fast: '快速', scout: '侦察', siege: '攻城', air: '飞行', naval: '水面' };
const SOURCE_NAMES: Record<string, string> = { anchor: '锚定', leader: '领袖专属', repair: '修补约束', draw: '抽取' };
const species = REGIONAL_CONTENT.species;
const name = (id: string) => species[id]?.name ?? id;
const typesOf = (id: string): TypeId[] => species[id].secondaryTypeId ? [species[id].typeId, species[id].secondaryTypeId!] : [species[id].typeId];
/** Rotating seats: seed s seats leaders s, s+1, s+2, s+3 (mod 9), like the balance gate's rotations. */
export const leadersFor = (option: RegionalDexOptions['leaders'], seed: number): LeaderId[] =>
  option === 'none' ? [] : option === 'rotation' ? [0, 1, 2, 3].map(index => LEADER_IDS[(seed + index) % LEADER_IDS.length]) : option;
const quantile = (values: readonly number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(p * (sorted.length - 1))] : 0; };
const spread = (values: readonly number[]) => `${quantile(values, 0)} / ${quantile(values, 0.5)} / ${quantile(values, 1)}`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const table = (headers: string[], rows: string[][]) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');

/** The class × stage matrix of a mode's pool: native-type candidates and all candidates per cell. */
export function poolMatrix(mode: EraProgression) {
  const pool = evolutionLines(species, dexMaxGeneration(mode)).flatMap(line => line.speciesIds);
  return ROLES.map(role => ({ role, stages: [1, 2, 3].map(stage => {
    const any = pool.filter(id => species[id].role === role && species[id].stage === stage);
    const native = any.filter(id => typesOf(id).some(type => (CLASS_NATIVE_TYPES[role] as readonly TypeId[]).includes(type)));
    return { stage, native, any, lines: new Set(any.map(id => evolutionLines(species, dexMaxGeneration(mode)).find(line => line.speciesIds.includes(id))!.id)).size };
  }) }));
}

export function regionalDexReport(options: RegionalDexOptions): { markdown: string; json: Record<string, unknown> } {
  const { mode } = options, maxGeneration = dexMaxGeneration(mode), lines = evolutionLines(species, maxGeneration);
  const pool = lines.flatMap(line => line.speciesIds), matrix = poolMatrix(mode);
  const gaps = matrix.flatMap(row => row.stages.filter(cell => cell.any.length === 0).map(cell => `${ROLE_NAMES[row.role]}${cell.stage}阶`));
  const single = matrix.flatMap(row => row.stages.filter(cell => cell.lines === 1 || (cell.native.length > 0 && new Set(cell.native.map(id => lines.find(line => line.speciesIds.includes(id))!.id)).size === 1))
    .map(cell => `${ROLE_NAMES[row.role]}${cell.stage}阶（${(cell.native.length ? cell.native : cell.any).map(name).join('、')}）`));
  const typeLines = new Map<TypeId, Set<string>>();
  for (const line of lines) for (const id of line.speciesIds) for (const type of typesOf(id)) (typeLines.get(type) ?? typeLines.set(type, new Set()).get(type)!).add(line.id);
  const scarce = [...typeLines].filter(([, set]) => set.size <= 2).sort((a, b) => a[1].size - b[1].size || (a[0] < b[0] ? -1 : 1));
  const matrixMd = table(['兵种', '一阶', '二阶', '三阶'], matrix.map(row => [ROLE_NAMES[row.role], ...row.stages.map(cell => cell.any.length
    ? `${cell.native.map(name).join('、') || '—'}（${cell.any.length}）` : '**—**（0）')]));
  const gapsMd = `## 1. 物种池与兵种 × 阶段矩阵（${mode === 'full-v1' ? '完整' : '精简'}模式，${pool.length} 种、${lines.length} 条线）

格子里是属性契合的候选，括号里是不论属性的候选数。

${matrixMd}

- 结构性空格（整个池都没有）：${gaps.join('、') || '无'}
- 单候选格（只有一条线能填，所以每局必有）：${single.join('；') || '无'}
- 稀缺属性（≤ 2 条线）：${scarce.map(([type, set]) => `${TYPE_NAMES[type]} ${set.size} 条（${[...set].map(name).join('、')}）`).join('；') || '无'}
`;
  if (options.gapsOnly) return { markdown: gapsMd, json: { mode, pool: pool.length, lines: lines.length, gaps, single, scarce: scarce.map(([type, set]) => ({ type, lines: [...set] })) } };

  const draws: { seed: number; draw: RegionalDexDraw; tables: ReturnType<typeof deriveRosterTables> }[] = options.seeds.map(seed => {
    const draw = drawRegionalDex({ species, mode, dexSeed: seed, leaders: leadersFor(options.leaders, seed), ...(options.size ? { size: options.size } : {}) });
    return { seed, draw, tables: deriveRosterTables(species, draw.speciesIds, mode) };
  });
  const n = draws.length, met = draws.filter(item => item.draw.unmet.length === 0).length;
  const jaccard: number[] = [];
  for (let index = 0; index + 1 < n; index += 2) {
    const a = new Set(draws[index].draw.speciesIds), b = new Set(draws[index + 1].draw.speciesIds), shared = [...a].filter(id => b.has(id)).length;
    jaccard.push(shared / (a.size + b.size - shared));
  }
  const lineRate = new Map(lines.map(line => [line.id, draws.filter(item => item.draw.lines.some(entry => entry.id === line.id)).length / n]));
  const always = lines.filter(line => lineRate.get(line.id) === 1).map(line => line.id);
  const rare = lines.filter(line => lineRate.get(line.id)! < 0.15).map(line => line.id);
  const speciesRate = new Map(pool.map(id => [id, draws.filter(item => item.draw.speciesIds.includes(id)).length / n]));
  const types = [...typeLines.keys()].sort();
  const perType = types.map(type => [TYPE_NAMES[type], spread(draws.map(item => item.draw.speciesIds.filter(id => typesOf(id).includes(type)).length))]);
  const perRole = ROLES.map(role => [ROLE_NAMES[role], spread(draws.map(item => item.draw.speciesIds.filter(id => species[id].role === role).length))]);
  const slots = RECRUIT_SLOTS.filter(slot => (slot.generation ?? 0) <= maxGeneration);
  const slotRows = slots.map(slot => {
    const results = draws.map(item => item.tables.recruitSlots.find(entry => entry.slot === slot.id)!);
    const counts = new Map<string, number>();
    for (const result of results) counts.set(result.speciesId ?? '—', (counts.get(result.speciesId ?? '—') ?? 0) + 1);
    const levels = [1, 2, 3, 4, 5, 6].map(level => results.filter(result => result.level === level).length);
    return [`${slot.id}${slot.core ? '（核心）' : ''}`, name(slot.preferred), percent(levels[0] / n), percent(levels[5] / n),
      levels.slice(1, 5).map((count, index) => count ? `${index + 2}级 ${count}` : '').filter(Boolean).join('、') || '—',
      [...counts].filter(([id]) => id !== slot.preferred).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id, count]) => `${id === '—' ? '空' : name(id)} ${count}`).join('、') || '—'];
  });
  const empties = draws.map(item => item.tables.recruitSlots.filter(entry => !entry.speciesId).length);
  const rares = draws.map(item => item.draw.speciesIds.filter(id => species[id].rare).length);
  const showMd = options.show === undefined ? '' : showDraw(options, options.show);
  const markdown = `# 地区图鉴校验（${mode === 'full-v1' ? '完整' : '精简'}模式，目标 ${options.size ?? REGIONAL_DEX_RULES.size[mode]} 种，种子 ${options.seeds[0]}–${options.seeds.at(-1)}，领袖 ${Array.isArray(options.leaders) ? options.leaders.join(',') : options.leaders}）

> 由 \`node tools/regional-dex.ts\` 生成，用的是游戏里的 \`drawRegionalDex\` / \`deriveRosterTables\`。

${gapsMd}
## 2. 约束

- 全部约束满足：${met}/${n}（必须 100%）${met < n ? `；未满足：${draws.filter(item => item.draw.unmet.length).slice(0, 5).map(item => `种子 ${item.seed} ${item.draw.unmet.join(',')}`).join('；')}` : ''}
- 图鉴大小（最小 / 中位 / 最大）：${spread(draws.map(item => item.draw.size))}
- 修补次数（最小 / 中位 / 最大）：${spread(draws.map(item => item.draw.repairs))}
- 稀有物种（最小 / 中位 / 最大）：${spread(rares)}；超过 ${REGIONAL_DEX_RULES.rareMax} 种的图鉴 ${percent(rares.filter(count => count > REGIONAL_DEX_RULES.rareMax).length / n)}

## 3. 差异

- 两两重合（Jaccard，相邻种子成对，${jaccard.length} 对）：最小 ${quantile(jaccard, 0).toFixed(2)} / P10 ${quantile(jaccard, 0.1).toFixed(2)} / 中位 ${quantile(jaccard, 0.5).toFixed(2)} / P90 ${quantile(jaccard, 0.9).toFixed(2)} / 最大 ${quantile(jaccard, 1).toFixed(2)}
- 不同的图鉴：${new Set(draws.map(item => item.draw.speciesIds.join())).size}/${n}
- 每局必有的线（${always.length} 条）：${always.map(name).join('、')}

## 4. 每局物种数（最小 / 中位 / 最大）

${table(['属性', '物种数'], perType)}

${table(['兵种', '物种数'], perRole)}

## 5. 入选率

${table(['进化线', '入选率'], lines.map(line => [name(line.id), percent(lineRate.get(line.id)!)]))}

- 入选率 < 15% 的线：${rare.map(id => `${name(id)} ${percent(lineRate.get(id)!)}`).join('、') || '无'}${rare.length ? '（考虑在 `species-tags.ts` 给它们 `draw` 补偿票数）' : ''}
- 物种入选率最低的 5 种：${[...speciesRate].sort((a, b) => a[1] - b[1]).slice(0, 5).map(([id, rate]) => `${name(id)} ${percent(rate)}`).join('、')}

## 6. 招募槽

${table(['槽', '首选', '首选率', '空槽率', '补位等级', '常见补位'], slotRows)}

- 每局空槽（最小 / 中位 / 最大）：${spread(empties)}
${showMd}`;
  return { markdown, json: { mode, seeds: options.seeds, pool: pool.length, lines: lines.length, gaps, single, met, n,
    sizes: draws.map(item => item.draw.size), jaccard: { min: quantile(jaccard, 0), p10: quantile(jaccard, 0.1), median: quantile(jaccard, 0.5), p90: quantile(jaccard, 0.9), max: quantile(jaccard, 1) },
    distinct: new Set(draws.map(item => item.draw.speciesIds.join())).size, always, lineRate: Object.fromEntries(lineRate), emptySlots: empties,
    draws: draws.map(item => ({ seed: item.seed, speciesIds: item.draw.speciesIds, lines: item.draw.lines.map(line => ({ id: line.id, source: line.source })) })) } };
}

/** `--show N`: one seed's regional Pokédex (lines by source, classes and recruits), the format of roster-v25 §0.4. */
export function showDraw(options: RegionalDexOptions, seed: number): string {
  const leaders = leadersFor(options.leaders, seed);
  const draw = drawRegionalDex({ species, mode: options.mode, dexSeed: seed, leaders, ...(options.size ? { size: options.size } : {}) });
  const tables = deriveRosterTables(species, draw.speciesIds, options.mode);
  const bySource = (['anchor', 'leader', 'repair', 'draw'] as const).map(source => [SOURCE_NAMES[source], draw.lines.filter(line => line.source === source).map(line => name(line.id)).join('、') || '—']);
  const recruits = tables.recruitSlots.map(item => `${item.slot} ${item.speciesId ? name(item.speciesId) : '空'}${item.level > 1 && item.level < 6 ? `（${item.level}级补位）` : ''}`).join('；');
  return `
## 种子 ${seed}（领袖：${leaders.join('、') || '无'}；${draw.size} 种、${draw.lines.length} 条线）

${table(['来源', '进化线'], [...bySource, ['兵种', ROLES.map(role => `${ROLE_NAMES[role]} ${draw.speciesIds.filter(id => species[id].role === role).length}`).join('、')], ['招募', recruits]])}

物种：${draw.speciesIds.map(id => name(id as SpeciesId)).join('、')}
`;
}

export function parseRegionalDexArgs(args: readonly string[]): RegionalDexOptions & { json: string | null } {
  const rest = args.filter(arg => arg !== '--gaps'), gapsOnly = rest.length !== args.length;
  const { flags } = splitFlags(rest, ['--eras', '--seeds', '--size', '--leaders', '--show', '--json'], USAGE);
  const eras = flags['--eras'] ?? 'simple';
  if (eras !== 'simple' && eras !== 'full') throw new Error(`${USAGE}\n(--eras: simple or full)`);
  const leadersText = flags['--leaders'] ?? 'rotation';
  const leaders = leadersText === 'rotation' || leadersText === 'none' ? leadersText : leadersText.split(',').map(id => {
    if (!isLeaderId(id)) throw new Error(`--leaders: unknown leader ${id}`);
    return id;
  });
  const size = flags['--size'] === undefined ? undefined : Number(flags['--size']);
  if (size !== undefined && (!Number.isSafeInteger(size) || size < 20 || size > 105)) throw new Error('--size: 20..105');
  const show = flags['--show'] === undefined ? undefined : Number(flags['--show']);
  if (show !== undefined && !Number.isSafeInteger(show)) throw new Error('--show: a seed');
  return { mode: eras === 'full' ? 'full-v1' : 'simple-v1', seeds: parseSeedsWide(flags['--seeds'] ?? '1-200'), leaders, gapsOnly,
    ...(size === undefined ? {} : { size }), ...(show === undefined ? {} : { show }), json: flags['--json'] ?? null };
}
/** Like the balance runner's seed list, but up to 10 000 seeds. */
function parseSeedsWide(text: string): number[] {
  const match = /^(\d+)-(\d+)$/.exec(text);
  if (match && Number(match[2]) - Number(match[1]) < 10_000 && Number(match[1]) >= 1 && Number(match[2]) >= Number(match[1])) {
    return Array.from({ length: Number(match[2]) - Number(match[1]) + 1 }, (_, index) => Number(match[1]) + index);
  }
  return parseSeeds(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseRegionalDexArgs(process.argv.slice(2)), report = regionalDexReport(options);
  if (options.json) writeFileSync(resolve(options.json), JSON.stringify(report.json, null, 1) + '\n');
  process.stdout.write(report.markdown);
}
