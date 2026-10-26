import type { CharmId, InventoryItem } from './economy.ts';
import type { RankSummary } from './ranking.ts';

export type SocialCredentials = { id: string; token: string };
export type PublicProfile = { id: string; name: string; avatar: string; online: boolean; rank?: RankSummary };
export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export type TradeOffer = { id: string; from: string; to: string; give: string[]; receive: string[]; offered: InventoryItem[]; requested: InventoryItem[]; status: TradeStatus; createdAt: number; expiresAt: number };
export type DirectMessage = { id: string; from: string; to: string; text: string; createdAt: number };
export type DuelInvite = { id: string; from: string; to: string; status: TradeStatus; createdAt: number; expiresAt: number };
export type SocialState = { type: 'social-state'; self: PublicProfile & { items: InventoryItem[]; credits: number; locked: string[]; charms: CharmId[] }; friends: (PublicProfile & { items: InventoryItem[] })[]; incoming: PublicProfile[]; outgoing: PublicProfile[]; trades: TradeOffer[]; messages: DirectMessage[]; duels: DuelInvite[] };