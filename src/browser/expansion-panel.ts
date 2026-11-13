import { leaderUnitFor, stoneEvolutionsFor } from '../content/roster.ts';
import { FAITH_RULES, LEGENDS, LEGEND_IDS, TENETS, TENET_IDS } from '../content/faith-legends.ts';
import type { LegendId, TenetId } from '../content/faith-legends.ts';
import { CONTEST_RULES } from '../core/contests.ts';
import { victoryTargets } from '../content/opening.ts';
import { RARE_BERRIES, RARE_BERRY_IDS, RARE_BERRY_RULES } from '../content/rare-berries.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { LEADER_KITS } from '../core/leader-systems.ts';
import { hexDistance } from '../core/hex.ts';
import { unitDefinition, contentForView, techOf } from '../content/units.ts';
import { TREE_GATES } from '../content/tech-tree.ts';
import { treeGateOpen } from '../core/tech-tree.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';

/** Display name of a berry or evolution stone id (falls back to the id). */
/** Kit icon for a berry or stone id (the ids are the map icon names), or the generic resource icon. */
const resourceIcon = (id: string, size: number, label?: string) => (MAP_ICON_NAMES as readonly string[]).includes(id)
  ? uiIcon(id as UiIconName, { size, label }) : uiIcon('essence', { size, label });
const resourceName = (id: string): string => (WORLD_DEFINITIONS.berries as Record<string, { name: string }>)[id]?.name ?? (WORLD_DEFINITIONS.stones as Record<string, { name: string }>)[id]?.name ?? id;
import { parseAuditAction } from '../audit/commands.ts';
import { civHint } from './civ-hint.ts';
import { researchBookMarkup } from './research-card.ts';
import { artImage, statChip, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';
import { MAP_ICON_NAMES } from './map-icons.ts';
import { pokemonSpritePath } from './sprites.ts';
import { v24PanelCards } from './gym-panel.ts';
import { depthPanelCards } from './late-game-ui.ts';
import { dexCaptureCounts, isStarterRecord } from './dex-owned.ts';
import { regionalDexMarkup } from './regional-dex-panel.ts';
import { bracketMarkup, worldCards, worldCardsMarkup } from './world-cards.ts';
import '../world-ui.css';
import '../late-game.css';
import { installDataTips } from './ui-tip.ts';
import { openLineupPicker } from './lineup-picker.ts';
import type { PickerKind } from './lineup-picker.ts';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function renderExpansionPanel(view: PlayerView, selectedUnitId: number | null, selectedCityId: number | null,
  issue: (action: Command['action']) => void, disabled: boolean): void {
  const CONTENT = contentForView(view);
  const root = document.querySelector<HTMLElement>('#expansion-panel')!;
  installDataTips();
  if (!view.expansion) { root.innerHTML = '<p>此存档使用经典规则。新建对局可启用扩展系统。</p>'; return; }
  const opened = new Set([...root.querySelectorAll<HTMLDetailsElement>('details[open]')].map(element => element.dataset.system));
  const exp = view.expansion, player = view.economy.player;
  const own = view.units.filter(unit => unit.ownerId === player.id && unit.kind === 'pokemon');
  const unit = own.find(unit => unit.id === selectedUnitId) ?? own.find(unit => unit.actionLeft);
  const city = view.economy.cities.find(city => city.id === selectedCityId) ?? view.economy.cities[0];
  const actions: Command['action'][] = [];
  const button = (label: string, action: Command['action'], available = true, reason?: string) => {
    const id = actions.push(action) - 1;
    return `<button type="button" data-expansion-action="${id}"${disabled || !available ? ' disabled' : ''}${reason ? ` title="${escape(reason)}"` : ''}>${escape(label)}</button>`;
  };
  const card = (id: string, title: string, body: string) => `<details data-system="${id}"><summary>${title}</summary>${body}<p><a href="/audit.html?system=${id}" target="_blank" rel="noopener">规则与独立调试 ↗</a></p></details>`;
  // depth-v26 §6: the page opens on the next-action cards and the conference bracket; the system sections follow as 规则与详情.
  const championship = exp.civilization.championship;
  // Playtest 2026-11 B4: the titles needed come from the victory targets (v21+: by round limit), as the victory page shows.
  const titlesNeeded = (view.gameplayVersion ?? 0) >= 21 ? victoryTargets(view).championshipTitles : CIVILIZATION_CONTENT.championship.titlesNeededForVictory;
  let html = worldCardsMarkup(worldCards(view, CONTENT), button)
    + bracketMarkup(view, championship.history.at(-1), { own: championship.titlesByPlayer[player.id] ?? 0, need: titlesNeeded })
    + '<h2 class="rules-head">规则与详情</h2><p>地图标记：巢 · 暴走巢穴，霸 · 霸主，果 · 树果，石 · 矿脉，圣 / 碑 · 圣所与已取得石板。</p>';
  const leader = player.leaderId && LEADER_KITS[player.leaderId];
  if (leader) html += card('leaders-active', '领袖能力与专属内容', `<p>${escape(leader.description)}${exp.leaders.readyAtRound > view.round ? ` 下次可用：第 ${exp.leaders.readyAtRound} 轮。` : ''}</p>`
    + button(leader.active, { type: 'UseLeaderAbility' }, player.gold >= 20 && exp.leaders.readyAtRound <= view.round)
    + (city ? `<p>当前城市 #${city.id}：${escape(leader.building)}提供本城领袖专长产出 +2；专属部队拥有 +8 攻防和 +1 视野。</p>`
      + button(`建造${leader.building} · 90 金`, { type: 'BuildLeaderBuilding', cityId: city.id }, player.gold >= 90 && !exp.leaders.uniqueCityIds.includes(city.id))
      + button(`招募${unitDefinition({ kind: 'pokemon', speciesId: leaderUnitFor(CONTENT, player.leaderId!, leader.unit) }, CONTENT).name} · 100 金`, { type: 'RecruitLeaderUnit', cityId: city.id }, player.gold >= 100 && exp.leaders.recruited < 3 && player.research.unlockedIds.includes('training')) : ''));
  const world = exp.world, records = Object.values(world.player?.pokedex ?? {});
  if (CONTENT.regionalDex) html += card('s22-pokedex', '地区图鉴与探索胜利', `${regionalDexMarkup(view, CONTENT)}${researchBookMarkup(view, CONTENT)}`);
  else html += card('s22-pokedex', '图鉴与探索胜利', `<p class="world-stats">${statChip('pokedex', `${records.filter(record => record.observed && (record.battled || record.captured)).length}/${world.victory?.targetDocumentedSpecies ?? 18}`, '完整记录')}${statChip('class:scout', records.filter(record => record.observed).length, '观察')}${statChip('swords', records.filter(record => record.battled).length, '对战')}${statChip('pokeBall', dexCaptureCounts(view, records).caught, '捕捉')}${dexCaptureCounts(view, records).owned ? statChip('star', dexCaptureCounts(view, records).owned, '拥有（初始伙伴，非捕捉）') : ''}</p><p class="unit-note">已观察且战斗或捕捉的物种计入完整记录。</p><div class="dex-strip">${records.filter(record => record.observed).map(record => `<span class="dex-entry${record.battled || record.captured ? ' documented' : ''}">${artImage(pokemonSpritePath(record.speciesId), { size: 40, label: `${CONTENT.species[record.speciesId].name}${isStarterRecord(view, record) ? ' · 拥有（初始伙伴）' : record.captured ? ' · 已捕捉' : record.battled ? ' · 已对战' : ' · 已观察'}` })}${isStarterRecord(view, record) ? uiIcon('star', { size: 12, className: 'dex-mark' }) : record.captured ? uiIcon('pokeBall', { size: 12, className: 'dex-mark' }) : record.battled ? uiIcon('swords', { size: 12, className: 'dex-mark' }) : ''}</span>`).join('') || '<p>尚未观察</p>'}</div>${researchBookMarkup(view, CONTENT)}`);
  html += card('s18-nests', `暴走巢穴 ${civHint('nest')}`, '<p>靠近巢穴后派宝可梦清剿，消耗行动点；巢穴会周期性派出敌对野生单位。</p>'
    + world.nests.map(nest => `<p class="world-row">${uiIcon('nest', { size: 28 })}<span class="world-row-name">巢穴 #${nest.id} <small>(${nest.position.q},${nest.position.r})</small></span><span class="hp-bar" role="img" aria-label="HP ${nest.hp}/${nest.maxHp}" title="HP ${nest.hp}/${nest.maxHp}"><span style="width:${Math.round(nest.hp * 100 / Math.max(1, nest.maxHp))}%"></span></span>${statChip('heart', `${nest.hp}/${nest.maxHp}`, 'HP')}${statChip('turns', nest.nextSpawnRound, '下次刷新（轮）')}</p>`
      + (unit ? button(`以 #${unit.id} 清剿`, { type: 'ClearNest', unitId: unit.id, nestId: nest.id }, Boolean(unit.actionLeft) && hexDistance(unit.position, nest.position, view.map) <= (unit.kind === 'pokemon' ? CONTENT.species[unit.speciesId].range : 1)) : '')).join(''));
  html += card('s19-overlords', `霸主与羁绊 ${civHint('overlord')}`, '<p>附近城市可用 10 食物或 20 金币供奉，每轮一次。羁绊 15/40/75 解锁视野与本地产出。</p>'
    + world.overlords.map(site => `<p class="world-row">${artImage(pokemonSpritePath(site.speciesId), { size: 40 })}<span class="world-row-name">${escape(CONTENT.species[site.speciesId].name)} <small>#${site.id}</small></span><span class="bond-track" role="img" aria-label="羁绊 ${site.bond}（15/40/75 解锁）" title="羁绊 ${site.bond}（15/40/75 解锁）"><span style="width:${Math.min(100, site.bond)}%"></span>${[15, 40, 75].map(mark => `<i class="${site.bond >= mark ? 'met' : ''}" style="left:${mark}%"></i>`).join('')}</span>${statChip('heart', site.bond, '羁绊')}</p>`
      + (city ? button('供奉食物', { type: 'OfferToOverlord', overlordId: site.id, cityId: city.id, currency: 'food' }, site.lastOfferRound !== view.round && city.food >= 10 && hexDistance(city.position, site.position, view.map) <= WORLD_DEFINITIONS.overlords.reach)
        + button('供奉金币', { type: 'OfferToOverlord', overlordId: site.id, cityId: city.id, currency: 'gold' }, site.lastOfferRound !== view.round && player.gold >= 20 && hexDistance(city.position, site.position, view.map) <= WORLD_DEFINITIONS.overlords.reach) : '')).join(''));
  html += card('s20-berries', `树果、进化石与满意度 ${civHint('satisfaction')}`, `<p class="world-stats">${statChip('satisfaction', `${world.player?.satisfaction ?? 0}/100`, '满意度')}</p><p class="unit-note">移动到资源地块后采集；树果提供食物与满意度，石头存入库存。</p>`
    + world.resources.map(site => `<p class="world-row">${resourceIcon(site.definitionId, 24)}<span class="world-row-name">${escape(resourceName(site.definitionId))} <small>(${site.position.q},${site.position.r})</small></span>${statChip('check', site.remaining, '剩余')}</p>`
      + (unit ? button('采集', { type: 'HarvestResource', unitId: unit.id, tileIndex: site.tileIndex }, Boolean(unit.actionLeft) && site.remaining > 0 && hexDistance(unit.position, site.position, view.map) === 0) : '')).join('')
    + `<p class="world-stats">进化石：${Object.entries(world.player?.stoneInventory ?? {}).map(([id, count]) => `<span class="icon-stat" role="img" aria-label="${escape(resourceName(id))} ${count}" title="${escape(resourceName(id))} ${count}">${resourceIcon(id, 18)}<b aria-hidden="true">${count}</b></span>`).join('') || '无'}</p>`
    + (unit?.kind === 'pokemon' ? stoneEvolutionsFor(CONTENT).filter(path => path.fromSpeciesId === unit.speciesId).map(path => button(`进化成${CONTENT.species[path.intoSpeciesId].name} · ${resourceName(path.stoneId)}`, { type: 'UseEvolutionStone', unitId: unit.id, intoSpeciesId: path.intoSpeciesId, stoneId: path.stoneId }, Boolean(unit.actionLeft) && (world.player?.stoneInventory[path.stoneId] ?? 0) > 0 && unit.xp >= path.requiredXp)).join('') : ''));
  const rare = exp.rareBerries;
  if (rare) {
    const partners = exp.civilization.relations.filter(relation => relation.tradeSinceRound !== null && !relation.targetEliminated);
    html += card('s38-rare-berries', `稀有树果 ${rare.distinct}/${RARE_BERRY_IDS.length}${rare.festival ? ' · 丰收节' : ''} ${civHint('rareBerry')}`, `<p>城市耕作稀有树果地块即拥有该种类。每拥有一种：满意度每轮 +${RARE_BERRY_RULES.satisfactionPerType}、各城羁绊每轮 +${RARE_BERRY_RULES.bondPerType}；拥有 ${RARE_BERRY_RULES.festivalTypes} 种时进入丰收节，每城食物 +1。</p>`
      + `<ul class="rare-berry-list">${RARE_BERRY_IDS.map(id => `<li class="${rare.owned[id] ? 'owned' : ''}"><b>${RARE_BERRIES[id].mark}</b>${RARE_BERRIES[id].name} · ${({ forest: '森林', mountain: '山地', desert: '荒漠', grassland: '草原', snow: '雪原', ocean: '海洋' } as Record<string, string>)[RARE_BERRIES[id].biome]} · 拥有 ${rare.owned[id]}</li>`).join('')}</ul>`
      + (partners.length ? `<p>多余的一份可以赠送给贸易伙伴：信任 +${RARE_BERRY_RULES.giftTrust}，自己获得 ${RARE_BERRY_RULES.giftGold} 金币，同一伙伴每 ${RARE_BERRY_RULES.giftCooldown} 轮一次。</p>`
        + partners.map(relation => RARE_BERRY_IDS.filter(id => rare.owned[id] >= 2).map(id => button(`赠送${RARE_BERRIES[id].name}给文明 ${relation.targetPlayerId + 1}`, { type: 'GiftBerry', targetPlayerId: relation.targetPlayerId, berry: id })).join('')).join('')
        : '<p>与其他文明缔结贸易后，可以赠送多余的稀有树果。</p>'));
  }
  const contest = exp.contests;
  if (contest) {
    const leader = [...contest.rivals].sort((a, b) => b.appeal - a.appeal)[0];
    html += card('s39-contests', `华丽大赛 · 人气 ${contest.own.appeal}/${contest.target} ${civHint('contest')}`, `<p>华丽大赛馆每轮产出人气：每座馆 +${CONTEST_RULES.perHall}，再按已登记物种、稀有物种、稀有树果种类和属性道馆加成（每座馆最多 +${CONTEST_RULES.hallCap}）。人气达到 ${victoryTargets(view).contestMinimum} 且为每个对手的 ${CONTEST_RULES.winRatio} 倍时获得华丽大赛胜利。</p>`
      + `<p>当前每轮 +${contest.own.perRound} · 大赛馆 ${contest.own.halls.length} 座${Object.keys(contest.own.building).length ? ` · 建造中 ${Object.entries(contest.own.building).map(([id, progress]) => `城市 ${id} ${progress}/${CONTEST_RULES.hallCost}`).join('、')}` : ''}${leader ? ` · 最高对手：文明 ${leader.playerId + 1} ${leader.appeal}` : ''}</p>`
      + (!treeGateOpen(player, 'contestHall') ? `<p id="contest-hall-locked">建造大赛馆需要先研究「${techOf(contentForView(view), TREE_GATES.contestHall).name}」。</p>`
        : city ? button(`在城市 #${city.id} 建造大赛馆 · ${CONTEST_RULES.hallGold} 金`, { type: 'BuildContestHall', cityId: city.id }, player.gold >= CONTEST_RULES.hallGold && !contest.own.halls.includes(city.id) && contest.own.building[city.id] === undefined) : '')
      // Playtest 2026-11 U7: the button says how long the cooldown still runs (and any other reason it is off).
      + (() => {
        const wait = contest.own.showReadyAtRound - view.round;
        const reason = wait > 0 ? `冷却中：还剩 ${wait} 轮，第 ${contest.own.showReadyAtRound} 轮可再举办。` : !contest.own.halls.length ? '还没有建成的大赛馆。'
          : player.gold < CONTEST_RULES.showGold ? `金币不足：需要 ${CONTEST_RULES.showGold}，现有 ${player.gold}。` : undefined;
        return `<span class="contest-show" id="contest-show">${button(wait > 0 ? `举办华丽大赛 · 冷却 ${wait} 轮` : `举办华丽大赛 · ${CONTEST_RULES.showGold} 金（+${contest.own.halls.length * CONTEST_RULES.showPerHall} 人气）`, { type: 'HoldContest' }, !reason, reason)}${reason ? `<small class="contest-reason">${escape(reason)}</small>` : ''}</span>`;
      })()
      + `<p>建造期间该城每轮一半生产投入大赛馆，共需 ${CONTEST_RULES.hallCost}；举办大赛冷却 ${CONTEST_RULES.showCooldown} 轮。</p>`);
  }
  const legendFaith = exp.faith;
  if (legendFaith) {
    const mineFaith = legendFaith.faiths.find(item => item.founderId === player.id);
    const offeringNow = exp.civilization.player;
    const free = LEGEND_IDS.filter(id => !legendFaith.faiths.some(item => item.legend === id));
    const needed = Math.ceil(legendFaith.totalCities * legendFaith.winShare);
    let body = `<p>累计供奉 ${FAITH_RULES.foundLifetime} 点后可花 ${FAITH_RULES.foundCost} 供奉点创立一个传说信仰（每个传说只能被一个文明选择），并选择 2 条教义。拥有圣所，或在有属性道馆或华丽大赛馆的城市里，都可以供奉。</p>`
      + `<p>供奉点 ${offeringNow.offeringPoints} · 累计 ${offeringNow.lifetimeOfferings}</p>`;
    if (!mineFaith) {
      body += free.length ? `<div class="faith-found"><label>传说<select id="faith-legend">${free.map(id => `<option value="${id}">${LEGENDS[id].name} · ${LEGENDS[id].blessing}</option>`).join('')}</select></label>`
        + `<fieldset class="faith-tenets"><legend>教义（选 2 条）</legend>${TENET_IDS.map(id => `<label><input type="checkbox" data-tenet="${id}">${TENETS[id].name}：${TENETS[id].description}</label>`).join('')}</fieldset>`
        + `<button type="button" id="found-faith" ${disabled || offeringNow.lifetimeOfferings < FAITH_RULES.foundLifetime || offeringNow.offeringPoints < FAITH_RULES.foundCost ? 'disabled' : ''}>创立信仰 · ${FAITH_RULES.foundCost} 供奉点</button></div>`
        : '<p>五位传说都已被其他文明选择。</p>';
    } else {
      const spreadPrice = FAITH_RULES.spreadCost - (mineFaith.tenets.includes('missionaries') ? 5 : 0);
      body += `<p class="faith-own" style="--legend:${LEGENDS[mineFaith.legend].color}"><b>${LEGENDS[mineFaith.legend].mark}</b>${LEGENDS[mineFaith.legend].name}信仰 · ${mineFaith.followers}/${legendFaith.totalCities} 座城市（胜利需 ${needed} 座，且每个对手至少 1 座）· 教义：${mineFaith.tenets.map(id => TENETS[id].name).join('、')}</p>`
        + `<p>${LEGENDS[mineFaith.legend].blessing}。传播：每次 ${spreadPrice} 供奉点，目标须在己方城市 ${FAITH_RULES.spreadRange} 格内；信仰城市每轮也会向 ${FAITH_RULES.passiveRange} 格内的城市自然传播。压力达到 ${FAITH_RULES.convertAt} 时改宗。</p>`
        + (city && legendFaith.cityFaith[city.id] !== player.id ? button(`向城市 #${city.id} 传播（压力 ${legendFaith.ownPressure[city.id] ?? 0}/${FAITH_RULES.convertAt}）`, { type: 'SpreadFaith', cityId: city.id }, offeringNow.offeringPoints >= spreadPrice) : '');
    }
    body += `<ul class="faith-list">${legendFaith.faiths.map(item => `<li style="--legend:${LEGENDS[item.legend].color}"><b>${LEGENDS[item.legend].mark}</b>文明 ${item.founderId + 1} · ${LEGENDS[item.legend].name} · ${item.followers} 城</li>`).join('') || '<li>尚无信仰</li>'}</ul>`;
    html += card('s40-faith', `传说信仰${mineFaith ? ` · ${LEGENDS[mineFaith.legend].name}` : ''} ${civHint('faith')}`, body);
  }
  const civ = exp.civilization, faith = civ.player;
  html += card('s23-faith', `供奉与幻影（传奇训练家） ${civHint('phantom')}`, `<p>供奉点 ${faith.offeringPoints} · 下次召唤 ${faith.nextPhantomCost}。控制圣所后，每城每轮可用 10 食物或 20 金币换 5 点。</p>`
    + (city ? button('供奉食物', { type: 'MakeOffering', cityId: city.id, resource: 'food' }, city.food >= 10 && !faith.offeredThisRoundByCity[city.id] && civ.sanctuaries.some(site => site.ownerId === player.id))
      + button('供奉金币', { type: 'MakeOffering', cityId: city.id, resource: 'gold' }, player.gold >= 20 && !faith.offeredThisRoundByCity[city.id] && civ.sanctuaries.some(site => site.ownerId === player.id)) : '')
    + '<p>幻影仅能使用一次，召唤费用每次 +15；效果与名人堂可在审计台逐项查看。</p>'
    + CIVILIZATION_CONTENT.phantoms.definitions.filter(definition => !faith.summonedPhantomIds.includes(definition.id)).map(definition =>
      button(`召唤${definition.name}`, { type: 'SummonPhantom', category: definition.id }, faith.offeringPoints >= faith.nextPhantomCost)).join('')
    + faith.activePhantoms.map(phantomId => {
      const action: Command['action'] = { type: 'ActivatePhantom', phantomId,
        ...((phantomId === 'engineer' || phantomId === 'artist') && city ? { cityId: city.id } : {}),
        ...(phantomId === 'general' ? { unitIds: own.slice(0, 6).map(unit => unit.id) } : {}) };
      return button(`发动${CIVILIZATION_CONTENT.phantoms.definitions.find(definition => definition.id === phantomId)?.name ?? phantomId}`, action,
        phantomId !== 'scientist' || player.research.techId !== null);
    }).join('') + `<p>名人堂：${escape(faith.hallOfFame.join('、') || '暂无')}</p>`);
  html += card('s24-sanctuaries', '圣所挑战与起源胜利', '<p>派单位抵达圣所，支付 80 金币建立。部署最多三只宝可梦在两格内挑战守卫，队伍消耗行动并承受战损；集齐四块石板获得起源胜利。</p>'
    + civ.sanctuaries.map(site => {
      const onSite = own.find(unit => hexDistance(unit.position, site.position, view.map) === 0);
      const team = own.filter(unit => unit.actionLeft && hexDistance(unit.position, site.position, view.map) <= 2).sort((a, b) => Number(b.id === onSite?.id) - Number(a.id === onSite?.id) || a.id - b.id).slice(0, 3);
      return `<p>${escape(site.name)} · (${site.position.q},${site.position.r}) · ${site.ownerId === null ? '未控制' : `文明 ${site.ownerId + 1}`} · ${site.guardianDefeated ? '石板已获得' : escape(site.guardianName)}</p>`
        + (site.ownerId === null && onSite ? button('建立圣所 · 80 金', { type: 'EstablishSanctuary', siteId: site.id, unitId: onSite.id }, player.gold >= 80 && Boolean(onSite.actionLeft)) : '')
        + (site.ownerId === player.id && !site.guardianDefeated ? (CONTENT.teamBattles
          // v26: a beatable boss (its species' attack and defence, more HP); the lineup picker shows the estimate.
          ? `<button type="button" data-lineup="guardian:${escape(site.id)}"${disabled || !onSite?.actionLeft ? ' disabled' : ''}>挑战守卫 · 选择阵容</button>`
          : button('挑战守卫', { type: 'ChallengeGuardian', siteId: site.id, unitIds: team.map(unit => unit.id) }, Boolean(onSite?.actionLeft) && team.length > 0)) : '');
    }).join('') + `<p>已知石板：${Object.entries(civ.tabletOwners).map(([tablet, owner]) => `${escape(tablet)} → 文明 ${owner + 1}`).join('、') || '无'}</p>`);
  // v24 B / C: badge box, circuit gyms, the Elite Four, the own rival.
  html += v24PanelCards(view, button, card);
  // v26 D: TMs, special training, contest-season entries (none before v26).
  html += depthPanelCards(view, button, card);
  const peaceful = !view.diplomacy.some(pair => pair.status === 'war' && [pair.a, pair.b].includes(player.id));
  html += card('s27-championship', '六只队伍与联盟大会', `<p>下一届：第 ${civ.championship.nextRound} 轮。六只宝可梦报名，六队锦标赛、前两名轮空，获得 ${titlesNeeded} 届冠军即胜利${exp.gymCircuit ? '（战胜四天王也计 1 个头衔，四天王最多算 1 个）' : ''}。大会战损会写回参赛单位，HP 至少保留 1，并消耗行动。</p><p>当前冠军数 ${civ.championship.titlesByPlayer[player.id] ?? 0}/${titlesNeeded} · ${civ.championship.registration ? '已报名' : '未报名'}</p>`
    + (CONTENT.teamBattles
      // v26: pick the six and their order (re-registering changes the order); the NPC teams are announced five rounds ahead.
      ? `<button type="button" data-lineup="championship:"${disabled || !peaceful || own.length < 6 ? ' disabled' : ''}>${civ.championship.registration ? '调整报名与出场顺序' : '报名 · 选择六只与出场顺序'}</button>`
        + (civ.championship.lineup?.length ? `<p>本届公布的联盟训练家：${civ.championship.lineup.map(npc => `${escape(npc.name)}（${npc.roster.map(member => CONTENT.species[member.speciesId]?.name ?? member.speciesId).join('、')}）`).join('；')}</p>` : '')
      : button('报名当前六只宝可梦', { type: 'RegisterChampionshipTeam', unitIds: own.slice(0, 6).map(unit => unit.id) }, peaceful && own.length >= 6 && !civ.championship.registration))
    + `<p>阵容：${own.slice(0, 6).map(unit => `#${unit.id} ${unit.kind === 'pokemon' ? CONTENT.species[unit.speciesId].name : ''}`).join('、')}</p><p>最近冠军：${civ.championship.history.map(season => `第${season.season}届 ${season.championPlayerId === null ? 'NPC' : `文明${season.championPlayerId + 1}`}`).join('；') || '尚未举办'}</p>`);
  html += card('s28-deep-diplomacy', '联盟、贸易与信任', '<p>和平时期可提议结盟与贸易。贸易每五轮给双方 4 金币并增进信任；背叛需 20 金币，信任降至 -50 并进入冷却。</p>'
    + civ.relations.filter(relation => !view.civilizations.find(civ => civ.id === relation.targetPlayerId)?.eliminated).map(relation => {
      const targetPlayerId = relation.targetPlayerId;
      const canPropose = (last: number | null, rejected: number | null) => relation.atPeace
        && view.round > (last ?? -Infinity) + CIVILIZATION_CONTENT.diplomacy.rejectionCooldownRounds
        && view.round > (rejected ?? -Infinity) + CIVILIZATION_CONTENT.diplomacy.rejectionCooldownRounds;
      let controls = `<p>文明 ${targetPlayerId + 1} · 信任 ${relation.trust} · ${relation.allianceSinceRound !== null ? '同盟' : '无同盟'} · ${relation.tradeSinceRound !== null ? '贸易生效' : '无贸易'}</p>`;
      if (relation.allianceProposal?.proposerId === targetPlayerId) controls += button('接受同盟', { type: 'RespondAlliance', targetPlayerId, accept: true }, relation.atPeace) + button('拒绝同盟', { type: 'RespondAlliance', targetPlayerId, accept: false }, relation.atPeace);
      else if (relation.allianceSinceRound === null) controls += button('提议同盟', { type: 'ProposeAlliance', targetPlayerId }, relation.allianceProposal === null && view.round >= relation.betrayalCooldownUntilRound && canPropose(relation.allianceLastProposalRound, relation.allianceLastRejectedRound));
      else controls += button('解散同盟', { type: 'DissolveAlliance', targetPlayerId }) + button('背叛 · 20 金', { type: 'BetrayAlliance', targetPlayerId }, player.gold >= 20);
      if (relation.tradeProposal?.proposerId === targetPlayerId) controls += button('接受贸易', { type: 'RespondTrade', targetPlayerId, accept: true }, relation.atPeace) + button('拒绝贸易', { type: 'RespondTrade', targetPlayerId, accept: false }, relation.atPeace);
      else if (relation.tradeSinceRound === null) controls += button('提议贸易', { type: 'ProposeTrade', targetPlayerId }, relation.tradeProposal === null && canPropose(relation.tradeLastProposalRound, relation.tradeLastRejectedRound));
      return controls;
    }).join(''));
  root.innerHTML = html;
  root.querySelectorAll<HTMLDetailsElement>('details').forEach(element => { element.open = opened.has(element.dataset.system); });
  root.querySelectorAll<HTMLButtonElement>('[data-expansion-action]').forEach(element => element.addEventListener('click', () => issue(parseAuditAction(actions[Number(element.dataset.expansionAction)]))));
  // v26: relay battles open the lineup picker (src/browser/lineup-picker.ts).
  root.querySelectorAll<HTMLButtonElement>('[data-lineup]').forEach(element => element.addEventListener('click', () => {
    const [kind, key] = element.dataset.lineup!.split(':') as [PickerKind, string];
    openLineupPicker(view, { kind, key }, action => issue(parseAuditAction(action)));
  }));
  const found = root.querySelector<HTMLButtonElement>('#found-faith');
  if (found) {
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-tenet]')];
    const affordable = !found.disabled;
    const sync = () => {
      const checked = boxes.filter(box => box.checked);
      for (const box of boxes) box.disabled = disabled || (!box.checked && checked.length >= 2);
      found.dataset.ready = String(checked.length === 2);
      found.disabled = !affordable || checked.length !== 2;
      found.title = checked.length === 2 ? '' : `还需选择 ${2 - checked.length} 条教义`;
    };
    boxes.forEach(box => box.addEventListener('change', sync)); sync();
    found.addEventListener('click', () => {
      const tenets = boxes.filter(box => box.checked).map(box => box.dataset.tenet as TenetId);
      if (tenets.length !== 2) return;
      issue({ type: 'FoundFaith', legend: root.querySelector<HTMLSelectElement>('#faith-legend')!.value as LegendId, tenets });
    });
  }
}
