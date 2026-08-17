import type { StageDef } from './schema';
import ch01_s01_crumb_trail from './stages/story/ch01-s01-crumb-trail';
import ch01_s02_breadbox_heist from './stages/story/ch01-s02-breadbox-heist';
import ch01_s03_midnight_fridge from './stages/story/ch01-s03-midnight-fridge';
import ch01_s04_sink_island from './stages/story/ch01-s04-sink-island';
import ch01_s05_spice_rack from './stages/story/ch01-s05-spice-rack';
import ch01_s06_oven_warmth from './stages/story/ch01-s06-oven-warmth';
import ch01_s07_dishwasher_hum from './stages/story/ch01-s07-dishwasher-hum';
import ch01_s08_gran_returns from './stages/story/ch01-s08-gran-returns';
import ch02_s01_wine_rows from './stages/story/ch02-s01-wine-rows';
import ch02_s02_coal_chute from './stages/story/ch02-s02-coal-chute';
import ch02_s03_root_cellar from './stages/story/ch02-s03-root-cellar';
import ch02_s04_furnace_glow from './stages/story/ch02-s04-furnace-glow';
import ch02_s05_jar_shelf from './stages/story/ch02-s05-jar-shelf';
import ch02_s06_flooded_sump from './stages/story/ch02-s06-flooded-sump';
import ch02_s07_rafter_run from './stages/story/ch02-s07-rafter-run';
import ch02_s08_locked_hatch from './stages/story/ch02-s08-locked-hatch';
import ch03_s01_dumpster_row from './stages/story/ch03-s01-dumpster-row';
import ch03_s02_fire_escape from './stages/story/ch03-s02-fire-escape';
import ch03_s03_wet_bricks from './stages/story/ch03-s03-wet-bricks';
import ch03_s04_neon_puddle from './stages/story/ch03-s04-neon-puddle';
import ch03_s05_loading_dock from './stages/story/ch03-s05-loading-dock';
import ch03_s06_chain_link from './stages/story/ch03-s06-chain-link';
import ch03_s07_stray_circle from './stages/story/ch03-s07-stray-circle';
import ch03_s08_rooftop_leap from './stages/story/ch03-s08-rooftop-leap';
import ch04_s01_pipe_crawl from './stages/story/ch04-s01-pipe-crawl';
import ch04_s02_grate_gallery from './stages/story/ch04-s02-grate-gallery';
import ch04_s03_overflow_gate from './stages/story/ch04-s03-overflow-gate';
import ch04_s04_echo_tunnel from './stages/story/ch04-s04-echo-tunnel';
import ch04_s05_maintenance_walk from './stages/story/ch04-s05-maintenance-walk';
import ch04_s06_sludge_bend from './stages/story/ch04-s06-sludge-bend';
import ch04_s07_pump_room from './stages/story/ch04-s07-pump-room';
import ch04_s08_outflow_door from './stages/story/ch04-s08-outflow-door';
import ch05_s01_trunk_maze from './stages/story/ch05-s01-trunk-maze';
import ch05_s02_insulation_sea from './stages/story/ch05-s02-insulation-sea';
import ch05_s03_dormer_window from './stages/story/ch05-s03-dormer-window';
import ch05_s04_hatbox_stack from './stages/story/ch05-s04-hatbox-stack';
import ch05_s05_chimney_nook from './stages/story/ch05-s05-chimney-nook';
import ch05_s06_loose_board from './stages/story/ch05-s06-loose-board';
import ch05_s07_owl_rafter from './stages/story/ch05-s07-owl-rafter';
import ch05_s08_widow_walk from './stages/story/ch05-s08-widow-walk';
import ch06_s01_ticket_booth from './stages/story/ch06-s01-ticket-booth';
import ch06_s02_bumper_floor from './stages/story/ch06-s02-bumper-floor';
import ch06_s03_cotton_stall from './stages/story/ch06-s03-cotton-stall';
import ch06_s04_hall_of_mirrors from './stages/story/ch06-s04-hall-of-mirrors';
import ch06_s05_ferris_shadow from './stages/story/ch06-s05-ferris-shadow';
import ch06_s06_ring_toss from './stages/story/ch06-s06-ring-toss';
import ch06_s07_funhouse_tilt from './stages/story/ch06-s07-funhouse-tilt';
import ch06_s08_prize_tent from './stages/story/ch06-s08-prize-tent';
import ch07_s01_marble_foyer from './stages/story/ch07-s01-marble-foyer';
import ch07_s02_armor_hall from './stages/story/ch07-s02-armor-hall';
import ch07_s03_vase_wing from './stages/story/ch07-s03-vase-wing';
import ch07_s04_night_watch from './stages/story/ch07-s04-night-watch';
import ch07_s05_fossil_pit from './stages/story/ch07-s05-fossil-pit';
import ch07_s06_portrait_gaze from './stages/story/ch07-s06-portrait-gaze';
import ch07_s07_skydome from './stages/story/ch07-s07-skydome';
import ch07_s08_archive_vault from './stages/story/ch07-s08-archive-vault';
import ch08_s01_platform_edge from './stages/story/ch08-s01-platform-edge';
import ch08_s02_turnstile_jam from './stages/story/ch08-s02-turnstile-jam';
import ch08_s03_bench_row from './stages/story/ch08-s03-bench-row';
import ch08_s04_third_rail from './stages/story/ch08-s04-third-rail';
import ch08_s05_service_tunnel from './stages/story/ch08-s05-service-tunnel';
import ch08_s06_map_kiosk from './stages/story/ch08-s06-map-kiosk';
import ch08_s07_lost_and_found from './stages/story/ch08-s07-lost-and-found';
import ch08_s08_ghost_express from './stages/story/ch08-s08-ghost-express';
import ch09_s01_pier_planks from './stages/story/ch09-s01-pier-planks';
import ch09_s02_crate_city from './stages/story/ch09-s02-crate-city';
import ch09_s03_net_loft from './stages/story/ch09-s03-net-loft';
import ch09_s04_foghorn_bay from './stages/story/ch09-s04-foghorn-bay';
import ch09_s05_warehouse_aisle from './stages/story/ch09-s05-warehouse-aisle';
import ch09_s06_gangway from './stages/story/ch09-s06-gangway';
import ch09_s07_cold_storage from './stages/story/ch09-s07-cold-storage';
import ch09_s08_captain_cabin from './stages/story/ch09-s08-captain-cabin';
import ch10_s01_seedling_rows from './stages/story/ch10-s01-seedling-rows';
import ch10_s02_mist_house from './stages/story/ch10-s02-mist-house';
import ch10_s03_potting_bench from './stages/story/ch10-s03-potting-bench';
import ch10_s04_orchid_maze from './stages/story/ch10-s04-orchid-maze';
import ch10_s05_irrigation from './stages/story/ch10-s05-irrigation';
import ch10_s06_compost_heap from './stages/story/ch10-s06-compost-heap';
import ch10_s07_glass_ridge from './stages/story/ch10-s07-glass-ridge';
import ch10_s08_queen_agave from './stages/story/ch10-s08-queen-agave';
import ch11_s01_gear_floor from './stages/story/ch11-s01-gear-floor';
import ch11_s02_pendulum_well from './stages/story/ch11-s02-pendulum-well';
import ch11_s03_bell_loft from './stages/story/ch11-s03-bell-loft';
import ch11_s04_escapement from './stages/story/ch11-s04-escapement';
import ch11_s05_winding_stair from './stages/story/ch11-s05-winding-stair';
import ch11_s06_counterweight from './stages/story/ch11-s06-counterweight';
import ch11_s07_face_scaffold from './stages/story/ch11-s07-face-scaffold';
import ch11_s08_midnight_chime from './stages/story/ch11-s08-midnight-chime';
import ch12_s01_airlock from './stages/story/ch12-s01-airlock';
import ch12_s02_sample_vault from './stages/story/ch12-s02-sample-vault';
import ch12_s03_centrifuge from './stages/story/ch12-s03-centrifuge';
import ch12_s04_clean_room from './stages/story/ch12-s04-clean-room';
import ch12_s05_observation from './stages/story/ch12-s05-observation';
import ch12_s06_reactor_catwalk from './stages/story/ch12-s06-reactor-catwalk';
import ch12_s07_cryo_bay from './stages/story/ch12-s07-cryo-bay';
import ch12_s08_launch_cradle from './stages/story/ch12-s08-launch-cradle';
import arcade_01_heat_market from './stages/arcade/arcade-01-heat-market';
import arcade_02_neon_chase from './stages/arcade/arcade-02-neon-chase';
import arcade_03_pipe_panic from './stages/arcade/arcade-03-pipe-panic';
import arcade_04_crowd_surge from './stages/arcade/arcade-04-crowd-surge';
import arcade_05_mirror_bowl from './stages/arcade/arcade-05-mirror-bowl';
import arcade_06_grate_storm from './stages/arcade/arcade-06-grate-storm';
import arcade_07_dock_rush from './stages/arcade/arcade-07-dock-rush';
import arcade_08_bloom_break from './stages/arcade/arcade-08-bloom-break';
import arcade_09_bell_sprint from './stages/arcade/arcade-09-bell-sprint';
import arcade_10_lab_leak from './stages/arcade/arcade-10-lab-leak';
import arcade_11_crumb_riot from './stages/arcade/arcade-11-crumb-riot';
import arcade_12_alley_overflow from './stages/arcade/arcade-12-alley-overflow';
import arcade_13_attic_draft from './stages/arcade/arcade-13-attic-draft';
import arcade_14_carnival_spin from './stages/arcade/arcade-14-carnival-spin';
import arcade_15_marble_heat from './stages/arcade/arcade-15-marble-heat';
import arcade_16_third_rail_jam from './stages/arcade/arcade-16-third-rail-jam';
import arcade_17_fog_pileup from './stages/arcade/arcade-17-fog-pileup';
import arcade_18_orchid_burst from './stages/arcade/arcade-18-orchid-burst';
import arcade_19_gear_flood from './stages/arcade/arcade-19-gear-flood';
import arcade_20_airlock_wave from './stages/arcade/arcade-20-airlock-wave';
import arcade_21_double_pounce from './stages/arcade/arcade-21-double-pounce';
import arcade_22_quota_fever from './stages/arcade/arcade-22-quota-fever';
import arcade_23_director_max from './stages/arcade/arcade-23-director-max';
import arcade_24_last_kettle from './stages/arcade/arcade-24-last-kettle';
import ta_01_sprint_pantry from './stages/timeAttack/ta-01-sprint-pantry';
import ta_02_cellar_dash from './stages/timeAttack/ta-02-cellar-dash';
import ta_03_alley_cut from './stages/timeAttack/ta-03-alley-cut';
import ta_04_pipe_shot from './stages/timeAttack/ta-04-pipe-shot';
import ta_05_rafter_line from './stages/timeAttack/ta-05-rafter-line';
import ta_06_bumper_split from './stages/timeAttack/ta-06-bumper-split';
import ta_07_foyer_blitz from './stages/timeAttack/ta-07-foyer-blitz';
import ta_08_platform_fly from './stages/timeAttack/ta-08-platform-fly';
import ta_09_pier_run from './stages/timeAttack/ta-09-pier-run';
import ta_10_glass_cut from './stages/timeAttack/ta-10-glass-cut';
import ta_11_pendulum_gap from './stages/timeAttack/ta-11-pendulum-gap';
import ta_12_protocol_go from './stages/timeAttack/ta-12-protocol-go';

export const STAGES: readonly StageDef[] = [
  ch01_s01_crumb_trail,
  ch01_s02_breadbox_heist,
  ch01_s03_midnight_fridge,
  ch01_s04_sink_island,
  ch01_s05_spice_rack,
  ch01_s06_oven_warmth,
  ch01_s07_dishwasher_hum,
  ch01_s08_gran_returns,
  ch02_s01_wine_rows,
  ch02_s02_coal_chute,
  ch02_s03_root_cellar,
  ch02_s04_furnace_glow,
  ch02_s05_jar_shelf,
  ch02_s06_flooded_sump,
  ch02_s07_rafter_run,
  ch02_s08_locked_hatch,
  ch03_s01_dumpster_row,
  ch03_s02_fire_escape,
  ch03_s03_wet_bricks,
  ch03_s04_neon_puddle,
  ch03_s05_loading_dock,
  ch03_s06_chain_link,
  ch03_s07_stray_circle,
  ch03_s08_rooftop_leap,
  ch04_s01_pipe_crawl,
  ch04_s02_grate_gallery,
  ch04_s03_overflow_gate,
  ch04_s04_echo_tunnel,
  ch04_s05_maintenance_walk,
  ch04_s06_sludge_bend,
  ch04_s07_pump_room,
  ch04_s08_outflow_door,
  ch05_s01_trunk_maze,
  ch05_s02_insulation_sea,
  ch05_s03_dormer_window,
  ch05_s04_hatbox_stack,
  ch05_s05_chimney_nook,
  ch05_s06_loose_board,
  ch05_s07_owl_rafter,
  ch05_s08_widow_walk,
  ch06_s01_ticket_booth,
  ch06_s02_bumper_floor,
  ch06_s03_cotton_stall,
  ch06_s04_hall_of_mirrors,
  ch06_s05_ferris_shadow,
  ch06_s06_ring_toss,
  ch06_s07_funhouse_tilt,
  ch06_s08_prize_tent,
  ch07_s01_marble_foyer,
  ch07_s02_armor_hall,
  ch07_s03_vase_wing,
  ch07_s04_night_watch,
  ch07_s05_fossil_pit,
  ch07_s06_portrait_gaze,
  ch07_s07_skydome,
  ch07_s08_archive_vault,
  ch08_s01_platform_edge,
  ch08_s02_turnstile_jam,
  ch08_s03_bench_row,
  ch08_s04_third_rail,
  ch08_s05_service_tunnel,
  ch08_s06_map_kiosk,
  ch08_s07_lost_and_found,
  ch08_s08_ghost_express,
  ch09_s01_pier_planks,
  ch09_s02_crate_city,
  ch09_s03_net_loft,
  ch09_s04_foghorn_bay,
  ch09_s05_warehouse_aisle,
  ch09_s06_gangway,
  ch09_s07_cold_storage,
  ch09_s08_captain_cabin,
  ch10_s01_seedling_rows,
  ch10_s02_mist_house,
  ch10_s03_potting_bench,
  ch10_s04_orchid_maze,
  ch10_s05_irrigation,
  ch10_s06_compost_heap,
  ch10_s07_glass_ridge,
  ch10_s08_queen_agave,
  ch11_s01_gear_floor,
  ch11_s02_pendulum_well,
  ch11_s03_bell_loft,
  ch11_s04_escapement,
  ch11_s05_winding_stair,
  ch11_s06_counterweight,
  ch11_s07_face_scaffold,
  ch11_s08_midnight_chime,
  ch12_s01_airlock,
  ch12_s02_sample_vault,
  ch12_s03_centrifuge,
  ch12_s04_clean_room,
  ch12_s05_observation,
  ch12_s06_reactor_catwalk,
  ch12_s07_cryo_bay,
  ch12_s08_launch_cradle,
  arcade_01_heat_market,
  arcade_02_neon_chase,
  arcade_03_pipe_panic,
  arcade_04_crowd_surge,
  arcade_05_mirror_bowl,
  arcade_06_grate_storm,
  arcade_07_dock_rush,
  arcade_08_bloom_break,
  arcade_09_bell_sprint,
  arcade_10_lab_leak,
  arcade_11_crumb_riot,
  arcade_12_alley_overflow,
  arcade_13_attic_draft,
  arcade_14_carnival_spin,
  arcade_15_marble_heat,
  arcade_16_third_rail_jam,
  arcade_17_fog_pileup,
  arcade_18_orchid_burst,
  arcade_19_gear_flood,
  arcade_20_airlock_wave,
  arcade_21_double_pounce,
  arcade_22_quota_fever,
  arcade_23_director_max,
  arcade_24_last_kettle,
  ta_01_sprint_pantry,
  ta_02_cellar_dash,
  ta_03_alley_cut,
  ta_04_pipe_shot,
  ta_05_rafter_line,
  ta_06_bumper_split,
  ta_07_foyer_blitz,
  ta_08_platform_fly,
  ta_09_pier_run,
  ta_10_glass_cut,
  ta_11_pendulum_gap,
  ta_12_protocol_go,
];

export const STAGES_BY_ID: Readonly<Record<string, StageDef>> = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage]),
);

export function stageById(id: string): StageDef | undefined {
  return STAGES_BY_ID[id];
}

export const STORY_STAGES = STAGES.filter((stage) => stage.kind === 'story');
export const ARCADE_STAGES = STAGES.filter((stage) => stage.kind === 'arcade');
export const TIME_ATTACK_STAGES = STAGES.filter((stage) => stage.kind === 'timeAttack');
