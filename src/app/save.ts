import { gameVersions } from '../core/versions.ts';
import { createGame } from '../core/game.ts';
import { step } from '../core/step.ts';
import { CONTENT, STOCK_CONTENTS } from '../content/units.ts';
import { isLeaderId } from '../content/leaders.ts';
import type { Content } from '../content/units.ts';
import type { GameState } from '../core/model.ts';
import { canonicalSerialize } from '../core/snapshot.ts';
import { observe } from '../core/vision.ts';
import { hexToIndex } from '../core/hex.ts';
import type { CommandLog } from './session.ts';

export type SaveFile = {
  formatVersion: 1; schemaVersion: GameState['schemaVersion']; rulesVersion: GameState['rulesVersion']; contentVersion: string;
  state: GameState; log: CommandLog;
};
export function serializeSave(state: GameState, log: CommandLog): string {
  return JSON.stringify({ formatVersion: 1, schemaVersion: state.schemaVersion, rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion, state, log } satisfies SaveFile, null, 2);
}
export function deserializeSave(text: string, content?: Content): SaveFile {
  const save = JSON.parse(text) as SaveFile;
  content ??= STOCK_CONTENTS.find(stock => stock.version === save?.contentVersion) ?? CONTENT;
  const versions = gameVersions(save?.state?.setup ?? {});
  if (save?.formatVersion !== 1 || save.schemaVersion !== versions.schemaVersion || save.rulesVersion !== versions.rulesVersion || save.contentVersion !== content.version
    || save.state?.schemaVersion !== save.schemaVersion || save.state.rulesVersion !== save.rulesVersion || save.state.contentVersion !== save.contentVersion
    || save.log?.version !== 1 || save.log.schemaVersion !== save.schemaVersion || save.log.rulesVersion !== save.rulesVersion || save.log.contentVersion !== save.contentVersion) {
    throw new Error('存档版本不匹配；当前版本不支持迁移。');
  }
  const state = save.state;
  if (!Array.isArray(save.log.commands) || !Number.isSafeInteger(state.commandSeq) || state.commandSeq < 0 || state.commandSeq > save.log.commands.length
    || canonicalSerialize(state.setup) !== canonicalSerialize(save.log.setup)) throw new Error('存档状态与命令日志不匹配。');
  if (state.setup.expansionVersion !== undefined || state.expansion !== undefined) {
    if (state.setup.expansionVersion !== 1 || state.expansion?.version !== 1 || save.log.commands.length > 100_000) throw new Error('扩展规则版本或日志大小无效。');
    let verified = createGame(save.log.setup, content);
    for (const command of save.log.commands.slice(0, state.commandSeq)) {
      const result = step(verified, command, content);
      if (!result.ok) throw new Error('扩展存档命令无法重放。');
      verified = result.state;
    }
    if (canonicalSerialize(verified) !== canonicalSerialize(state)) throw new Error('扩展存档与权威重放不匹配。');
  }
  const memory = save.log.aiRejectedCitySites;
  if (memory !== undefined && (!Array.isArray(memory) || memory.some(site => !site || typeof site !== 'object'
    || !Number.isSafeInteger(site.playerId) || !Object.hasOwn(state.players, site.playerId)
    || !site.position || !Number.isSafeInteger(site.position.q) || !Number.isSafeInteger(site.position.r)
    || hexToIndex(site.position, state.map) === null || !Number.isSafeInteger(site.seq) || site.seq < 0))) {
    throw new Error('存档 AI 建城拒绝记忆无效：需要玩家、地图内整数坐标和非负整数命令序号。');
  }
  // Visibility is derived on demand, never serialized. Rebuild the view without
  // refreshing historical knowledge: merely loading must not change the save.
  try {
    const human = state.setup.players.find(player => player.controller === 'human');
    if (!human) throw new Error('Missing human player');
    if (state.setup.players.some(player => (player.leaderId !== undefined && !isLeaderId(player.leaderId))
      || !state.players[player.id] || state.players[player.id].leaderId !== player.leaderId)) {
      throw new Error('Invalid or mismatched leader.');
    }
    observe(state, human.id, content);
  } catch { throw new Error('存档状态不完整。'); }
  return save;
}
