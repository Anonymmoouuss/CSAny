export const CLASSIC_RANKS = ['Silver I', 'Silver II', 'Silver III', 'Silver IV', 'Silver Elite', 'Silver Elite Master', 'Gold Nova I', 'Gold Nova II', 'Gold Nova III', 'Gold Nova Master', 'Master Guardian I', 'Master Guardian II', 'Master Guardian Elite', 'Distinguished Master Guardian', 'Legendary Eagle', 'Legendary Eagle Master', 'Supreme Master First Class', 'The Global Elite'] as const;
export type RankedProfile = { rating: number; skill: number; wins: number; losses: number; matches: number; recentMatches: string[] };
export type RankSummary = { index: number; name: string; rating: number; matches: number; wins: number; losses: number };
export function initialRank(): RankedProfile { return { rating: 1000, skill: 1000, wins: 0, losses: 0, matches: 0, recentMatches: [] }; }
export function rankIndex(rating: number) { return Math.max(0, Math.min(CLASSIC_RANKS.length - 1, Math.floor((rating - 1000) / 100))); }
export function rankSummary(profile: RankedProfile): RankSummary { const index = rankIndex(profile.rating); return { index, name: CLASSIC_RANKS[index], rating: Math.round(profile.rating), matches: profile.matches, wins: profile.wins, losses: profile.losses }; }
export function rankedCompatible(first: RankedProfile, second: RankedProfile) { return rankIndex(first.rating) === rankIndex(second.rating) && Math.abs(first.rating - second.rating) <= 80 && Math.abs(first.skill - second.skill) <= 100; }
export function rankedBotDifficulty(index: number) { return index >= 7 ? 'hard' as const : 'normal' as const; }
export function applyRankedResult(profile: RankedProfile, match: string, won: boolean, opponentRating: number, kills: number, deaths: number) {
  if (!match || profile.recentMatches.includes(match)) return false;
  const expected = 1 / (1 + Math.pow(10, (opponentRating - profile.rating) / 400));
  profile.rating = Math.max(800, Math.min(3000, Math.round(profile.rating + 36 * (Number(won) - expected))));
  const performance = Math.max(-12, Math.min(12, (kills - deaths) * 1.5)); profile.skill = Math.max(700, Math.min(3100, Math.round(profile.skill * 0.85 + (profile.rating + performance) * 0.15)));
  profile.matches++; if (won) profile.wins++; else profile.losses++;
  profile.recentMatches.push(match); if (profile.recentMatches.length > 100) profile.recentMatches.shift(); return true;
}