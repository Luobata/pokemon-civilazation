// Gameplay v26 (docs/design/depth-v26.md §2.2): original names of the conference's NPC trainers (picked per season and slot with
// stableSeed). All names are original.
import type { TypeId } from './species.ts';

export const CONFERENCE_TRAINERS: readonly string[] = ['青岚', '白鹭', '石楠', '晓帆', '丹枫', '星澜', '墨竹', '苇川', '霁月', '岩松', '流萤', '雪棠'];

// Gameplay v27 ⑥ (docs/design/pace-v27.md §7.1, option 6A): the league roster's eight original trainer archetypes (title, favoured
// types and roles, three original names each — the v26 twelve plus twelve more, 24 in all — a personality and lines). A game seats one
// trainer per archetype; the portrait is per archetype (`/trainers/<id>.svg`). No official trainer, gym leader or Elite Four is used.
export type TrainerArchetypeId = 'mountainGuide' | 'tideSurfer' | 'spiritMedium' | 'forgeSmith' | 'grovePoet' | 'frostRider' | 'sparkTinker' | 'dragonWarden';
export type TrainerRole = 'ranged' | 'melee' | 'scout' | 'fast' | 'siege' | 'naval' | 'air';
export type TrainerArchetype = {
  id: TrainerArchetypeId; title: string; types: readonly TypeId[]; roles: readonly TrainerRole[]; names: readonly [string, string, string];
  personality: string;
  /** Lines: on the profile card; once the signature has evolved (season 3 on); as the viewer's nemesis; after losing to the viewer. */
  lines: { greet: string; evolved: string; nemesis: string; beaten: string };
};
export const TRAINER_ARCHETYPES: readonly TrainerArchetype[] = [
  { id: 'mountainGuide', title: '山岳向导', types: ['rock', 'ground', 'fighting'], roles: ['melee', 'siege'], names: ['岩松', '石楠', '峰野'],
    personality: '沉稳寡言，背着绳索走在最前面；相信一步一个脚印。',
    lines: { greet: '山路不怕慢，就怕停。', evolved: '它进化了！这次不一样了。', nemesis: '上次是我赢了。这座山你还没翻过去。', beaten: '好，你登顶了。下次换我在山顶等你。' } },
  { id: 'tideSurfer', title: '潮汐冲浪手', types: ['water', 'ice'], roles: ['naval', 'ranged'], names: ['晓帆', '苇川', '汐澄'],
    personality: '爽朗爱笑，看潮水比看日历准；输了也要先去冲一趟浪。',
    lines: { greet: '浪来了就上，想那么多干什么！', evolved: '它进化了！这次不一样了。', nemesis: '上次是我赢了。今天的浪也站在我这边。', beaten: '被你拍下来了……下一道浪我会更高。' } },
  { id: 'spiritMedium', title: '灵媒学徒', types: ['psychic', 'ghost'], roles: ['ranged'], names: ['霁月', '星澜', '幽篁'],
    personality: '说话轻声，总像在听别人听不见的声音；对胜负意外地执着。',
    lines: { greet: '你的宝可梦……在和我的宝可梦说话。', evolved: '它进化了！这次不一样了。', nemesis: '上次是我赢了。我早就看见了。', beaten: '这个结局，我没有预见到。' } },
  { id: 'forgeSmith', title: '炉火匠人', types: ['fire', 'steel'], roles: ['siege', 'melee'], names: ['丹枫', '炽原', '熔川'],
    personality: '嗓门大、手上全是老茧；把每场对战都当成一次锻打。',
    lines: { greet: '火候到了，开打！', evolved: '它进化了！这次不一样了。', nemesis: '上次是我赢了。这回的火更旺。', beaten: '淬火不够……回去重打一遍。' } },
  { id: 'grovePoet', title: '林间诗人', types: ['grass', 'bug', 'fairy'], roles: ['scout', 'ranged'], names: ['墨竹', '流萤', '苔吟'],
    personality: '随身带着笔记本，赢了写一首、输了也写一首。',
    lines: { greet: '让我把这场对战写进诗里。', evolved: '它进化了！这次不一样了。', nemesis: '上次是我赢了——那一首我还留着。', beaten: '输得漂亮，也值得一首诗。' } },
  { id: 'frostRider', title: '霜原骑手', types: ['ice', 'normal'], roles: ['fast'], names: ['雪棠', '白鹭', '凌霜'],
    personality: '来去如风，冬天也不进屋；讨厌拖泥带水的对战。',
    lines: { greet: '跟得上我的速度吗？', evolved: '它进化了！这次不一样了。', nemesis: '上次是我赢了。雪原上没人追得上我。', beaten: '……被你追上了。这次的风向不对。' } },
  { id: 'sparkTinker', title: '雷光技师', types: ['electric', 'steel'], roles: ['ranged', 'fast'], names: ['青岚', '曜辰', '启明'],
    personality: '护目镜不离头，满口术语；赛后一定要把每一回合拆开来看。',
    lines: { greet: '数据已经算好了，开始验证。', evolved: '它进化了！这次不一样了。', nemesis: '上次是我赢了。你的数据我全记下了。', beaten: '误差超出预期……我要重新校准。' } },
  { id: 'dragonWarden', title: '龙谷守望', types: ['dragon', 'flying'], roles: ['air'], names: ['云栖', '苍翎', '鸣霄'],
    personality: '在山谷里守了很多年龙巢，话少，但从不看轻对手。',
    lines: { greet: '龙谷的风，只为强者停下。', evolved: '它进化了！这次不一样了。', nemesis: '上次是我赢了。龙谷还在等你。', beaten: '你配得上龙谷的风。' } },
];
/** v27: the 24 league trainer names (the v26 twelve and twelve more); a game seats one per archetype, so no name repeats in a game. */
export const LEAGUE_TRAINER_NAMES: readonly string[] = TRAINER_ARCHETYPES.flatMap(archetype => archetype.names);
export const trainerArchetype = (id: TrainerArchetypeId): TrainerArchetype => TRAINER_ARCHETYPES.find(archetype => archetype.id === id)!;
