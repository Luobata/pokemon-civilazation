// Role Pokémon (docs/design/role-pokemon-v18.md): every non-combat unit is drawn as one fixed, iconic species
// that never appears as a combat unit, so a glance tells a role from a fighter. Presentation applies to all
// versions; the 工匠 (builder) role and its rules exist from gameplay v18.
export type RoleId = 'settler' | 'builder' | 'trader';
export const ROLE_POKEMON: Record<RoleId, { unitName: string; species: string; dex: number; sprite: string; job: string; why: string }> = {
  settler: { unitName: '开拓队', species: '肯泰罗', dex: 128, sprite: '/sprites/gen3/128.png',
    job: '建立新城市', why: '拉着篷车的牛群是拓荒的象征；肯泰罗就是宝可梦世界里拉车、开荒的那头牛。' },
  builder: { unitName: '工匠', species: '搬运小匠', dex: 532, sprite: '/sprites/gen5/532.png',
    job: '修建地块改良', why: '搬运小匠扛着木材帮人盖房子，是宝可梦世界里公认的建筑工人。' },
  trader: { unitName: '商队', species: '变隐龙', dex: 352, sprite: '/sprites/gen3/352.png',
    job: '开通国内商路', why: '《不可思议的迷宫》里开店的变隐龙兄弟，是最有名的宝可梦商人。' },
};
export const ROLE_IDS = Object.keys(ROLE_POKEMON) as RoleId[];
export const BUILDER_RULES = {
  /** Improvements one builder can build before it is used up (Civilization 6 builder charges). */
  charges: 3,
} as const;
