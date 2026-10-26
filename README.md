# BROWSERSTRIKE

A browser tactical FPS built with Three.js, TypeScript and a headless authoritative WebSocket server. Deployment offers Arena, Breeze, Dune, Rust, Zone 7 and Freight Yard with textures and triangle-mesh collision. Sandstone, Training Grounds, Outpost, Dust II Classic and the older procedural match arenas are excluded from deployment and random matchmaking. Training has its own purpose-built facility.

## Run locally

```sh
npm ci
npm run dev
```

Use Node.js 24. Open `http://localhost:5173` or the next Vite port shown in the terminal. Vite proxies `/ws` and the exact `/social` endpoint to the server on port `3001`. Solo and training run locally; online play, friends and trades need the server. Use a separate browser profile or incognito window to test a second social identity.

## Deployment

Choose **Online Multiplayer**, **Solo Gamemode** or **Aim Trainer** first. Each choice shows its own options, and the main deployment button starts the selected mode.

1. **Online Multiplayer:** choose Deathmatch, Bomb Defusal, King of the Hill, Gun Game or Ranked Competitive. **Public** finds a compatible room or creates one; **Private** creates/joins a six-character code. Ranked requires an authenticated profile and public matching. Public matching never enters private rooms. New rooms use a random deployed map. Bots fill to ten players and joining humans replace bots; accepted 1v1s are the exception, with two humans and no bots.
2. **Solo Gamemode:** choose an arena, easy/normal/hard bots, and **5v5 Elimination**, **Bomb Defusal**, **King of the Hill** or **Gun Game**, then select **Deploy Solo**. Team modes place you on CT; Gun Game is free-for-all. Elimination ends at five round wins. Defusal alternates bomb and elimination rounds over exactly four rounds, including a possible 2-2 draw.
3. **Aim Trainer:** select **Timed Target Drill** or **Recoil Range**, difficulty and a starting weapon, then select **Start Training**. Both use the dedicated practice facility and allow weapon switching during play. Drills last 60 seconds and track score, accuracy, targets, streak and response. Recoil Range has **no time limit**, unlimited ammunition, persistent bullet impacts, 10/20/30/40-metre target settings, moving and armored targets, selectable target health, and damage feedback. Targets never shoot back. Reset the target/impacts independently or restart the whole session.

Solo and training do not need a multiplayer server. Bots spawn in compact groups, then receive unique rotating route lanes, reserve paths against friendly plans and choose separated approach positions. They begin local avoidance within 2.5 metres. The planner uses different corridors when alternatives exist; unavoidable narrow passages can still be shared with spacing. Entry/support/anchor roles spread pursuit and defend objectives; only one CT approaches a planted bomb to defuse while others cover. Ally-only blue (CT) or red (T) contours appear only where opaque cover blocks them. Visible teammates and enemies do not receive the effect, and interiors are not filled. Breeze teams start in separated architectural regions; Dune starts are selected from enclosed playable architecture. Bot traversal and full-squad overlap are tested with the actual movement controller.

After winning or losing a solo elimination match, the winning team's five-player lineup appears in a V with its best player at the centre. Choose **Play Again** or **Back to Lobby**.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim while the pointer is captured |
| W / A / S / D | Move forward / left / backward / right |
| Shift | No sprint boost; movement is shared and bounded |
| Ctrl (hold) | Crouch |
| Space | Jump |
| Left click | Fire the equipped gun or slash with the knife |
| Right click or Q | Toggle the equipped optic; firing and releasing the button do not cancel it |
| 1 | Equip a primary weapon; repeat to cycle owned weapons in that slot |
| 2 | Equip a pistol; repeat to cycle owned weapons in that slot |
| 3 | Equip a sniper; repeat to cycle owned weapons in that slot |
| 4 | Equip the knife |
| Mouse wheel | Cycle all owned weapons |
| R | Reload |
| F | Inspect the equipped weapon |
| B | Open or close the match shop |
| G | Throw an owned HE grenade |
| V | Throw an owned flashbang |
| C | Throw an owned smoke grenade |
| Z | Throw an owned incendiary |
| H | Drop the equipped firearm |
| E | Pick up a nearby dropped gun |
| E (hold, near the objective) | Plant C4 as its T carrier, or defuse as CT |
| Tab (hold) | Show the scoreboard |
| Y | Open room chat; Enter sends the message |
| Escape | Release the pointer or close an open menu/chat |

Click the arena or **Resume** to capture the pointer. Movement, firing and bomb interaction require it. Use **Leave** to return to deployment. Open **Settings** to adjust mouse sensitivity, graphics and the crosshair; use the speaker button to mute or unmute.

Player chat also appears in short-lived popups at the middle-left, including in local practice. Up to four messages remain visible at once; the full recent log remains in the chat panel.

Normal movement is 4.8 m/s, crouching 2.3 m/s and scoped movement 2.6 m/s. Sprint flags cannot increase speed. Timed chained hops and air strafing preserve bounded momentum up to 7.2 m/s; ground movement sheds it. Movement and airborne shots have more spread; a stationary scoped sniper follows the crosshair. These are this game's rules, not identical CS2 physics. Input is sampled separately from rendering at 64 Hz; short fire presses survive slow rendering.

**Trackpad scoping:** capture the pointer and tap **Q** or right click once. Release and fire while remaining scoped; tap again to unscope. The Aster-5 has a 1.5x chevron, Scout-5 a 3x mil-dot, DMR-20 a 3.5x duplex, Longbow a 5x crosshair and M-50 a 7x mil-dot. Magnification respects the configured base FOV. Scope clears on weapon changes, menus, pointer release, window blur and death.

## Purchases And Equipment

Humans start matches with a pistol and knife. The shop opens on deployment and each round. Purchases are allowed for the first **25 seconds**, within 10 metres horizontally and 2.5 metres vertically of a team start. The HUD and shop show the countdown. Round modes have a **15-second freeze**, followed by 115 seconds of live play. Close the shop with **B**, its close button or **Escape** before resuming play.

Carry **one primary** (including sniper, shotgun, SMG or support gun), **one secondary**, **one knife**, and **three utility items combined**. Buying or picking up another weapon in the same slot drops the old one. Dropped guns fall, bounce and settle against collision; pickups retain ammunition and appearance. Buying an already-owned gun does not refill it. Training is exempt from the weapon-slot limit so every gun can be tested.

Match money buys equipment; persistent credits buy cosmetics. A cosmetic does not grant its weapon in a match. Kill rewards vary by weapon, and consecutive round losses pay $1,400, $1,900, $2,400, $2,900 and $3,400. Full local cosmetic rewards come from solo elimination and multiplayer; training kills give only 5 local credits. Authenticated multiplayer events also award server-owned cloud credits. Offline/browser-generated items cannot be imported into the tradable cloud inventory.

- **HE grenade:** $300, carry limit one. Press **G** to throw. Grenades bounce, detonate on a fuse and respect blast-blocking walls. Teammates are protected from damage, but the thrower is not.
- **Flashbang:** $200, carry limit two. Press **V** to throw. Flashes affect teammates too; looking away reduces their effect.
- **Smoke grenade:** $300, carry limit one. Press **C**. Voxel smoke respects walls, blocks bot sight and temporarily opens along bullet/explosion paths.
- **Incendiary:** $400, carry limit one. Press **Z**. Fire follows nearby floors, applies ticking damage and is avoided by bots.
- **Armor:** $650. Absorbs part of incoming damage.
- **CT defuse kit:** $400, available only to CT in Bomb Defusal. Reduces defusal from ten seconds to five. C4 is assigned to one T at round start; it is not an extra purchasable bomb kit.

## Bomb Defusal

Casual defusal lasts exactly four rounds: bomb, elimination, bomb, elimination. A 2-2 result is a draw; there is no automatic fifth round. Bots use the same plant/defuse inputs as humans and cover the designated defuser. A/B sites are separate, reachable locations.

As the T bomb carrier, stand still and grounded at A or B and hold **E** for 3.5 seconds to plant. A living T can recover dropped C4. As CT, approach the planted bomb and hold **E** for ten seconds, or five with a defuse kit. Releasing the key, moving or dying interrupts progress.

The live round lasts 115 seconds, and a planted bomb has its own 40-second fuse. Eliminating the T team does not stop an already-planted bomb: CT must still defuse it. Dead players wait until the next round.

## Hill, Gun Game And Ranked

**King of the Hill:** occupy the highlighted circle to accumulate 250 seconds of team control. Multiple teammates do not multiply the timer; empty or contested areas pause it. Both totals and ownership appear above the match view. Players respawn.

**Gun Game:** a five-minute free-for-all with twenty weapon tiers. A kill with the required tier weapon advances it and restores that weapon's ammunition. A final-tier kill wins immediately; timeout compares tier, match kills, then fewer deaths. Respawns preserve progress, and purchases/pickups/drops cannot bypass progression.

**Ranked Competitive:** bomb rounds, first to five, using eighteen classic ranks from Silver I through The Global Elite. The server owns rating, performance-derived skill and results. Humans only share a ranked room when their rank is identical, rating difference is at most 80 and skill difference at most 100; the window never widens. Bots react faster and aim more accurately at higher ranks. Duplicate active ranked sessions are rejected; results apply once and leaving an unfinished ranked match counts as a loss. These are this game's Elo-style rules, not Valve's ranking algorithm.

## Locker And Inspection

Open the **Locker** from deployment to equip owned finishes, or open the armory to browse finishes and cases. There are **718 generated finishes per firearm** and **at least 712 per knife type**, with seed, wear and optional StatTrak. Seven signature families add circuit, glyph, contour, fracture, spectral, aurora and ceramic artwork. Rare finishes use near-full visible paint coverage while preserving normal/roughness detail. These are generated finishes, not official CS skins. Existing inventory IDs are preserved. New profiles receive a plain field karambit; decorated knives are unlockable.

In the locker inspector, drag to rotate, scroll or use the zoom icons, and use the play icon for inspection. In a match, press **F** to inspect. Supplied authored gun animations are used where available; static guns and SAS locomotion use generated motion and hand IK, not native CS2 animation clips.

The **Charms** inventory contains 325 collectibles in twenty forms. Select an owned charm, choose an owned weapon in the popup, review its rendered attachment preview, then Apply. The inspector's charm selector remains available. Charm cases are separate from weapon cases, use their respective local/cloud credits, never consume weapon-case keys and stop charging when their collection is complete.

Weapon and local charm cases have rotatable **3D case previews** before confirmation. Classified/Covert/Rare Special rewards first appear as a gold **? / Rare Vault**, then reveal the already-awarded item in a second reel. Both stages can be skipped. There is one charge and one outcome, not an extra paid roll; published odds and charm duplicate protection are unchanged. Skins, credits and charms have no cash value. Wear/seed produce reproducible scratches; pristine items do not receive wear marks. World/preview/dropped models omit first-person arms/backgrounds.

The DMR uses a corrected forward-axis calibration. First-person HC-45 uses the original textured handcannon model, native arms and its complete 2.75-second authored equip spin; firing can interrupt the draw. Third-person/dropped models remain arm-free. Knives use a relaxed knife-specific grip rather than rifle support hands, with alternating attacks and a thrust. The karambit's inspect rotates about its finger-ring pivot, catches, reverses and returns to the original grip.

## Profiles, Friends And Trades

Open the profile icon in the top bar. The first connection creates a server-owned profile with credentials stored in that browser for the selected server. Change the display name and upload a PNG, JPEG or WebP picture under 5 MB; the server validates and converts it to a 128-pixel WebP avatar. Clearing browser storage loses access to that identity; there is no email/password recovery system.

Use **Friends** to copy/share the 12-character friend code, send a request, accept/decline requests, see presence or remove a friend. A six-character private match code is not a friend code.

In **Trades**, select an accepted friend, offer up to eight server-owned items and optionally request up to eight of theirs. The recipient must explicitly accept. Outgoing offers lock their offered items for up to 15 minutes. Requests can be declined or cancelled; expired, stale, spoofed or replayed trades cannot transfer items. Editing a requested item's charm cancels the stale offer, and locked offered items cannot be edited. Transfers conserve the original item IDs.

The **Cloud Locker** has a separate server-owned credit balance and inventory. Equip cloud items in the normal locker or acquire new cloud finishes there. Existing local items remain available but are not tradable: browser storage cannot prove ownership to another player. Items and credits have no cash value. Credentials are not published with friend lists or trade states.

Click a friend's name for their skin inventory, per-item values, total credit value and rank. Accepted friends can exchange private messages, with bounded history and rate limits. A 1v1 request appears at the top right across screens with Accept/Decline. It expires after sixty seconds. Acceptance reserves a private room for those two authenticated accounts, waits for both, adds no bots and plays first to three; leaving an active duel forfeits it. Trade notifications open explicit offer review before acceptance.

See [PLAY.md](PLAY.md) for round, defusal and training details.

## Models And References

Place source model archives in the existing `model-imports/` inbox. Prefer **GLB** with embedded textures, a clean rest pose, named bones and animation clips. A ZIP containing a complete glTF scene, its binary buffers, textures and license also works. A loose glTF file without its dependencies is not enough. Convert other formats to GLB before adding them to the import pipeline; the bundled shotgun's FBX loader is a specific fallback, not a general FBX archive converter.

```sh
npm run models:import
npm run models:collision
```

Use `-- --only=asset-id` to process configured assets. The scripts do not infer gameplay mappings for arbitrary new archives. Collision generation selects connected architectural floors, grouped starts and separated sites. Dune's source geometry is preserved, but navigation/spawns were regenerated. Removed map sources and credits remain archived; they are not offered for play. New downloaded maps are not enabled without floor, spawn, route, traversal and rendering review. A checked external starter kit contained modular pieces, not a complete tactical arena, so it was not added as a ready-to-play map.

Runtime models are in `client/public/models/imported/`; see [MODEL-CREDITS.md](MODEL-CREDITS.md) and the included license texts. Several uploaded archives do not include a license, and some external references have non-commercial or third-party ownership restrictions. Their presence here is **not** permission to redistribute them. Use verified CC0 assets, or CC BY assets with the required attribution, for a public release. Source upload archives are excluded from Git; retain your own originals.

SAS bodies supply player/bot meshes. Matching authored first-person rigs are used where supplied; fallback grips distinguish pistols from rifles. Per-asset orientation and background removal prevent reversed barrels and showcase-room silhouettes. The downloaded [Quaternius revolver license](client/public/models/quaternius-revolver-license.txt) documents the CC0 model and its native fire/reload clips. Missing action clips still use approximate procedural motion; not every upload contains separable gameplay actions.

Additional supplied CC-BY Benelli M4 and pistol rigs retain native hands and named idle/fire/full-reload clips; legacy specular/gloss materials are converted during import. The newly downloaded CC0 RobotExpressive is selectable under Operator and appears among bots, with native idle/walk/run/death actions. Freight Yard uses the supplied ResoForge map with verified CC-BY attribution and generated collision/navigation; it passed physical traversal and a live gameplay-frame check. See the generated credits for authors and modifications.

The requested [Gun Muzzle Flash Effect](https://sketchfab.com/3d-models/gun-muzzle-flash-effect-6f76376918f8448db750b92958386d5a) is marked non-downloadable under a Standard license. Its protected viewer files were not extracted. The game instead uses an original textured hot-core/starburst effect, crossed flame planes, per-weapon sizing and muzzle sockets. A licensed GLB upload can be integrated through the existing asset workflow. Other Sketchfab downloads also require authorized access; supplied licensed archives were reused rather than bypassing that requirement.

The [reference inbox](reference-videos/README.md) contains the supplied clips plus an author animation preview and short official CS2 technical excerpts. [External source notes](reference-videos/EXTERNAL-SOURCES.md) record creators, sources and what was actually sampled. Videos are ignored by Git and not bundled as game assets. Extracted frames were used for draw/hold framing and presentation, not to claim full-video review or frame-accurate reproduction.

## Deploy

The browser client is static and deploys to Vercel. The authoritative WebSocket server needs a persistent Node host such as Render or Railway; Vercel serverless functions do not support persistent WebSocket connections.

1. Deploy this repository to Render using the included `render.yaml` blueprint, or create a Node web service with build command `npm ci` and start command `npm start`.
2. Set `ALLOWED_ORIGINS` on the game server to the exact Vercel origin, for example `https://browserstrike.vercel.app`. Set the server's `PORT` through the host environment (Render supplies this automatically).
3. Import the same repository into Vercel. The included `vercel.json` builds and serves `dist/`. Optionally set `VITE_SERVER_URL` in Vercel's project environment variables to your `wss://.../ws` endpoint and redeploy; otherwise enter the endpoint under **Server address** in the lobby.
4. Use **Public** for automatic multiplayer or **Private** to share a room code. Profiles use the same host at `/social`.

The server exposes `GET /health` for host health checks. For local play, leave the server address blank. `npm run preview` serves the built client only; set **Server address** to the local or hosted WebSocket endpoint when testing multiplayer through preview.

For Vercel multiplayer, players must use the same persistent WebSocket server; only private matches require a shared code. Vercel alone can run solo/training, not authoritative rooms or social storage. If joining fails, check `/health`, `wss://.../ws` and `ALLOWED_ORIGINS`. Changing build-time `VITE_SERVER_URL` requires a redeploy.

**Durable profiles:** set the server's `SOCIAL_STORE_PATH` to a JSON file on persistent storage. The default local store is under the ignored server data directory. Free ephemeral hosts can lose profiles on restart/redeploy; mount durable storage before relying on friends or trades. This file store supports one server process, not multiple independent replicas. Treat browser profile credentials as secrets, back up the store and never commit it.

### Vercel Checklist

1. Ensure the intended changes and runtime assets are committed and pushed to the repository. A Git-linked Vercel deployment cannot see uncommitted Codespaces files. Do not include source ZIPs, reference videos, profile data or credentials. Verify model redistribution rights before making the deployment public.
2. Start the persistent Node server on Render/Railway with `npm ci` and `npm start`; confirm `https://YOUR-SERVER/health` returns `ok: true`. Use persistent storage for profiles/trades.
3. In [Vercel New Project](https://vercel.com/new), import `Anonymmoouuss/CSAny`, keep the repository root, choose Vite, build with `npm run build`, and use `dist` as the output directory. The existing configuration supplies these defaults.
4. Set Vercel's production environment variable `VITE_SERVER_URL=wss://YOUR-SERVER/ws` before building. This address is public client configuration, not an API secret. Deploy after setting it.
5. Set the Node server's `ALLOWED_ORIGINS=https://YOUR-PROJECT.vercel.app` to the exact deployed client origin and restart the server. Add exact preview/custom origins separately when needed; do not substitute a broad wildcard.
6. Test Public matchmaking in two independent browsers, a Private room code, the `/social` profile connection and a local solo/range session from the deployed URL. Changing `VITE_SERVER_URL` requires a Vercel redeploy.

The linked Vercel project was renamed **counterstrikebrowser**, and [counterstrikebrowser.vercel.app](https://counterstrikebrowser.vercel.app) was assigned to its existing production deployment on 2026-10-26. This alias change did not publish the new local build. Deploy the committed revision to publish these features and configure the persistent WebSocket host and exact allowed origin. Never paste login tokens into chat.

## Networking And Combat

The server simulates at 64 Hz and broadcasts 20 Hz snapshots. Compact binary input commands preserve fractional-millisecond timestamps; prediction/reconciliation and interpolated one-second hitbox history reduce latency effects. Server rewind is capped at 250 ms and rejects teleport interpolation. Browsers use WebSockets, not arbitrary UDP; zero latency and immunity to behind-cover deaths are not promised.

Shotguns fire twelve spread pellets per shell. Weapon-specific recoil, range falloff, armor and hit regions affect damage. Penetration can cross up to four surfaces while losing energy; source material names are classified as wood, drywall, concrete, steel or glass, so this is an approximation, not verified CS2 material data.

## Project layout

- [client/main.ts](client/main.ts): deployment, controls and HUD.
- [client/assets.ts](client/assets.ts): imported models, animation and SAS rig handling.
- [server/game.ts](server/game.ts): authoritative rooms and 20 Hz state broadcasts.
- [shared/game.ts](shared/game.ts): movement, weapons and hitboxes.
- [shared/round.ts](shared/round.ts): rounds, purchases and bomb rules.
- [shared/equipment.ts](shared/equipment.ts): grenade and flash simulation.
- [shared/training.ts](shared/training.ts): training targets and scoring.
- [shared/protocol.ts](shared/protocol.ts): binary input and hitbox history.
- [shared/combat.ts](shared/combat.ts): common solo/server ballistics.
- [server/social.ts](server/social.ts): authenticated profiles and atomic trades.
- [client/social.ts](client/social.ts): profiles, friends and cloud locker.
- [tests/](tests/game.test.ts): simulation, assets, economy and real WebSocket tests.

## Verify

```sh
npm test
npm run build
npm run test:browser
```

Start `npm run dev` before the browser suite. Install Playwright Chromium and its OS libraries first; use `BROWSERSTRIKE_URL` to target another running client. The suite includes desktop/mobile layout, canvas pixels, locker transactions, scope locking, training and two-client rooms.

Use `BROWSERSTRIKE_CHROMIUM_EXECUTABLE` to select a full Chromium executable when the default headless shell is unreliable.

**Verification status:** 107 automated simulation/asset/economy/social/real-socket tests and the production build passed. Targeted Chromium checks passed for desktop/mobile 3D case interaction, two-stage rare transactions, charm-to-weapon preview/application, distinct live scope controls, Freight Yard gameplay frames and Hill/Gun Game HUDs. The covered-ally pixel regression and earlier focused rendering checks remain in the suite. Heavy HC-45 inventory and two-browser inventory/map-transition stress still crash this container's software GPU; the complete browser suite is not claimed green. Geometry tests cover all enabled map floors, grouped starts, separated sites and actual bot traversal. Hardware/browser testing remains necessary before a production release.
