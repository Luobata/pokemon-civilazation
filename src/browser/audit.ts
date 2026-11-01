import '../audit.css';
import { EXPANSION_ACTION_FIELDS, expansionActionType } from '../core/expansion-commands.ts';
import { AUDIT_SYSTEMS } from '../audit/catalog.ts';
import { inspectSystem } from '../audit/inspect.ts';
import { AUDIT_SNAPSHOT_KEY, AuditSandbox } from '../audit/sandbox.ts';
import { parseAuditAction } from '../audit/commands.ts';
import { CONTENT as BASE_CONTENT, EXPANSION_CONTENT, unitDefinition } from '../content/units.ts';
import type { SpeciesId } from '../content/units.ts';
import { BALLS, BUILDINGS, TECHS } from '../content/economy.ts';
import type { BallId, BuildingId, TechId } from '../content/economy.ts';
import type { Command, ProductionItem, StepResult } from '../core/model.ts';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const json = (value: unknown) => JSON.stringify(value, null, 2);
const statusLabels = { implemented: '已实现', partial: '部分实现', planned: '待实现' };
let sandbox = new AuditSandbox();
export const auditAdapter = { getState: () => sandbox.getState(), save: () => sandbox.save(), getLog: () => sandbox.getLog() };
let source = '默认测试局';
const systemFromUrl = () => AUDIT_SYSTEMS.find(system => system.id === new URLSearchParams(location.search).get('system')) ?? AUDIT_SYSTEMS[0];
let current = systemFromUrl();
const commandNames: Partial<Record<Command['action']['type'], string>> = {
  EndTurn: '结束回合 / 触发轮结算', Move: '移动单位', FoundCity: '开拓队建城', SetProductionQueue: '设置生产队列',
  AssignWork: '分配工作地块', SetResearch: '选择研究', BuyBall: '购买精灵球', Attack: '攻击单位或城市',
  Capture: '捕捉野生宝可梦', Evolve: '进化单位', DeclareWar: '宣战', MakePeace: '提出停战', RespondPeace: '回应停战',
};

function notice(text: string, error = false) {
  element('audit-notice').textContent = text;
  element('audit-notice').classList.toggle('error', error);
}
try {
  const snapshot = sessionStorage.getItem(AUDIT_SNAPSHOT_KEY);
  if (snapshot) { sandbox = new AuditSandbox(snapshot); source = '游戏当前对局的副本'; }
} catch (error) { notice(`无法载入对局副本，已使用默认测试局：${String(error)}`, true); }

function renderNav() {
  const query = element<HTMLInputElement>('system-search').value.trim().toLowerCase();
  const systems = AUDIT_SYSTEMS.filter(system => [system.name, system.summary, statusLabels[system.status], ...system.rules].join(' ').toLowerCase().includes(query));
  element('system-count').textContent = `${AUDIT_SYSTEMS.length} 个系统`;
  element('system-nav').innerHTML = systems.map(system => `<a href="?system=${encodeURIComponent(system.id)}" class="system-link${system.id === current.id ? ' selected' : ''}"${system.id === current.id ? ' aria-current="page"' : ''}><span>${escape(system.name)}</span><small class="nav-status ${system.status}">${statusLabels[system.status]}</small></a>`).join('') || '<p>没有匹配的系统</p>';
  element('system-nav').querySelectorAll<HTMLAnchorElement>('a').forEach(link => link.addEventListener('click', event => {
    event.preventDefault(); history.pushState(null, '', link.getAttribute('href')); current = systemFromUrl(); renderSystem();
  }));
}
function list(id: string, values: string[]) { element(id).innerHTML = values.map(value => `<li>${escape(value)}</li>`).join(''); }
function renderState() {
  const state = sandbox.getState();
  element('snapshot-source').textContent = source;
  element('snapshot-info').textContent = `种子 ${state.setup.seed} · 第 ${state.round} 轮 · 当前文明 ${state.activePlayerId + 1} · 命令 ${state.commandSeq}${state.outcome ? ' · 已结束' : ''}`;
  const inspected = inspectSystem(current.id, state);
  element('system-metrics').innerHTML = inspected.metrics.map(metric => `<div><dt>${escape(metric.label)}</dt><dd>${escape(metric.value)}</dd></div>`).join('');
  element('system-data').textContent = json(inspected.data);
  element('debug-trace').textContent = json(sandbox.trace);
  element('trace-count').textContent = String(sandbox.trace.length);
  element<HTMLButtonElement>('sandbox-undo').disabled = !sandbox.canUndo;
  for (const id of ['execute-command', 'preview-command', 'execute-json', 'ai-step', 'advance-turn']) element<HTMLButtonElement>(id).disabled = state.outcome !== null;
}
function renderSystem() {
  renderNav();
  element('system-number').textContent = `SYSTEM ${String(AUDIT_SYSTEMS.indexOf(current) + 1).padStart(2, '0')} / ${current.id.toUpperCase()}`;
  element('system-title').textContent = current.name;
  element('system-status').textContent = statusLabels[current.status];
  element('system-status').className = `status ${current.status}`;
  element('system-summary').textContent = current.summary;
  list('system-rules', current.rules); list('system-checks', current.checks); list('system-sources', current.sources);
  const planned = current.status === 'planned';
  element('debug-controls').hidden = planned;
  element('debug-guidance').textContent = planned ? '此系统尚未接入规则引擎。当前仅提供需求和实施缺口，不提供模拟生效的调试操作。'
    : '命令使用正式规则校验。先检查条件，再执行；执行结果只保存在本页副本中。AI 决策一步也可以用于当前人类文明的代理试验。';
  const actionTypes: Command['action']['type'][] = current.actionTypes.length ? current.actionTypes : ['EndTurn'];
  element<HTMLSelectElement>('debug-command').innerHTML = actionTypes.map(type => `<option value="${type}">${commandNames[type] ?? type}</option>`).join('');
  element('debug-result').textContent = '';
  renderState(); renderFields();
  document.title = `${current.name} · 系统审计台`;
}

function options(items: { id: string | number; label: string }[]) {
  return items.map(item => `<option value="${escape(item.id)}">${escape(item.label)}</option>`).join('');
}
function select(name: string, label: string, items: { id: string | number; label: string }[]) {
  return `<label>${label}<select name="${name}">${options(items)}</select></label>`;
}
function input(name: string, label: string, value: string | number = '', numeric = true) {
  return `<label>${label}<input name="${name}" type="${numeric ? 'number' : 'text'}" value="${escape(value)}"${numeric ? ' step="1"' : ''} /></label>`;
}
function renderFields() {
  if (current.status === 'planned') return;
  const state = sandbox.getState(), type = element<HTMLSelectElement>('debug-command').value;
  const CONTENT = state.expansion ? EXPANSION_CONTENT : BASE_CONTENT;
  const units = Object.values(state.units).filter(unit => unit.ownerId === state.activePlayerId && unit.location === 'map')
    .map(unit => ({ id: unit.id, label: `#${unit.id} ${unitDefinition(unit, CONTENT).name} · HP ${unit.hp} · 行动 ${unit.actionLeft}` }));
  const cities = Object.values(state.cities).filter(city => city.ownerId === state.activePlayerId).map(city => ({ id: city.id, label: `城市 #${city.id} · 人口 ${city.population}` }));
  const others = Object.values(state.players).filter(player => player.id !== state.activePlayerId && !player.eliminated).map(player => ({ id: player.id, label: `文明 ${player.id + 1}` }));
  const species = Object.entries(CONTENT.species).map(([id, def]) => ({ id, label: def.name }));
  let fields = '';
  if (expansionActionType(type)) {
    for (const [key, rule] of Object.entries(EXPANSION_ACTION_FIELDS[type])) {
      fields += Array.isArray(rule) ? select(key, key, rule.map(id => ({ id, label: id })))
        : rule === 'boolean' ? select(key, key, [{ id: 'true', label: '接受' }, { id: 'false', label: '拒绝' }])
        : rule === 'id' ? input(key, key, key === 'cityId' ? cities[0]?.id ?? 0 : key === 'unitId' ? units[0]?.id ?? 0 : 0)
        : input(key, rule === 'ids' ? `${key}（逗号分隔）` : key, '', false);
    }
  }
  if (['Move', 'FoundCity', 'Attack', 'Capture', 'Evolve'].includes(type)) fields += select('unitId', '己方单位', units);
  if (['SetProductionQueue', 'AssignWork', 'BuyBall'].includes(type)) fields += select('cityId', '己方城市', cities);
  if (type === 'Move') fields += input('q', '目标 q', 0) + input('r', '目标 r', 0);
  if (type === 'SetResearch') fields += select('techId', '课题', Object.entries(TECHS).map(([id, def]) => ({ id, label: `${def.name} · ${def.cost} 科研` })));
  if (type === 'BuyBall' || type === 'Capture') fields += select('ballId', '球种', Object.entries(BALLS).map(([id, def]) => ({ id, label: def.name })));
  if (type === 'BuyBall') fields += input('quantity', '数量', 1);
  if (type === 'Attack') fields += select('targetKind', '目标类型', [{ id: 'unit', label: '单位' }, { id: 'city', label: '城市' }]) + input('targetId', '目标 ID', 0);
  if (type === 'Capture') fields += input('targetId', '野生单位 ID', Object.values(state.units).find(unit => unit.ownerId === null)?.id ?? 0);
  if (type === 'Evolve') fields += select('speciesId', '进化为', species);
  if (type === 'AssignWork') fields += input('worked', '工作地块 ID（逗号分隔）', '', false) + input('locked', '锁定地块 ID（逗号分隔）', '', false);
  if (type === 'SetProductionQueue') fields += select('production', '替换队列为一项', [
    { id: 'logistics:settler', label: '训练开拓队' },
    ...Object.entries(BUILDINGS).filter(([, def]) => def.cost !== null).map(([id, def]) => ({ id: `building:${id}`, label: `建造 ${def.name}` })),
    ...species.map(item => ({ id: `pokemon:${item.id}`, label: `训练 ${item.label}` })),
  ]);
  if (['DeclareWar', 'MakePeace', 'RespondPeace'].includes(type)) fields += select('targetPlayerId', '目标文明', others);
  if (type === 'RespondPeace') fields += select('accept', '回应', [{ id: 'true', label: '接受停战' }, { id: 'false', label: '拒绝停战' }]);
  element('command-fields').innerHTML = fields;
  if (type === 'SetProductionQueue') element('command-fields').insertAdjacentHTML('beforeend', '<p class="field-note">此操作将替换该城市的整个队列。多项、排序和取消可在高级 JSON 中设置 orders。</p>');
  updateJson();
}
function buildAction(): Command['action'] {
  const type = element<HTMLSelectElement>('debug-command').value as Command['action']['type'];
  const value = (name: string) => element('command-fields').querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)?.value ?? '';
  const number = (name: string) => { const raw = value(name); const number = Number(raw); if (!raw.trim() || !Number.isSafeInteger(number)) throw new Error(`${name} 需要整数`); return number; };
  const ids = (name: string) => value(name).trim() ? value(name).split(/[,，\s]+/).map(raw => { if (!/^\d+$/.test(raw)) throw new Error('地块 ID 需要非负整数'); return Number(raw); }) : [];
  if (expansionActionType(type)) {
    const payload: Record<string, unknown> = { type };
    for (const [key, rule] of Object.entries(EXPANSION_ACTION_FIELDS[type])) {
      if (type === 'ActivatePhantom' && key !== 'phantomId' && !value(key)) continue;
      payload[key] = rule === 'id' ? number(key) : rule === 'ids' ? ids(key) : rule === 'boolean' ? value(key) === 'true' : value(key);
    }
    return parseAuditAction(payload);
  }
  switch (type) {
    case 'EndTurn': return { type };
    case 'Move': return { type, unitId: number('unitId'), to: { q: number('q'), r: number('r') } };
    case 'FoundCity': return { type, unitId: number('unitId') };
    case 'SetResearch': return { type, techId: value('techId') as TechId };
    case 'BuyBall': return { type, cityId: number('cityId'), ballId: value('ballId') as BallId, quantity: number('quantity') };
    case 'AssignWork': return { type, cityId: number('cityId'), workedTileIds: ids('worked'), lockedTileIds: ids('locked') };
    case 'SetProductionQueue': {
      const [kind, defId] = value('production').split(':');
      const item: ProductionItem = kind === 'building' ? { kind, defId: defId as BuildingId } : kind === 'pokemon' ? { kind, defId: defId as SpeciesId } : { kind: 'logistics', defId: 'settler' };
      return { type, cityId: number('cityId'), orders: [{ item }] };
    }
    case 'Attack': return { type, unitId: number('unitId'), target: { kind: value('targetKind') as 'unit' | 'city', id: number('targetId') } };
    case 'Capture': return { type, unitId: number('unitId'), targetUnitId: number('targetId'), ballId: value('ballId') as BallId };
    case 'Evolve': return { type, unitId: number('unitId'), intoSpeciesId: value('speciesId') as SpeciesId };
    case 'DeclareWar': case 'MakePeace': return { type, targetPlayerId: number('targetPlayerId') };
    case 'RespondPeace': return { type, targetPlayerId: number('targetPlayerId'), accept: value('accept') === 'true' };
    default: throw new Error('请选择系统支持的操作');
  }
}
function updateJson() {
  try { element<HTMLTextAreaElement>('command-json').value = json(buildAction()); }
  catch { element<HTMLTextAreaElement>('command-json').value = ''; }
}
function showResult(result: StepResult, preview = false) {
  renderState();
  element('debug-result').textContent = result.ok
    ? `${preview ? '条件通过（未执行）' : '已在副本执行'} · ${result.events.map(event => event.payload.type).join(' → ') || '无事件'}`
    : `${preview ? '条件未通过' : '引擎拒绝'}：${result.reason}（状态未改变）`;
  element('debug-result').classList.toggle('error', !result.ok);
  if (!preview) renderFields();
}
function attempt(action: () => void) { notice(''); try { action(); } catch (error) { notice(`操作失败：${error instanceof Error ? error.message : String(error)}`, true); } }
function download(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
element('system-search').addEventListener('input', renderNav);
window.addEventListener('popstate', () => { current = systemFromUrl(); renderSystem(); });
element('debug-command').addEventListener('change', renderFields);
element('command-fields').addEventListener('input', updateJson);
element('preview-command').addEventListener('click', () => attempt(() => showResult(sandbox.execute(buildAction(), true), true)));
element('execute-command').addEventListener('click', () => attempt(() => showResult(sandbox.execute(buildAction()))));
element('execute-json').addEventListener('click', () => attempt(() => {
  const action = parseAuditAction(JSON.parse(element<HTMLTextAreaElement>('command-json').value));
  showResult(sandbox.execute(action));
}));
element('ai-step').addEventListener('click', () => attempt(() => showResult(sandbox.aiStep())));
element('advance-turn').addEventListener('click', () => attempt(() => showResult(sandbox.execute({ type: 'EndTurn' }))));
element('sandbox-undo').addEventListener('click', () => { sandbox.undo(); renderState(); renderFields(); element('debug-result').textContent = '已撤销上一步操作。'; });
element('sandbox-reset').addEventListener('click', () => { sandbox.reset(); renderState(); renderFields(); element('debug-result').textContent = '已恢复导入时的副本。'; });
element('export-sandbox').addEventListener('click', () => download(sandbox.save(), 'pokemon-audit-sandbox.json'));
element('export-audit').addEventListener('click', () => download(json({ format: 'pokemon-system-audit-v1', system: current, source,
  inspection: inspectSystem(current.id, sandbox.getState()), trace: sandbox.trace, save: JSON.parse(sandbox.save()) }), `audit-${current.id}.json`));
element('audit-import').addEventListener('change', async () => {
  const input = element<HTMLInputElement>('audit-import');
  const file = input.files?.[0]; if (!file) return;
  try { const imported = new AuditSandbox(await file.text()); sandbox = imported; source = `导入：${file.name}`; renderSystem(); notice('存档已载入独立副本。'); }
  catch (error) { notice(`导入失败，原副本保留：${String(error)}`, true); }
  input.value = '';
});
renderSystem();
