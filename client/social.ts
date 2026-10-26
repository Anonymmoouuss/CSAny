import { WEAPONS, type WeaponId } from '../shared/game.ts';
import { CHARMS, CHARM_CASES, SKIN_BY_ID, SKIN_CATALOG, itemValue, type InventoryItem } from '../shared/economy.ts';
import type { PublicProfile, SocialCredentials, SocialState } from '../shared/social.ts';
import { Armory, escapeHtml, refreshIcons } from './armory.ts';

const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const avatar = (profile: PublicProfile) => profile.avatar ? `<img class="social-avatar" src="${escapeHtml(profile.avatar)}" width="40" height="40" alt="${escapeHtml(profile.name)}">` : `<span class="social-avatar social-initials">${escapeHtml(profile.name.slice(0, 2).toUpperCase())}</span>`;

export class SocialPanel {
  state: SocialState | null = null;
  credentials: SocialCredentials | undefined;
  onNotice: (message: string) => void = () => {};
  onDuelReady: (code: string) => void = () => {};
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private root: HTMLElement;
  private tab = 'profile';
  private target = '';
  private offered = new Set<string>();
  private requested = new Set<string>();
  private avatarDraft: string | undefined;
  private status = '';
  private endpoint = '';
  private catalogWeapon: WeaponId = 'rifle';
  private notifications: HTMLElement;
  private dismissed = new Set<string>();
  private messageDraft = '';
  private profilePage = 0;
  private profilePreviews: IntersectionObserver;

  constructor(private armory: Armory, private server: () => string, private callsign: () => string) {
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<section class="social-screen hidden" id="social-screen" role="dialog" aria-modal="true" aria-label="Profile and friends"></section>');
    this.root = document.getElementById('social-screen')!;
    this.profilePreviews = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const image = entry.target as HTMLImageElement; const item = this.state?.friends.flatMap(friend => friend.items).find(item => item.uid === image.dataset.profileItem);
        if (item) image.src = this.armory.preview(item); this.profilePreviews.unobserve(image);
      }
    }, { root: this.root, rootMargin: '20px' });
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<aside id="social-notifications" class="social-notifications" aria-label="Social notifications" aria-live="polite"></aside>');
    this.notifications = document.getElementById('social-notifications')!;
    this.notifications.addEventListener('click', event => this.notificationClick(event));
    this.root.addEventListener('click', event => this.click(event));
    this.root.addEventListener('submit', event => this.submit(event));
    this.root.addEventListener('change', event => { void this.change(event); });
    this.root.addEventListener('input', event => { const input = event.target as HTMLInputElement; if (input.id === 'social-message-content') this.messageDraft = input.value; });
    document.querySelector('.top-actions')!.insertAdjacentHTML('afterbegin', `<button class="icon-button profile-button" id="profile-open" title="Profile and friends" aria-label="Profile and friends">${icon('user-round')}<span id="social-count" class="hidden"></span></button>`);
    document.getElementById('profile-open')!.onclick = () => this.open();
    this.armory.onCharmChange = (item, charm) => { if (!this.state?.self.items.some(owned => owned.uid === item.uid)) return false; this.send({ type: 'charm', uid: item.uid, charm }); return true; };
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }
  private storageKey() { return `bs-social-v1:${this.endpoint}`; }
  private notice(message: string) { this.status = message; const element = this.root.querySelector('#social-status'); if (element) element.textContent = message; }

  async connect(name = this.callsign(), existingOnly = false) {
    const url = new URL(this.server()); url.pathname = '/social'; url.search = ''; url.hash = '';
    if (this.socket?.readyState === WebSocket.OPEN && this.state && this.endpoint === url.toString()) return;
    if (this.connecting) return this.connecting;
    this.endpoint = url.toString(); this.socket?.close(); this.state = null;
    try { this.credentials = JSON.parse(localStorage.getItem(this.storageKey()) || 'null') || undefined; } catch { this.credentials = undefined; }
    if (existingOnly && !this.credentials) return;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.endpoint); this.socket = socket; let ready = false;
      const timeout = window.setTimeout(() => { socket.close(); reject(new Error('PROFILE SERVER TIMED OUT')); }, 10000);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', name: name || 'Operator', credentials: this.credentials }));
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'social-ready' && message.credentials) { this.credentials = message.credentials; localStorage.setItem(this.storageKey(), JSON.stringify(this.credentials)); }
          if (message.type === 'social-state') {
            const next = message as SocialState; const before = this.state?.incoming.length || 0;
            const tradesBefore = this.state?.trades.filter(trade => trade.to === this.state!.self.id && trade.status === 'pending').length || 0;
            this.state = next; this.armory.mergeCloudItems(next.self.items, next.self.id, next.self.charms); this.notice('CONNECTED');
            if (next.incoming.length > before) this.onNotice('NEW FRIEND REQUEST');
            if (next.trades.filter(trade => trade.to === next.self.id && trade.status === 'pending').length > tradesBefore) this.onNotice('NEW TRADE REQUEST');
            this.updateButton(); this.renderNotifications(); if (this.isOpen) this.render();
            if (!ready) { ready = true; clearTimeout(timeout); resolve(); }
          }
          if (message.type === 'duel-ready' && typeof message.code === 'string' && /^[A-F0-9]{6}$/.test(message.code)) this.onDuelReady(message.code);
          if (message.type === 'social-error') { this.notice(String(message.text)); if (!ready) { clearTimeout(timeout); reject(new Error(String(message.text))); } }
        } catch { this.notice('INVALID PROFILE RESPONSE'); }
      };
      socket.onerror = () => { if (!ready) { clearTimeout(timeout); reject(new Error('PROFILE SERVER UNAVAILABLE')); } };
      socket.onclose = () => { clearTimeout(timeout); if (this.socket !== socket) return; this.socket = null; this.notice('OFFLINE'); if (!ready) reject(new Error('PROFILE CONNECTION CLOSED')); };
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  send(message: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) { this.notice('PROFILE SERVER OFFLINE'); return false; }
    this.socket.send(JSON.stringify(message)); this.notice('REQUEST SENT'); return true;
  }
  open() {
    this.armory.close(); if (document.pointerLockElement) document.exitPointerLock(); this.root.classList.remove('hidden'); this.render();
    void this.connect().then(() => this.send({ type: 'refresh' })).catch(error => { this.notice(error.message); this.render(); });
  }
  close() { this.root.classList.add('hidden'); }
  private updateButton() {
    if (!this.state) return;
    const button = document.getElementById('profile-open')!; const picture = this.state.self.avatar;
    button.innerHTML = `${picture ? `<img src="${escapeHtml(picture)}" width="30" height="30" alt="Profile">` : icon('user-round')}<span id="social-count"></span>`;
    const count = this.state.incoming.length + this.state.trades.filter(trade => trade.to === this.state!.self.id && trade.status === 'pending').length + this.state.duels.filter(duel => duel.to === this.state!.self.id && duel.status === 'pending').length;
    const badge = document.getElementById('social-count')!; badge.textContent = String(count); badge.classList.toggle('hidden', count === 0); refreshIcons();
  }
  private person(profile: PublicProfile, actions = '') {
    return `<div class="social-person"><button class="social-person-main" data-view-profile="${profile.id}" title="View profile">${avatar(profile)}<span><b>${escapeHtml(profile.name)}</b><small>${profile.online ? 'ONLINE' : 'OFFLINE'}${profile.rank ? ` / ${escapeHtml(profile.rank.name)}` : ''}</small></span></button><div class="social-person-actions">${actions}</div></div>`;
  }

  private renderNotifications() {
    const state = this.state; if (!state) return;
    const name = (id: string) => escapeHtml([...state.friends, ...state.incoming].find(profile => profile.id === id)?.name || id);
    const requests = [...state.incoming.map(profile => ({ kind: 'friend', id: profile.id, from: profile.id, title: 'FRIEND REQUEST' })), ...state.trades.filter(trade => trade.to === state.self.id && trade.status === 'pending').map(trade => ({ kind: 'trade', id: trade.id, from: trade.from, title: 'TRADE OFFER' })), ...state.duels.filter(duel => duel.to === state.self.id && duel.status === 'pending' && duel.expiresAt > Date.now()).map(duel => ({ kind: 'duel', id: duel.id, from: duel.from, title: '1V1 CHALLENGE' }))];
    const messages = state.messages.filter(message => message.to === state.self.id && Date.now() - message.createdAt < 300000 && !this.dismissed.has(message.id)).slice(-3);
    this.notifications.innerHTML = requests.slice(-4).map(request => `<article class="social-notification" data-notice="${request.kind}" data-notice-id="${request.id}"><div><small>${request.title}</small><b>${name(request.from)}</b></div><footer>${request.kind === 'trade' ? `<button data-notice-action="view" title="Review trade">${icon('eye')}REVIEW</button>` : ''}<button data-notice-action="accept">${icon('check')}ACCEPT</button><button data-notice-action="decline">${icon('x')}DECLINE</button></footer></article>`).join('') + messages.map(message => `<article class="social-notification" data-notice="message" data-notice-id="${message.id}" data-from="${message.from}"><div><small>MESSAGE / ${name(message.from)}</small><p>${escapeHtml(message.text)}</p></div><footer><button data-notice-action="view">${icon('message-square')}OPEN</button><button data-notice-action="dismiss" title="Dismiss message" aria-label="Dismiss message">${icon('x')}</button></footer></article>`).join('');
    refreshIcons();
  }

  private notificationClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-notice-action]'); const request = button?.closest<HTMLElement>('[data-notice]'); if (!button || !request) return;
    const id = request.dataset.noticeId!; const action = button.dataset.noticeAction; const kind = request.dataset.notice;
    if (kind === 'message') { this.dismissed.add(id); if (action === 'view') { this.target = request.dataset.from!; this.tab = 'messages'; this.open(); } this.renderNotifications(); return; }
    if (kind === 'trade' && action === 'view') { this.tab = 'trades'; this.open(); return; }
    if (kind === 'friend') this.send({ type: 'friend-reply', target: id, accept: action === 'accept' });
    if (kind === 'trade') { if (action === 'accept') { this.tab = 'trades'; this.open(); } else this.send({ type: 'trade-reply', trade: id, action: 'decline' }); }
    if (kind === 'duel') this.send({ type: 'duel-reply', duel: id, accept: action === 'accept' });
  }
  private items(items: InventoryItem[], kind: 'give' | 'receive', locked: string[] = []) {
    const selection = kind === 'give' ? this.offered : this.requested;
    return items.map(item => { const skin = SKIN_BY_ID.get(item.skinId)!; return `<label class="social-trade-item"><input type="checkbox" data-trade-item="${kind}" value="${escapeHtml(item.uid)}" ${selection.has(item.uid) ? 'checked' : ''} ${locked.includes(item.uid) ? 'disabled' : ''}><i style="background:${skin.colors[0]}"></i><span><b>${escapeHtml(skin.name)}</b><small>${WEAPONS[skin.weapon].name} / ${Math.round(item.float * 100)}% WEAR${locked.includes(item.uid) ? ' / LOCKED' : ''}</small></span></label>`; }).join('');
  }

  private render() {
    this.profilePreviews.disconnect();
    const focus = document.activeElement as HTMLInputElement | null; const messageFocus = focus?.id === 'social-message-content'; const cursor = messageFocus ? focus.selectionStart : null;
    let body = `<button class="primary-action" data-social-connect>${icon('refresh-cw')}CONNECT PROFILE</button>`; const state = this.state;
    if (state && this.tab === 'profile') body = `<form id="social-profile-form" class="social-profile-form"><div class="profile-picture">${avatar({ ...state.self, avatar: this.avatarDraft ?? state.self.avatar })}<label class="text-action">${icon('image-plus')}PICTURE<input id="social-avatar-input" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="text-action" data-avatar-remove>${icon('x')}REMOVE</button></div><label class="field-label">DISPLAY NAME<input id="social-profile-name" maxlength="24" value="${escapeHtml(state.self.name)}" required></label><div class="social-profile-code"><span>FRIEND CODE</span><b>${state.self.id}</b><button class="icon-button" type="button" data-copy-code title="Copy friend code" aria-label="Copy friend code">${icon('copy')}</button></div><button class="primary-action" type="submit">${icon('check')}SAVE PROFILE</button></form>`;
    if (state && this.tab === 'friends') body = `<form id="social-friend-form" class="social-friend-form"><label class="field-label">FRIEND CODE<input id="social-friend-code" maxlength="12" pattern="[A-Fa-f0-9]{12}" required></label><button class="primary-action" type="submit">${icon('user-plus')}ADD FRIEND</button></form><h3>REQUESTS / ${state.incoming.length}</h3>${state.incoming.map(profile => this.person(profile, `<button class="icon-button" data-friend-accept="${profile.id}" title="Accept friend" aria-label="Accept friend">${icon('check')}</button><button class="icon-button" data-friend-decline="${profile.id}" title="Decline friend" aria-label="Decline friend">${icon('x')}</button>`)).join('')}<h3>FRIENDS / ${state.friends.length}</h3>${state.friends.map(profile => this.person(profile, `<button class="icon-button" data-trade-friend="${profile.id}" title="Offer trade" aria-label="Offer trade">${icon('arrow-left-right')}</button><button class="icon-button" data-friend-remove="${profile.id}" title="Remove friend" aria-label="Remove friend">${icon('user-minus')}</button>`)).join('')}${state.outgoing.length ? `<h3>SENT REQUESTS</h3>${state.outgoing.map(profile => this.person(profile)).join('')}` : ''}`;
    if (state && this.tab === 'trades') {
      const friend = state.friends.find(profile => profile.id === this.target) || state.friends[0]; this.target = friend?.id || '';
      body = `${friend ? `<form id="social-trade-form"><label class="field-label">TRADE WITH<select id="social-trade-friend">${state.friends.map(profile => `<option value="${profile.id}" ${profile.id === this.target ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')}</select></label><div class="social-trade-columns"><section><h3>YOU OFFER</h3><div class="social-item-list">${this.items(state.self.items, 'give', state.self.locked)}</div></section><section><h3>YOU REQUEST</h3><div class="social-item-list">${this.items(friend.items, 'receive')}</div></section></div><button class="primary-action" type="submit">${icon('send')}SEND TRADE REQUEST</button></form>` : '<div class="empty-state">NO FRIENDS</div>'}<h3>TRADE HISTORY</h3>${state.trades.map(trade => `<div class="social-trade-history"><div><b>${trade.from === state.self.id ? 'OUTGOING' : 'INCOMING'} / ${escapeHtml(trade.status.toUpperCase())}</b><small>${escapeHtml(trade.offered.map(item => SKIN_BY_ID.get(item.skinId)!.name).join(', '))}${trade.requested.length ? ` / ${escapeHtml(trade.requested.map(item => SKIN_BY_ID.get(item.skinId)!.name).join(', '))}` : ''}</small></div>${trade.status === 'pending' ? trade.to === state.self.id ? `<button class="primary-action" data-trade-action="accept" data-trade-id="${trade.id}">${icon('check')}ACCEPT</button><button class="text-action" data-trade-action="decline" data-trade-id="${trade.id}">${icon('x')}DECLINE</button>` : `<button class="text-action" data-trade-action="cancel" data-trade-id="${trade.id}">${icon('x')}CANCEL</button>` : ''}</div>`).join('')}`;
    }
    if (state && this.tab === 'friend-profile') {
      const profile = [...state.friends, ...state.incoming, ...state.outgoing].find(person => person.id === this.target);
      if (profile) {
        const friend = state.friends.find(person => person.id === profile.id); const items = friend?.items || []; const pages = Math.max(1, Math.ceil(items.length / 24)); this.profilePage = Math.min(this.profilePage, pages - 1);
        body = `<div class="friend-profile-heading">${this.person(profile)}<div class="friend-profile-actions">${friend ? `<button class="primary-action" data-trade-friend="${profile.id}">${icon('arrow-left-right')}OFFER TRADE</button><button class="text-action" data-message-friend="${profile.id}">${icon('message-square')}MESSAGE</button><button class="text-action" data-duel-friend="${profile.id}" ${profile.online ? '' : 'disabled'}>${icon('crosshair')}1V1</button>` : ''}</div></div><div class="social-cloud-heading"><b>${items.reduce((sum, item) => sum + itemValue(item), 0).toLocaleString()} CR INVENTORY VALUE</b><span>${items.length} SKINS / NO CASH VALUE</span></div><div class="profile-inventory">${items.slice(this.profilePage * 24, this.profilePage * 24 + 24).map(item => { const skin = SKIN_BY_ID.get(item.skinId)!; return `<article><img data-profile-item="${escapeHtml(item.uid)}" width="180" height="90" alt="${escapeHtml(skin.name)}"><small>${WEAPONS[skin.weapon].name}</small><b>${escapeHtml(skin.name)}</b><span>${itemValue(item).toLocaleString()} CR</span></article>`; }).join('')}</div><div class="profile-pages"><button class="icon-button" data-profile-page="-1" title="Previous skins" ${this.profilePage ? '' : 'disabled'}>${icon('chevron-left')}</button><span>${this.profilePage + 1} / ${pages}</span><button class="icon-button" data-profile-page="1" title="Next skins" ${this.profilePage + 1 < pages ? '' : 'disabled'}>${icon('chevron-right')}</button></div>`;
      } else body = '<div class="empty-state">PROFILE UNAVAILABLE</div>';
    }
    if (state && this.tab === 'messages') {
      const friend = state.friends.find(profile => profile.id === this.target) || state.friends[0]; this.target = friend?.id || '';
      const messages = state.messages.filter(message => message.from === this.target || message.to === this.target);
      for (const message of messages) this.dismissed.add(message.id);
      body = friend ? `<label class="field-label">CONVERSATION<select id="social-message-friend">${state.friends.map(profile => `<option value="${profile.id}" ${profile.id === this.target ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')}</select></label><div class="direct-messages" role="log" aria-label="Direct messages">${messages.map(message => `<div class="direct-message ${message.from === state.self.id ? 'sent' : ''}"><small>${escapeHtml(message.from === state.self.id ? state.self.name : friend.name)} / ${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><p>${escapeHtml(message.text)}</p></div>`).join('')}</div><form id="social-message-form"><input id="social-message-content" aria-label="Message" maxlength="400" autocomplete="off" value="${escapeHtml(this.messageDraft)}" required><button class="primary-action" type="submit">${icon('send')}SEND</button></form>` : '<div class="empty-state">NO FRIENDS</div>';
    }
    if (state && this.tab === 'inventory') {
      const finishes = SKIN_CATALOG.filter(skin => skin.weapon === this.catalogWeapon);
      body = `<div class="social-cloud-heading"><b>${state.self.credits.toLocaleString()} CLOUD CR</b><span>${state.self.items.length} TRADABLE ITEMS</span></div><form id="social-buy-form" class="social-friend-form"><label class="field-label">WEAPON<select id="social-catalog-weapon">${Object.entries(WEAPONS).map(([id, weapon]) => `<option value="${id}" ${id === this.catalogWeapon ? 'selected' : ''}>${weapon.name}</option>`).join('')}</select></label><label class="field-label">FINISH<select id="social-catalog-finish">${finishes.map(skin => `<option value="${skin.id}">${escapeHtml(skin.name)} / ${Math.round(itemValue({ skinId: skin.id, seed: skin.seed, float: 0.06, statTrak: false, kills: 0 }) * 1.4).toLocaleString()} CR</option>`).join('')}</select></label><button class="primary-action" type="submit">${icon('shopping-cart')}ACQUIRE</button></form><div class="social-cloud-items">${state.self.items.map(item => { const skin = SKIN_BY_ID.get(item.skinId)!; return `<button class="social-cloud-item" data-cloud-equip="${escapeHtml(item.uid)}"><i style="background:${skin.colors[0]}"></i><span><b>${escapeHtml(skin.name)}</b><small>${WEAPONS[skin.weapon].name}${state.self.locked.includes(item.uid) ? ' / OFFERED' : ''}</small></span>${icon('check')}</button>`; }).join('')}</div>`;
    }
    if (state && this.tab === 'charms') body = `<div class="social-cloud-heading"><b>${state.self.credits.toLocaleString()} CLOUD CR</b><span>${state.self.charms.length} / ${CHARMS.length} CHARMS</span></div><div class="charm-case-list">${CHARM_CASES.map(crate => { const remaining = crate.charms.filter(id => !state.self.charms.includes(id)); return `<article class="charm-case"><div><i style="background:${crate.color}"></i><h3>${crate.name}</h3><span>${remaining.length} CHARMS REMAINING</span></div><button class="primary-action" data-cloud-charm-case="${crate.id}" ${!remaining.length || state.self.credits < crate.price ? 'disabled' : ''}>${icon('package')}${remaining.length ? `OPEN / ${crate.price} CR` : 'COLLECTION COMPLETE'}</button></article>`; }).join('')}</div>`;
    this.root.innerHTML = `<header class="social-header"><h2>PROFILE & FRIENDS</h2><button class="icon-button" data-social-close title="Close profile" aria-label="Close profile">${icon('x')}</button></header><nav class="social-tabs" aria-label="Social views">${[['profile', 'user-round', 'PROFILE'], ['friends', 'users', 'FRIENDS'], ['trades', 'arrow-left-right', 'TRADES'], ['inventory', 'package', 'CLOUD LOCKER'], ['charms', 'package', 'CHARM CASES']].map(([id, symbol, name]) => `<button data-social-tab="${id}" aria-pressed="${id === this.tab}">${icon(symbol)}${name}</button>`).join('')}</nav><div class="social-body">${body}</div><footer class="social-footer"><span id="social-status" role="status">${escapeHtml(this.status || 'CONNECTING')}</span><span>CLOUD ITEMS / NO CASH VALUE</span></footer>`; refreshIcons();
    if (state?.self.rank && this.tab === 'profile') this.root.querySelector('.social-profile-code')?.insertAdjacentHTML('afterend', `<div class="social-rank"><b>${escapeHtml(state.self.rank.name)}</b><span>${state.self.rank.rating} RATING / ${state.self.rank.wins} W / ${state.self.rank.losses} L</span></div>`);
    this.root.querySelector('.social-tabs')?.insertAdjacentHTML('beforeend', `<button data-social-tab="messages" aria-pressed="${this.tab === 'messages'}">${icon('message-square')}MESSAGES</button>`);
    const thread = this.root.querySelector('.direct-messages'); if (thread) thread.scrollTop = thread.scrollHeight;
    this.root.querySelectorAll<HTMLImageElement>('[data-profile-item]').forEach(image => this.profilePreviews.observe(image));
    if (messageFocus) { const input = this.root.querySelector<HTMLInputElement>('#social-message-content'); input?.focus(); input?.setSelectionRange(cursor, cursor); }
    this.renderNotifications(); refreshIcons();
  }

  private click(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button) return;
    if (button.hasAttribute('data-social-close')) { this.close(); return; }
    if (button.hasAttribute('data-social-connect')) { void this.connect().then(() => this.render()).catch(error => this.notice(error.message)); return; }
    if (button.dataset.socialTab) { this.tab = button.dataset.socialTab; this.render(); return; }
    if (button.dataset.viewProfile) { this.target = button.dataset.viewProfile; this.profilePage = 0; this.tab = 'friend-profile'; this.render(); return; }
    if (button.dataset.profilePage) { this.profilePage = Math.max(0, this.profilePage + Number(button.dataset.profilePage)); this.render(); return; }
    if (button.dataset.messageFriend) { this.target = button.dataset.messageFriend; this.messageDraft = ''; this.tab = 'messages'; this.render(); return; }
    if (button.dataset.duelFriend) this.send({ type: 'duel-invite', target: button.dataset.duelFriend });
    if (button.hasAttribute('data-copy-code') && this.state) { void navigator.clipboard.writeText(this.state.self.id).then(() => this.notice('FRIEND CODE COPIED')).catch(() => this.notice(this.state!.self.id)); return; }
    if (button.hasAttribute('data-avatar-remove')) { this.avatarDraft = ''; this.render(); return; }
    if (button.dataset.friendAccept || button.dataset.friendDecline) this.send({ type: 'friend-reply', target: button.dataset.friendAccept || button.dataset.friendDecline, accept: !!button.dataset.friendAccept });
    if (button.dataset.friendRemove) this.send({ type: 'friend-remove', target: button.dataset.friendRemove });
    if (button.dataset.tradeFriend) { this.target = button.dataset.tradeFriend; this.tab = 'trades'; this.offered.clear(); this.requested.clear(); this.render(); }
    if (button.dataset.tradeAction) this.send({ type: 'trade-reply', trade: button.dataset.tradeId, action: button.dataset.tradeAction });
    if (button.dataset.cloudEquip) { this.armory.equipOwned(button.dataset.cloudEquip); this.notice('EQUIPPED IN LOCKER'); }
    if (button.dataset.cloudCharmCase) this.send({ type: 'charm-case', case: button.dataset.cloudCharmCase });
  }
  private submit(event: SubmitEvent) {
    event.preventDefault(); const form = event.target as HTMLFormElement;
    if (form.id === 'social-profile-form') { this.send({ type: 'profile', name: this.root.querySelector<HTMLInputElement>('#social-profile-name')!.value, avatar: this.avatarDraft }); this.avatarDraft = undefined; }
    if (form.id === 'social-friend-form') this.send({ type: 'friend-request', target: this.root.querySelector<HTMLInputElement>('#social-friend-code')!.value.toUpperCase() });
    if (form.id === 'social-trade-form') { this.send({ type: 'trade-offer', target: this.target, give: [...this.offered], receive: [...this.requested] }); this.offered.clear(); this.requested.clear(); }
    if (form.id === 'social-buy-form') this.send({ type: 'buy-finish', skin: this.root.querySelector<HTMLSelectElement>('#social-catalog-finish')!.value });
    if (form.id === 'social-message-form') { const input = this.root.querySelector<HTMLInputElement>('#social-message-content')!; if (this.send({ type: 'direct-message', target: this.target, text: input.value })) { this.messageDraft = ''; input.value = ''; } }
  }
  private async change(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.dataset.tradeItem) { const selection = input.dataset.tradeItem === 'give' ? this.offered : this.requested; if (input.checked && selection.size >= 8) { input.checked = false; this.notice('EIGHT ITEMS MAXIMUM'); } else if (input.checked) selection.add(input.value); else selection.delete(input.value); }
    if (input.id === 'social-trade-friend') { this.target = input.value; this.requested.clear(); this.render(); }
    if (input.id === 'social-message-friend') { this.target = input.value; this.messageDraft = ''; this.render(); }
    if (input.id === 'social-catalog-weapon') { this.catalogWeapon = input.value as WeaponId; this.render(); }
    if (input.id === 'social-avatar-input') {
      const file = input.files?.[0]; if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5000000) { this.notice('USE A PNG, JPEG OR WEBP UNDER 5 MB'); return; }
      try {
        const image = await createImageBitmap(file); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; const context = canvas.getContext('2d')!;
        const side = Math.min(image.width, image.height); context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 128, 128); image.close();
        this.avatarDraft = canvas.toDataURL('image/webp', 0.8); this.render();
      } catch { this.notice('PROFILE PICTURE COULD NOT BE READ'); }
    }
  }
}