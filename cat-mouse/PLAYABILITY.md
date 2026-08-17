# Playability checklist — Cat & Mouse: Chase Protocol

This is a verification list. Gameplay rules live in [SPEC.md](./SPEC.md); do not treat this file as a rules rewrite.

Automated coverage: `tests/playability.test.ts` (Stage 1 quota, cat spawn, hole, tile dimensions). Engine unit tests live under `tests/engine/`.

## Commands

- [ ] `npm install`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run linecount` (src + tests TypeScript)
- [ ] `npm run dev` serves a canvas at the title

## Boot path

- [ ] Title screen renders
- [ ] Mode select exposes story, arcade, timeAttack, mirror, hotseat, sandbox
- [ ] Story chapter map opens
- [ ] Title → Story → Stage 1 is reachable from the keyboard

## Controls (from SPEC)

- [ ] WASD / arrows move
- [ ] Shift sneak (slower, quieter, smaller scent)
- [ ] Space dash (stamina)
- [ ] E interact (hole, switch, steal cheese, drop decoy)
- [ ] Q drop crumb decoy when inventory allows
- [ ] F use held power-up
- [ ] Esc pause
- [ ] M mute
- [ ] All UI screens are keyboard-reachable

## Stage 1 structure

- [ ] Stage 1 definition exists (story, chapter 1, index 1)
- [ ] `quota > 0`
- [ ] At least one `cat` spawn
- [ ] At least one hole (entity and/or `o` tile)
- [ ] `tiles.length === height` and each row length equals `width`

## Hunt loop

- [ ] Cheese can be stolen
- [ ] Cheese can be deposited in a hole
- [ ] Depositing the quota wins the stage
- [ ] Cat hunts (sight, hearing, or scent leads to chase)
- [ ] Catch overlaps the mouse while not invulnerable
- [ ] Three catches exhaust lives and lose the stage
- [ ] Respawn at last hole / start after a catch

## Quality bar (SPEC)

- [ ] Cat hunts; mouse can sneak, dash, steal, deposit
- [ ] No `TODO: implement later` in shipped systems
- [ ] No duplicated files whose only difference is a renamed constant
- [ ] Generated content varies in layout, theme, and AI hints
