import { CONTENT } from '../content/units.ts';
import type { BallId, BuildingId, TechId } from '../content/economy.ts';
import { canResearch } from '../core/economy-commands.ts';
import { growthThreshold, maxCityHp, productionCost } from '../core/city.ts';
import type { Command, PlayerView, ProductionItem, ProductionOrder } from '../core/model.ts';
import { BIOME_DISPLAY } from './canvas.ts';

let rendered = '';
export function renderEconomyPanel(view: PlayerView, selectedCity: number | null, selectedUnit: number | null,
  issue: (action: Command['action']) => void, selectCity: (id: number) => void, disabled = false): void {
  const signature = JSON.stringify([view.economy, view.map.tiles, view.commandSeq, selectedCity, selectedUnit, disabled]);
  if (signature === rendered) return;
  rendered = signature;
  const root = document.querySelector<HTMLElement>('#economy')!;
  const { player, cities } = view.economy;
  const city = cities.find(city => city.id === selectedCity) ?? cities[0];
  const unit = view.units.find(unit => unit.id === selectedUnit && unit.ownerId === view.playerId);
  const itemName = (item: ProductionItem) => item.kind === 'building' ? CONTENT.buildings[item.defId].name : CONTENT.units[item.defId].name;
  const topics = (Object.keys(CONTENT.techs) as TechId[]).filter(id => canResearch(player, id));
  root.innerHTML = `<div class="economy-head"><p class="eyebrow">城市与经济</p><h2 class="economy-title">${city ? `城市 ${city.id}` : '暂无城市'}<span class="civ-badge">文明 ${view.playerId + 1}</span></h2>
    <p id="resources"><span>金币 <strong>${player.gold}</strong></span><span>精灵球 <strong>${player.ballInventory.pokeBall}</strong></span><span>超级球 <strong>${player.ballInventory.greatBall}</strong></span><span>储备科研 <strong>${player.research.reserve}</strong></span></p></div>
    <div class="economy-controls"><label>城市<select id="city-select">${cities.map(c => `<option value="${c.id}" ${c.id === city?.id ? 'selected' : ''}>城市 ${c.id} · 人口 ${c.population}</option>`).join('')}</select></label>
    <button id="found-city" ${unit?.kind === 'logistics' && unit.actionLeft ? '' : 'disabled'}>开拓队建城</button></div>
    <section class="research-box" aria-label="研究选择"><div class="research-controls"><label>研究课题<select id="research-topic"><option value="">选择课题</option>${topics.map(id => `<option value="${id}" ${id === player.research.techId ? 'selected' : ''}>T${CONTENT.techs[id].tier} ${CONTENT.techs[id].name} ${player.research.progressByTech[id]}/${CONTENT.techs[id].cost}</option>`).join('')}</select></label>
    <button id="set-research">选择研究</button></div><p id="research-status">当前：${player.research.techId ? CONTENT.techs[player.research.techId].name + ' ' + player.research.progressByTech[player.research.techId] + '/' + CONTENT.techs[player.research.techId].cost : '未选课题，科研进入储备'}<br>已完成：${player.research.unlockedIds.map(id => CONTENT.techs[id].name).join('、') || '无'}</p></section>
    <div id="city-panel"></div>`;
  root.querySelector('#found-city')!.addEventListener('click', () => { if (unit) issue({ type: 'FoundCity', unitId: unit.id }); });
  root.querySelector<HTMLSelectElement>('#city-select')!.addEventListener('change', event => selectCity(Number((event.target as HTMLSelectElement).value)));
  root.querySelector('#set-research')!.addEventListener('click', () => {
    const techId = root.querySelector<HTMLSelectElement>('#research-topic')!.value as TechId;
    if (techId) issue({ type: 'SetResearch', techId });
  });
  if (!city) return;
  const options: ProductionItem[] = [
    ...(Object.keys(CONTENT.buildings) as BuildingId[]).filter(id => {
      const def = CONTENT.buildings[id];
      return def.cost !== null && !city.buildingIds.includes(id) && !city.queue.some(order => order.item.kind === 'building' && order.item.defId === id)
        && (!def.requiredTech || player.research.unlockedIds.includes(def.requiredTech));
    }).map(defId => ({ kind: 'building' as const, defId })),
    ...player.registeredSpeciesIds.map(defId => ({ kind: 'pokemon' as const, defId })),
    { kind: 'logistics', defId: 'settler' },
  ];
  const remaining = Math.max(0, growthThreshold(city) - city.food), net = city.yields.food - 2 * city.population;
  const tileIds = [...new Set([...city.availableTileIds, ...city.workedTileIds])].sort((a, b) => a - b);
  root.querySelector('#city-panel')!.innerHTML = `<div class="city-content">
    <p id="city-summary">城市 ${city.id} · 人口 ${city.population} · HP ${city.hp}/${maxCityHp(city)} · 观测者 ${city.population - city.workedTileIds.length}</p>
    <div class="yield-grid" aria-label="城市产出"><div class="yield-item"><small>食物</small><strong>${city.yields.food}</strong></div><div class="yield-item"><small>生产</small><strong>${city.yields.production}</strong></div><div class="yield-item"><small>金币</small><strong>${city.yields.gold}</strong></div><div class="yield-item"><small>科研</small><strong>${city.yields.research}</strong></div></div>
    <p id="city-yields">产出：食物 ${city.yields.food} / 生产 ${city.yields.production} / 金币 ${city.yields.gold} / 科研 ${city.yields.research}</p>
    <p id="city-growth"><strong>食物消耗 ${city.population * 2} → 盈余 ${net >= 0 ? '+' : ''}${net}</strong><br>库存 ${city.food}/${growthThreshold(city)} · ${net > 0 ? Math.max(1, Math.ceil(remaining / net)) + ' 轮后人口 +1' : '暂无增长'}</p>
    <p class="city-buildings">建筑：${city.buildingIds.map(id => CONTENT.buildings[id].name).join('、') || '无'}</p>
    <div class="city-columns"><section><p class="section-label">工作地块 ${city.workedTileIds.length}/${city.population} · 取消工作可改为观测者</p>
      <div class="work-list"><table><thead><tr><th>地块</th><th>食/产/金/研</th><th>工作</th><th>锁定</th></tr></thead><tbody>${tileIds.map(id => {
        const biome = view.map.tiles[id], worked = city.workedTileIds.includes(id), locked = city.lockedTileIds.includes(id);
        const yieldText = biome ? Object.values(CONTENT.biomes[biome]).map((value, index) => value + (index === 3 && (biome === 'snow' || biome === 'volcano') && player.research.unlockedIds.includes('meteorology') ? 1 : 0)).join('/') : '—';
        return `<tr><td>${id} ${biome ? BIOME_DISPLAY[biome].label : '未知地形'}</td><td>${yieldText}</td><td><input aria-label="工作地块 ${id}" type="checkbox" data-work="${id}" ${worked ? 'checked' : ''} ${!worked && city.workedTileIds.length >= city.population ? 'disabled' : ''}></td><td><input aria-label="锁定地块 ${id}" type="checkbox" data-lock="${id}" ${locked ? 'checked' : ''} ${worked ? '' : 'disabled'}></td></tr>`;
      }).join('')}</tbody></table></div></section>
      <section><p class="section-label">建造队列 ${city.queue.length}/5</p><ol id="production-queue">${city.queue.map((order, i) => `<li><div class="queue-name"><span>${itemName(order.item)}</span><span>${order.progress}/${productionCost(order.item)}</span></div><div class="queue-progress"><span style="width:${Math.min(100, order.progress * 100 / productionCost(order.item))}%"></span></div><div class="queue-actions"><button data-up="${i}" ${i ? '' : 'disabled'}>上移</button><button data-down="${i}" ${i < city.queue.length - 1 ? '' : 'disabled'}>下移</button><button data-remove="${i}">取消</button></div></li>`).join('')}</ol>
      <div class="production-adder"><select id="production-item" aria-label="生产项目">${options.map((item, i) => `<option value="${i}">${itemName(item)} (${productionCost(item)})</option>`).join('')}</select>
      <button id="add-production" ${city.queue.length >= 5 ? 'disabled' : ''}>加入队列</button></div>
      <p id="pending-deployments">待出场 ${city.pendingDeployments.length}：${city.pendingDeployments.map(p => itemName(p.item)).join('、') || '无'}</p></section></div>
    <div class="ball-shop"><label>球种<select id="ball-kind"><option value="pokeBall">精灵球 20金</option><option value="greatBall">超级球 45金</option></select></label>
    <label>数量<input id="ball-quantity" type="number" min="1" value="1"></label><button id="buy-ball">购买球</button></div></div>`;
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
