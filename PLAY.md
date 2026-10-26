# PLAY

## Join a match

Choose **Online Multiplayer**, **Solo** or **Aim Trainer**. Online **Public** finds a match automatically; **Private** creates or joins a six-character room code. Select Deathmatch or Bomb Defusal. New rooms use random deployed maps, bots fill both five-player teams, and joining humans replace bots. Public matching never joins a private room.

The playable match maps are Arena, Breeze, Dune, Rust, Zone 7 and Freight Yard. Sandstone, Training Grounds, Outpost and Dust II Classic are disabled. Operator selection offers the field operator or a downloaded CC0 robot with native animations.

For **Solo**, select an arena, bot difficulty and 5v5 Elimination or Bomb Defusal. You join CT with four teammates against five T opponents. Elimination has no mid-round respawns and ends at five round wins. The result screen shows the winning team's V lineup with its MVP in the centre; choose Play Again or Back to Lobby.

**Aim Trainer** uses the dedicated Practice Facility. Choose a 60-second target drill or an untimed Recoil Range, then choose difficulty and weapon. The in-session weapon selector and normal weapon keys work throughout training. Ammunition is unlimited and targets never shoot back. Range target settings control distance, movement, armor and health; Reset Target also clears bullet marks. The restart icon resets the full session.

Expand **Server address** for a hosted `wss://.../ws` endpoint. Local development uses the current host automatically. Solo and training do not require a server connection.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim |
| Left click | Fire |
| Right click or Q | Toggle sniper scope; firing and mouse release do not cancel it |
| WASD | Move |
| Shift | No sprint boost |
| Ctrl | Crouch |
| Space | Jump |
| 1 / 2 / 3 / 4 | Rifle / pistol / sniper / knife |
| R | Reload |
| F | Inspect weapon |
| B | Open or close arsenal |
| G | Throw HE grenade |
| V | Throw flashbang |
| C | Throw smoke |
| Z | Throw incendiary |
| H | Drop equipped firearm |
| E | Pick up a nearby dropped gun; hold near C4/site to plant or defuse |
| Mouse wheel | Cycle owned weapons |
| Tab | Hold to show scoreboard |
| Y | Open room chat |
| Escape | Release the mouse |

Click the game view or **Resume** to capture the mouse. **Escape** releases it. Scope also clears on weapon changes, menus, window blur and death. Click **Leave** to return to the lobby. The locker inspector supports drag rotation, scroll/icon zoom, an inspection play button and automatic rotation.

Walking is 4.8 m/s, crouching 2.3 m/s and scoped movement 2.6 m/s. There is no sprint boost; chained hops and air strafing have a 7.2 m/s cap. Moving/jumping increase inaccuracy. Scoped Aster-5, Scout, DMR, Longbow and M-50 use different reticles and 1.5x/3x/3.5x/5x/7x magnification. Short clicks survive slow rendering. Ally contours appear only behind cover. Bots reserve paths, rotate lanes and keep local spacing.

Press **Y** and Enter to send chat. Player messages also appear as short-lived middle-left popups in matches and practice; open chat for the recent log.

## Match Supply

You deploy with a pistol and knife, even when your locker has rifle/sniper cosmetics equipped. The shop opens for the first **25 seconds of each round**, near team starts. Leaving the area or letting the timer expire blocks purchases on client and server. Round modes freeze movement for **15 seconds**.

Carry one primary, one secondary, one knife and three utility items combined. Buying or picking up another gun in a slot drops the previous one. Guns fall/bounce/settle and preserve ammo and appearance when picked up. Training allows all weapons.

Buy HE for $300 (limit one), flash for $200 (limit two), smoke for $300 (limit one), incendiary for $400 (limit one), armor for $650 or a $400 CT defuse kit in Bomb Defusal only. Match money is separate from cosmetic credits; a skin does not grant a match weapon. Solo elimination and multiplayer give full cosmetic rewards; training kills give only 5 local credits.

## Defusal

Casual defusal is exactly four rounds: bomb, elimination, bomb, elimination. A 2-2 result is a draw. Bots can plant and defuse through the same rules as humans, with separate reachable A/B sites.

One living T player carries C4. Hold **E** while stationary and grounded at A or B for 3.5 seconds to plant it. Releasing the key, moving or dying interrupts progress. A dropped bomb can be recovered by a living T player.

The planted fuse lasts 40 seconds. A CT near the bomb holds **E** for ten seconds to defuse, or five seconds with a kit. The bomb remains active after T elimination; CT must still defuse it. The round timer is 115 seconds after preparation, but a planted bomb uses its own countdown. A CT joining a live round waits until the next round, as does a joining T.

## Combat And Finishes

**King of the Hill:** hold the highlighted area for 250 accumulated seconds. Empty/contested time does not count, and extra teammates do not multiply it. Both team timers appear above the match.

**Gun Game:** five-minute free-for-all, twenty weapon tiers, one required-weapon kill per advance. A final-tier kill wins; timeout uses highest tier, most kills, then fewer deaths. Respawns retain progress; buying/picking up guns cannot skip tiers.

**Ranked:** authenticated public bomb matches, first to five, eighteen classic ranks. Humans must have the same rank and fit strict server-owned rating/skill windows. Bots scale with rank. Results apply once; leaving an unfinished ranked match counts as a loss.

Deathmatch respawns automatically; solo elimination and defusal do not. Headshots deal four times weapon damage, limb hits 75%, and armor absorbs part of the damage. Standing still improves accuracy. Sniper scope stays locked so a trackpad user can release right click and fire with left click or use **Q** instead.

Knife attacks are short-range sweeps with a separate slash animation and sound, not firearm shots. They do not consume ammunition or create gun tracers, shells, muzzle flashes or firearm recoil. HE grenades bounce and damage nearby enemies or the thrower when walls do not block the blast. Flashbangs affect anyone in range with line of sight; facing away reduces their strength.

The locker has 718 generated finishes per firearm and at least 712 per knife type, with pattern seed, wear and optional StatTrak. Signature circuit/glyph/contour/fracture/spectral/aurora/ceramic artwork and stronger coverage make rare finishes visibly different. New profiles start with a plain field karambit. Inspect with **F** or the locker viewer. Authored clips are used where supplied; missing clips are approximated, not native CS2 animations.

HC-45 uses the original first-person model and complete authored equip spin. Knives have a relaxed one-handed hold; karambit inspection spins about the finger ring, catches, reverses and returns to the same grip.

Cases have a rotatable 3D preview before confirmation. High-tier rewards land on a gold question mark, then reveal the already-awarded item in a rare-vault reel. Skip only shortens animation: it never rerolls or charges again. Odds remain visible and all rewards have no cash value.

Unlock charms from their separate cases. In **Charms**, select one of your owned collectibles, choose an owned weapon in the popup, review the attachment preview and Apply. The inspector selector also works. Charm cases never drop guns or consume weapon-case keys, and completed collections cannot be charged again. Local/cloud cases use their respective balances. Wear adds reproducible scratches; knives have alternating slashes, a thrust and reversible inspection spins. Smoke blocks bot sight, fire follows floors, and shotguns fire twelve pellets per shell.

## Profiles And Trades

Open the profile icon for a display name, custom profile picture, Friends, Trades and Cloud Locker. Share the 12-character friend code and accept requests before trading. Choose items to offer/request, then wait for the recipient's explicit acceptance. Offers lock the sender's items and expire after 15 minutes; either side can decline/cancel as appropriate. Cloud items can be equipped from the locker; local-only items cannot be traded because browser storage is not proof of ownership.

Custom PNG/JPEG/WebP pictures are resized and validated by the server. Credentials live in this browser for the selected server; clearing browser storage loses that identity. Hosting needs a persistent server data file to retain profiles. See [README.md](README.md) for storage, deployment and verification limits.

Click a friend's name to see skins, credit values and rank, or send a private message. 1v1 requests appear at the top right across screens and expire after sixty seconds. Accept/Decline controls reserve a two-account room on acceptance, with no bots and first to three round wins. Leaving an active duel forfeits it.

## Reference Files

Upload complete GLB files or configured glTF/texture ZIPs through the existing `model-imports/` inbox. Include licenses. Put permitted gameplay clips and source/timestamp notes in [reference-videos/](reference-videos/README.md). MP4/H.264 or WebM is preferred; large videos are excluded from Git and deployment. See [README.md](README.md) for import commands, hosting and the current browser-validation limitation.