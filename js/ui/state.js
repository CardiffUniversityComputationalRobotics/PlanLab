/* state.js — the app's shared state. The UI files read and change these fields directly. */
const App = {
  /** What is in the workspace (see world.js). */
  world: World.fromLayout('blocks'),

  /** Goal samples (Objects window): how many per goal region, and how sample_goal() picks one. */
  goalSettings: { perRegion: 3, choice: 'random' },   // choice: 'random' | 'consecutive'

  /** The selected object: { kind: 'start' } | { kind: 'obstacle', id } | { kind: 'goal', id } | null. */
  selection: null,

  /** The selected object while it is being dragged off the workspace to remove it (drawn faded). */
  draggingOff: null,

  /** The code editors { algo, lib, py }: the Algorithm, Functions and Python tabs (made by pseudocode-panel.js). */
  editors: null,

  /** Which Pseudocode tab is showing: 'algo' | 'lib' | 'py' | 'ref'. */
  codeTab: 'algo',

  /** The parsed program, or null when the code has a syntax error (then parseError is set). */
  program: null,
  parseError: null,

  /** The current run (a Runner), or null. */
  runner: null,

  /** 'idle' | 'running' | 'paused' | 'found' | 'nopath' | 'done' | 'error' */
  status: 'idle',

  /** The path the last run returned (drawn in orange), or null. */
  resultPath: null,
};
