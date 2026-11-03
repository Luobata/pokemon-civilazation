import { ERA_ABILITIES, ERA_ABILITY_RULES, WEATHERS, WEATHER_IDS } from '../content/era-abilities.ts';
import type { WeatherId } from '../content/era-abilities.ts';
import { ESSENCE_IDS, ESSENCES, ESSENCE_RULES } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { leaderEffects } from '../content/leaders.ts';
import { ballPrice, viewPolicyEffects } from '../core/policies.ts';
import { improvementYield } from '../core/improvements.ts';
import { IMPROVEMENTS } from '../content/improvements.ts';
import { trainableSpeciesIds } from '../core/role-tactics.ts';
import { CONTENT as BASE_CONTENT, EXPANSION_CONTENT } from '../content/units.ts';
import type { BallId, BuildingId } from '../content/economy.ts';
import { growthThreshold, maxCityHp, productionCost } from '../core/city.ts';
import type { Command, PlayerView, ProductionItem, ProductionOrder } from '../core/model.ts';
import { BIOME_DISPLAY } from './canvas.ts';
import { buildingArtPath } from './building-art.ts';
import { pokemonSpritePath } from './sprites.ts';

let rendered = '';
let productionKind: ProductionItem['kind'] = 'building';
let previousCity: number | null = null;
let selectedBuilding: BuildingId | null = null;
type CitySection = 'production' | 'citizens' | 'supplies' | 'research';
let citySection: CitySection = 'production';
const productionLabels = { building: '建造建筑', pokemon: '训练宝可梦', logistics: '训练开拓队' } as const;
const buildingActions: Record<BuildingId, { label: string; section: CitySection; kind?: ProductionItem['kind'] }> = {
  headquarters: { label: '训练开拓队', section: 'production', kind: 'logistics' },
  trainingGround: { label: '训练宝可梦', section: 'production', kind: 'pokemon' },
  workshop: { label: '建造建筑', section: 'production', kind: 'building' },
  pasture: { label: '分配工作地块', section: 'citizens' },
  meetingHall: { label: '采购精灵球', section: 'supplies' },
  observatory: { label: '选择研究课题', section: 'research' },
};
function buildingEffect(id: BuildingId): string {
  if (id === 'headquarters') return '文明的联盟总部。失守后文明会被淘汰。';
  const definition = BASE_CONTENT.buildings[id];
  const labels = { food: '食物', production: '生产', gold: '金币', research: '科研' } as const;
  const yields = Object.entries(definition.yields).filter(([, amount]) => amount > 0)
    .map(([key, amount]) => `每轮${labels[key as keyof typeof labels]} +${amount}`);
  if (definition.trainedXp) yields.push(`新训练宝可梦经验 +${definition.trainedXp}`);
  return [...yields, `城市最大 HP +${BASE_CONTENT.balance.city.buildingHp}`].join('；');
}
export function renderEconomyPanel(view: PlayerView, selectedCity: number | null,
  issue: (action: Command['action']) => void, disabled = false): void {
  const CONTENT = view.expansion ? EXPANSION_CONTENT : BASE_CONTENT;
  if (selectedCity !== previousCity) { productionKind = 'building'; citySection = 'production'; selectedBuilding = null; previousCity = selectedCity; }
  const signature = JSON.stringify([view.economy, view.map.tiles, view.commandSeq, selectedCity, disabled, productionKind, selectedBuilding, citySection]);
  if (signature === rendered) return;
  rendered = signature;
  const root = document.querySelector<HTMLElement>('#economy')!;
  const { player, cities } = view.economy;
  const policy = viewPolicyEffects(view);
  const city = cities.find(city => city.id === selectedCity);
  root.hidden = !city;
  if (!city) { root.innerHTML = ''; return; }
  const itemName = (item: ProductionItem) => item.kind === 'building' ? CONTENT.buildings[item.defId].name : CONTENT.units[item.defId].name;
  root.innerHTML = `<div class="economy-head"><p class="eyebrow">当前城市 · 建设与训练</p><h2 class="economy-title">城市 ${city.id}<span class="civ-badge">文明 ${view.playerId + 1}</span></h2>
    <p id="resources"><span>金币 <strong>${player.gold}</strong></span><span>精灵球 <strong>${player.ballInventory.pokeBall}</strong></span><span>超级球 <strong>${player.ballInventory.greatBall}</strong></span><span>储备科研 <strong>${player.research.reserve}</strong></span></p></div>
    <div id="city-panel"></div>`;
  const allOptions: ProductionItem[] = [
    ...(Object.keys(CONTENT.buildings) as BuildingId[]).filter(id => {
      const def = CONTENT.buildings[id];
      return def.cost !== null && !city.buildingIds.includes(id) && !city.queue.some(order => order.item.kind === 'building' && order.item.defId === id)
        && (!def.requiredTech || player.research.unlockedIds.includes(def.requiredTech));
    }).map(defId => ({ kind: 'building' as const, defId })),
    ...trainableSpeciesIds(player, view.gameplayVersion).map(defId => ({ kind: 'pokemon' as const, defId })),
    { kind: 'logistics', defId: 'settler' },
  ];
  const options = allOptions.filter(item => item.kind === productionKind);
  const remaining = Math.max(0, growthThreshold(city) - city.food), net = city.yields.food - 2 * city.population;
  const tileIds = [...new Set([...city.availableTileIds, ...city.workedTileIds])].sort((a, b) => a - b);
  const recovering = view.recoveringUnits.filter(unit => unit.cityId === city.id);
  const essences = view.expansion?.essences;
  const cityEssence = essences?.byCity[city.id];
  const gym = essences?.gyms.find(item => item.cityId === city.id)?.essence;
  const bondInfo = view.expansion?.bonds?.[city.id];
  const isHq = city.id === player.headquartersCityId;
  const bondMarkup = bondInfo && isHq ? `<section id="city-bond" class="city-bond"><p class="section-label">城市羁绊 · 联盟总部始终稳定</p></section>` : bondInfo ? `<section id="city-bond" class="city-bond ${bondInfo.bond < 30 ? 'danger' : bondInfo.pressure.total < 0 ? 'warn' : ''}"><p class="section-label">城市羁绊 ${bondInfo.bond}/100 · 每轮 ${bondInfo.pressure.total >= 0 ? '+' : ''}${bondInfo.pressure.total}</p><div class="bond-bar" aria-hidden="true"><span style="width:${bondInfo.bond}%"></span></div><p class="unit-note">${bondInfo.pressure.parts.map(part => `${part.label} ${part.value >= 0 ? '+' : ''}${part.value}`).join(' · ')}${bondInfo.pressure.total < 0 ? '。降到 0 时城市会脱离成为中立营地；驻军、宝可梦中心和属性道馆可稳住羁绊。' : ''}</p></section>` : '';
  const era = view.expansion?.eraAbilities;
  const weatherMarkup = era?.unlocked.includes('weather') && essences ? `<div class="gym-build"><label>召唤天气（城市周围 ${ERA_ABILITY_RULES.weatherRadius} 格，${ERA_ABILITY_RULES.weatherRounds} 轮）<select id="weather-kind">${WEATHER_IDS.some(id => essences.stock[WEATHERS[id].essence] >= ERA_ABILITY_RULES.weatherCost) ? '' : `<option value="" selected disabled>精华不足（需 ${ERA_ABILITY_RULES.weatherCost}）</option>`}${WEATHER_IDS.map(id => `<option value="${id}" ${essences.stock[WEATHERS[id].essence] < ERA_ABILITY_RULES.weatherCost ? 'disabled' : ''}>${WEATHERS[id].name} · ${ERA_ABILITY_RULES.weatherCost} ${ESSENCES[WEATHERS[id].essence].name}</option>`).join('')}</select></label><button id="summon-weather" ${disabled || view.round < era.own.weatherReadyAtRound || !WEATHER_IDS.some(id => essences.stock[WEATHERS[id].essence] >= ERA_ABILITY_RULES.weatherCost) ? 'disabled' : ''}>${view.round < era.own.weatherReadyAtRound ? `冷却至第 ${era.own.weatherReadyAtRound} 轮` : '召唤'}</button></div><p class="unit-note">${ERA_ABILITIES.weather.description}</p>` : '';
  const essenceMarkup = essences && cityEssence ? `<section id="city-essences" class="city-essences" aria-label="属性精华"><p class="section-label">属性精华 · 每轮</p><div class="essence-row">${ESSENCE_IDS.filter(id => cityEssence[id]).map(id => `<span class="essence-chip" style="--essence:${ESSENCES[id].color}"><b>${ESSENCES[id].mark}</b>+${cityEssence[id]}</span>`).join('') || '<span class="unit-note">暂无</span>'}</div>
      ${gym ? `<p class="gym-status">${ESSENCES[gym].name}道馆：${ESSENCES[gym].types.map(type => TYPE_NAMES[type]).join('、')}系训练消耗精华时进度 +${ESSENCE_RULES.gymTrainingBoost}，出场经验 +${ESSENCE_RULES.gymTrainedXp}，每轮 +${ESSENCE_RULES.gymEssenceYield} ${ESSENCES[gym].name}。</p>`
        : `<div class="gym-build"><label>建造属性道馆<select id="gym-essence">${ESSENCE_IDS.some(id => essences.stock[id] >= ESSENCE_RULES.gymEssenceCost) ? '' : `<option value="" selected disabled>精华不足（需任一属性 ${ESSENCE_RULES.gymEssenceCost}）</option>`}${ESSENCE_IDS.map(id => `<option value="${id}" ${essences.stock[id] < ESSENCE_RULES.gymEssenceCost ? 'disabled' : ''}>${ESSENCES[id].name}道馆（${ESSENCES[id].types.map(type => TYPE_NAMES[type]).join('/')}）· 库存 ${essences.stock[id]}</option>`).join('')}</select></label><button id="build-gym" ${disabled || player.gold < ESSENCE_RULES.gymGoldCost || !ESSENCE_IDS.some(id => essences.stock[id] >= ESSENCE_RULES.gymEssenceCost) ? 'disabled' : ''}>建造 · ${ESSENCE_RULES.gymEssenceCost} 精华 + ${ESSENCE_RULES.gymGoldCost} 金</button></div>`}
      <p class="unit-note">训练宝可梦时，若有对应精华，每轮自动消耗 ${ESSENCE_RULES.trainingSpend} 点加速 +${ESSENCE_RULES.trainingBoost}。</p>${weatherMarkup}</section>` : '';
  root.querySelector('#city-panel')!.innerHTML = `<div class="city-content">
    <p id="city-summary">城市 ${city.id} · 人口 ${city.population} · HP ${city.hp}/${maxCityHp(city)} · 观测者 ${city.population - city.workedTileIds.length}</p>
    <div class="yield-grid" aria-label="城市产出"><div class="yield-item"><small>食物</small><strong>${city.yields.food}</strong></div><div class="yield-item"><small>生产</small><strong>${city.yields.production}</strong></div><div class="yield-item"><small>金币</small><strong>${city.yields.gold}</strong></div><div class="yield-item"><small>科研</small><strong>${city.yields.research}</strong></div></div>
    ${bondMarkup}
    <p id="city-yields">产出：食物 ${city.yields.food} / 生产 ${city.yields.production} / 金币 ${city.yields.gold} / 科研 ${city.yields.research}</p>
    ${essenceMarkup}
    <p id="city-growth"><strong>食物消耗 ${city.population * 2} → 盈余 ${net >= 0 ? '+' : ''}${net}</strong><br>库存 ${city.food}/${growthThreshold(city)} · ${net > 0 ? Math.max(1, Math.ceil(remaining / net)) + ' 轮后人口 +1' : '暂无增长'}</p>
    <div class="city-buildings"><p class="section-label">城市建筑 · 点击进入</p><div class="building-list"><button id="city-overview" aria-pressed="${selectedBuilding === null}">城市中心</button>${city.buildingIds.map(id => `<button class="building-entry" data-building="${id}" aria-pressed="${id === selectedBuilding}"><img class="building-art building-entry-art" src="${buildingArtPath(id)}" width="48" height="40" alt="" aria-hidden="true"><span>${CONTENT.buildings[id].name}</span></button>`).join('')}</div>${selectedBuilding ? `<div class="building-context"><div class="building-detail-head"><img class="building-art" src="${buildingArtPath(selectedBuilding)}" width="72" height="60" alt="${CONTENT.buildings[selectedBuilding].name}像素插画"><strong>${CONTENT.buildings[selectedBuilding].name}</strong></div><p id="building-detail">${buildingEffect(selectedBuilding)}</p><button id="building-action">${buildingActions[selectedBuilding].label}</button></div>` : ''}</div>
    ${recovering.length ? `<section id="recovering-units" aria-label="休养单位"><p class="section-label">休养单位 ${recovering.length}</p><ul>${recovering.map(unit => `<li>${CONTENT.units[unit.kind === 'pokemon' ? unit.speciesId : unit.role].name} · HP ${unit.hp} · 剩余 ${unit.roundsLeft} 轮</li>`).join('')}</ul></section>` : ''}
    <div class="city-navigation" role="group" aria-label="城市管理">${([['production', '生产'], ['citizens', '人口与地块'], ['supplies', '物资采购'], ['research', '研究']] as const).map(([section, label]) => `<button data-city-section="${section}" aria-pressed="${citySection === section}">${label}</button>`).join('')}</div>
    ${citySection === 'research' ? '<p class="production-help">这座城市的科研汇入文明研究。在下方「文明研究」面板选择课题，所有城市共同推进。</p>' : ''}
    <div class="city-columns"><section class="work-management" ${citySection !== 'citizens' ? 'hidden' : ''}><p class="section-label">工作地块 ${city.workedTileIds.length}/${city.population} · 取消工作可改为观测者，提供科研。</p>
      <div class="work-list"><table><thead><tr><th>地块</th><th>食/产/金/研</th><th>工作</th><th>锁定</th></tr></thead><tbody>${tileIds.map(id => {
        const biome = view.map.tiles[id], worked = city.workedTileIds.includes(id), locked = city.lockedTileIds.includes(id);
        const improvement = view.expansion?.improvements?.tiles.find(tile => tile.tileIndex === id);
        const bonus = improvement ? Object.values(improvementYield(improvement.kind, player)) : [0, 0, 0, 0];
        const yieldText = biome ? Object.values(CONTENT.biomes[biome]).map((value, index) => value + bonus[index] + (index === 3 && (biome === 'snow' || biome === 'volcano') && player.research.unlockedIds.includes('meteorology') ? 1 : 0)).join('/') : '—';
        return `<tr><td>${id} ${biome ? BIOME_DISPLAY[biome].label : '未知地形'}${improvement ? ` · ${IMPROVEMENTS[improvement.kind].name}` : ''}</td><td>${yieldText}</td><td><input aria-label="工作地块 ${id}" type="checkbox" data-work="${id}" ${worked ? 'checked' : ''} ${!worked && city.workedTileIds.length >= city.population ? 'disabled' : ''}></td><td><input aria-label="锁定地块 ${id}" type="checkbox" data-lock="${id}" ${locked ? 'checked' : ''} ${worked ? '' : 'disabled'}></td></tr>`;
      }).join('')}</tbody></table></div></section>
      <section class="production-section" ${citySection !== 'production' ? 'hidden' : ''}><p class="section-label">${selectedBuilding ? CONTENT.buildings[selectedBuilding].name : '城市生产'} · ${city.yields.production} 生产 / 轮${view.expansion?.contests?.own.building[city.id] !== undefined ? `（其中 ${Math.max(1, Math.floor(city.yields.production / 2))} 投入华丽大赛馆）` : ''}</p>
      <div class="production-tabs" role="group" aria-label="生产类别">${(Object.keys(productionLabels) as ProductionItem['kind'][]).map(kind => `<button data-production-kind="${kind}" aria-pressed="${kind === productionKind}" ${disabled ? 'disabled' : ''}>${productionLabels[kind]}</button>`).join('')}</div>
      <p class="production-help">${productionKind === 'logistics' ? '训练完成后，开拓队出现在城市周围。选中它，前往新的土地建城。' : productionKind === 'pokemon' ? '训练已经登记的宝可梦。完成后在城市周围出场。' : '建筑留在这座城市内，建成后自动提供产出或训练效果。'}</p>
      <div class="production-adder"><select id="production-item" aria-label="生产项目">${options.map((item, i) => `<option value="${i}">${itemName(item)} (${productionCost(item, CONTENT, policy.trainingDiscountPercent, leaderEffects(player.leaderId).settlerDiscountPercent)})</option>`).join('')}</select>
      <button id="add-production" ${disabled || city.queue.length >= 5 || !options.length ? 'disabled' : ''}>加入队列</button></div>
      <div id="production-preview"></div>
      <p class="section-label queue-heading">生产队列 ${city.queue.length}/5 · 逐项完成</p><ol id="production-queue">${city.queue.map((order, i) => `<li><div class="queue-name"><span>${itemName(order.item)}</span><span>${order.progress}/${productionCost(order.item, CONTENT, policy.trainingDiscountPercent, leaderEffects(player.leaderId).settlerDiscountPercent)}</span></div><div class="queue-progress"><span style="width:${Math.min(100, order.progress * 100 / productionCost(order.item, CONTENT, policy.trainingDiscountPercent, leaderEffects(player.leaderId).settlerDiscountPercent))}%"></span></div><div class="queue-actions"><button data-up="${i}" ${i ? '' : 'disabled'}>上移</button><button data-down="${i}" ${i < city.queue.length - 1 ? '' : 'disabled'}>下移</button><button data-remove="${i}">取消</button></div></li>`).join('')}</ol>
      ${city.queue.length ? '' : '<p class="empty-note">队列为空。选择一个项目开始生产。</p>'}
      <p id="pending-deployments">待出场 ${city.pendingDeployments.length}：${city.pendingDeployments.map(p => itemName(p.item)).join('、') || '无'}</p></section></div>
    <section ${citySection !== 'supplies' ? 'hidden' : ''}><div class="ball-shop"><label>球种<select id="ball-kind"><option value="pokeBall">精灵球 ${ballPrice(CONTENT.balls.pokeBall.goldCost, policy.ballDiscount)}金</option><option value="greatBall">超级球 ${ballPrice(CONTENT.balls.greatBall.goldCost, policy.ballDiscount)}金</option></select></label>
    <label>数量<input id="ball-quantity" type="number" min="1" value="1"></label><button id="buy-ball">购买球</button></div><p id="shop-requirement" class="production-help"></p></section></div>`;
  const rerender = () => renderEconomyPanel(view, selectedCity, issue, disabled);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-production-kind]')) button.addEventListener('click', () => {
    productionKind = button.dataset.productionKind as ProductionItem['kind']; selectedBuilding = null; rerender();
  });
  root.querySelector('#city-overview')!.addEventListener('click', () => { selectedBuilding = null; citySection = 'production'; rerender(); });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-city-section]')) button.addEventListener('click', () => {
    citySection = button.dataset.citySection as CitySection; selectedBuilding = null; rerender();
    if (citySection === 'research') document.querySelector<HTMLElement>('#research-topic')?.focus();
  });
  const enterBuilding = (id: BuildingId) => {
    selectedBuilding = id;
    const action = buildingActions[id];
    citySection = action.section;
    if (action.kind) productionKind = action.kind;
    rerender();
    if (id === 'observatory') document.querySelector<HTMLElement>('#research-topic')?.focus();
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-building]')) button.addEventListener('click', () => {
    enterBuilding(button.dataset.building as BuildingId);
  });
  root.querySelector('#building-action')?.addEventListener('click', () => { if (selectedBuilding) enterBuilding(selectedBuilding); });
  const gymSelect = root.querySelector<HTMLSelectElement>('#gym-essence');
  if (gymSelect && essences) { const first = ESSENCE_IDS.find(id => essences.stock[id] >= ESSENCE_RULES.gymEssenceCost); if (first) gymSelect.value = first; }
  const weatherSelect = root.querySelector<HTMLSelectElement>('#weather-kind');
  if (weatherSelect && essences) { const first = WEATHER_IDS.find(id => essences.stock[WEATHERS[id].essence] >= ERA_ABILITY_RULES.weatherCost); if (first) weatherSelect.value = first; }
  root.querySelector('#summon-weather')?.addEventListener('click', () => { if (weatherSelect) issue({ type: 'SummonWeather', cityId: city.id, weather: weatherSelect.value as WeatherId }); });
  root.querySelector('#build-gym')?.addEventListener('click', () => { if (gymSelect) issue({ type: 'BuildGym', cityId: city.id, essence: gymSelect.value as EssenceId }); });
  const showProduction = () => {
    const item = options[Number(root.querySelector<HTMLSelectElement>('#production-item')!.value)];
    root.querySelector('#production-preview')!.innerHTML = item
      ? `${item.kind === 'building' ? `<img class="building-art production-building-art" src="${buildingArtPath(item.defId)}" width="72" height="60" alt="${itemName(item)}建筑预览">` : item.kind === 'pokemon' ? `<img src="${pokemonSpritePath(item.defId)}" width="48" height="48" alt="${itemName(item)}">` : ''}<p>${item.kind === 'building' ? buildingEffect(item.defId) : item.kind === 'logistics' ? '建立新城市 · 移动 2 · 无维护费' : `攻击 ${CONTENT.species[item.defId].attack} · 防御 ${CONTENT.species[item.defId].defense} · 维护 ${CONTENT.species[item.defId].upkeep} 金币 / 轮`}<br>需要 ${productionCost(item, CONTENT, policy.trainingDiscountPercent, leaderEffects(player.leaderId).settlerDiscountPercent)} 生产${city.yields.production > 0 ? ` · 空队列约 ${Math.ceil(productionCost(item, CONTENT, policy.trainingDiscountPercent, leaderEffects(player.leaderId).settlerDiscountPercent) / city.yields.production)} 轮` : ''}</p>`
      : '<p>当前没有可建项目。研究新科技可解锁更多建筑。</p>';
  };
  root.querySelector('#production-item')!.addEventListener('change', showProduction);
  showProduction();
  const updateShop = () => {
    const ballId = root.querySelector<HTMLSelectElement>('#ball-kind')!.value as BallId;
    const quantity = Number(root.querySelector<HTMLInputElement>('#ball-quantity')!.value);
    const ball = CONTENT.balls[ballId];
    const reason = !player.research.unlockedIds.includes(ball.requiredTech) ? `需要先研究「${CONTENT.techs[ball.requiredTech].name}」。`
      : !Number.isSafeInteger(quantity) || quantity < 1 ? '请输入正整数数量。'
      : player.gold < ballPrice(ball.goldCost, policy.ballDiscount) * quantity ? `金币不足，需要 ${ballPrice(ball.goldCost, policy.ballDiscount) * quantity} 金币。` : `采购费用 ${ballPrice(ball.goldCost, policy.ballDiscount) * quantity} 金币。`;
    root.querySelector('#shop-requirement')!.textContent = reason;
    root.querySelector<HTMLButtonElement>('#buy-ball')!.disabled = disabled || !player.research.unlockedIds.includes(ball.requiredTech)
      || !Number.isSafeInteger(quantity) || quantity < 1 || player.gold < ballPrice(ball.goldCost, policy.ballDiscount) * quantity;
  };
  root.querySelector('#ball-kind')!.addEventListener('change', updateShop);
  root.querySelector('#ball-quantity')!.addEventListener('input', updateShop);
  updateShop();
  const setQueue = (orders: ProductionOrder[]) => issue({ type: 'SetProductionQueue', cityId: city.id,
    orders: orders.map(order => ({ orderId: order.id, item: order.item })) });
  root.querySelector('#add-production')!.addEventListener('click', () => issue({ type: 'SetProductionQueue', cityId: city.id,
    orders: [...city.queue.map(order => ({ orderId: order.id, item: order.item })), { item: options[Number(root.querySelector<HTMLSelectElement>('#production-item')!.value)] }] }));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-up], [data-down], [data-remove]')) button.addEventListener('click', () => {
    const orders = [...city.queue];
    if (button.dataset.remove !== undefined) orders.splice(Number(button.dataset.remove), 1);
    else { const i = Number(button.dataset.up ?? button.dataset.down), j = i + (button.dataset.up === undefined ? 1 : -1); [orders[i], orders[j]] = [orders[j], orders[i]]; }
    setQueue(orders);
  });
  for (const input of root.querySelectorAll<HTMLInputElement>('[data-work], [data-lock]')) input.addEventListener('change', () => {
    const id = Number(input.dataset.work ?? input.dataset.lock);
    let workedTileIds = [...city.workedTileIds], lockedTileIds = [...city.lockedTileIds];
    if (input.dataset.work !== undefined) {
      workedTileIds = input.checked ? [...workedTileIds, id] : workedTileIds.filter(tile => tile !== id);
      lockedTileIds = lockedTileIds.filter(tile => workedTileIds.includes(tile));
    } else lockedTileIds = input.checked ? [...lockedTileIds, id] : lockedTileIds.filter(tile => tile !== id);
    issue({ type: 'AssignWork', cityId: city.id, workedTileIds, lockedTileIds });
  });
  root.querySelector('#buy-ball')!.addEventListener('click', () => issue({ type: 'BuyBall', cityId: city.id,
    ballId: root.querySelector<HTMLSelectElement>('#ball-kind')!.value as BallId,
    quantity: Number(root.querySelector<HTMLInputElement>('#ball-quantity')!.value) }));
}
