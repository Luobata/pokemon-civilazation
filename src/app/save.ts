import { CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { GameState } from '../core/model.ts';
import { canonicalSerialize } from '../core/snapshot.ts';
import { observe } from '../core/vision.ts';
import type { CommandLog } from './session.ts';

export type SaveFile = {
  formatVersion: 1; schemaVersion: 4; rulesVersion: 'm5-v1'; contentVersion: string;
  state: GameState; log: CommandLog;
};
export function serializeSave(state: GameState, log: CommandLog): string {
  return JSON.stringify({ formatVersion: 1, schemaVersion: state.schemaVersion, rulesVersion: state.rulesVersion,
    contentVersion: state.contentVersion, state, log } satisfies SaveFile, null, 2);
}
export function deserializeSave(text: string, content: Content = CONTENT): SaveFile {
  const save = JSON.parse(text) as SaveFile;
  if (save?.formatVersion !== 1 || save.schemaVersion !== 4 || save.rulesVersion !== 'm5-v1' || save.contentVersion !== content.version
    || save.state?.schemaVersion !== 4 || save.state.rulesVersion !== save.rulesVersion || save.state.contentVersion !== save.contentVersion
    || save.log?.version !== 1 || save.log.schemaVersion !== 4 || save.log.rulesVersion !== save.rulesVersion || save.log.contentVersion !== save.contentVersion) {
    throw new Error('存档版本不匹配；当前版本不支持迁移。');
  }
  const state = save.state;
  if (!Array.isArray(save.log.commands) || !Number.isSafeInteger(state.commandSeq) || state.commandSeq < 0 || state.commandSeq > save.log.commands.length
    || canonicalSerialize(state.setup) !== canonicalSerialize(save.log.setup)) throw new Error('存档状态与命令日志不匹配。');
  // Visibility is derived on demand, never serialized. Rebuild the view without
  // refreshing historical knowledge: merely loading must not change the save.
  try {
    const human = state.setup.players.find(player => player.controller === 'human');
    if (!human) throw new Error('Missing human player');
    observe(state, human.id, content);
  } catch { throw new Error('存档状态不完整。'); }
  return save;
}
