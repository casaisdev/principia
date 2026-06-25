# Principia

An interactive **N-body gravity** sandbox in the browser. Drop masses and every
body attracts every other one according to Newton's law of gravitation:

```
F = G · m₁·m₂ / r²
```

Orbits, binary systems, and chaos emerge on their own from that single rule -
nothing is scripted to "make orbits".

## The honesty invariant

The only thing that should stay constant is **total energy**. If it drifts, the
integrator is lying, not doing physics. So Principia is built around that:

- **Velocity Verlet** - a symplectic integrator whose energy stays in a bounded
  band instead of drifting (unlike Euler/RK4). A **4th-order Yoshida** option
  (toggle in the toolbar) keeps that band orders of magnitude tighter at ~3× the
  force cost - still symplectic, still no drift.
- **Fixed timestep** with an accumulator, decoupled from the render frame rate.
- **Plummer softening** (`r² + ε²`) so close encounters stay finite.
- **Sub-step collision timing** - an overlap is only detected at the end of a
  step, so a merge rewinds the pair to the instant their surfaces actually met
  before combining, instead of merging at deep interpenetration.
- **Exact O(N²) force by default**, with an optional **Barnes–Hut** O(N log N)
  tree solver (toolbar toggle) for thousands of bodies. At N≈5000 the default
  θ=0.5 is ~4× faster than exact for ~1.7% force error (θ=0.7 ≈8× / 3.4%).
  Barnes–Hut is an *approximation* with two honest costs, both surfaced rather
  than hidden: the energy readout is labelled **θ-approx** (it shows the
  *physical*-energy drift of the approximate trajectory, which grows with θ and
  → the integrator bound as θ→0), and because the tree makes pair forces
  non-reciprocal it no longer conserves momentum to machine precision - a
  contrast the test suite pins down against the exact solver.
- The live **energy-drift** readout makes the invariant visible at all times.
  Inelastic merges genuinely shed energy, so the readout subtracts each merge's
  exact (analytic) loss and shows only the *integrator's* drift - it stays ~0
  even while bodies are accreting.
- `npm test` asserts all of this: drift < 1e‑3 over 20k steps, the Yoshida band
  staying far tighter than Verlet's, integrator honesty through merges, linear
  **and angular** momentum conservation, stable circular orbits,
  momentum-conserving merges, plus camera/serialization unit tests.

## Controls

- **Drag** empty space to fling a new body (drag sets its velocity); **drag a
  body** to reposition it; **click** a body to select it (the **inspector** then
  shows its mass, velocity and orbital elements - a, e, period - relative to the
  dominant mass); selected body + **Delete** removes it.
- **Scroll** to zoom at the cursor; **right-drag** to pan. On touch: the Add/Pan
  tool selects what a drag does; two fingers pinch-zoom.
- Play / pause / single-step, speed, trails, **Center** (recenter on the system,
  keeping zoom), **Follow** (track the centre of mass), **Undo/Redo** (of
  clear/delete and preset overwrites), Reset, Clear, and **Share**.
- **Physics panel**: a labelled popover for the model controls - integrator
  (**Verlet ×2** ↔ **Yoshida ×4**), force solver (**Exact N²** ↔ **Barnes–Hut**),
  collisions (**merge** ↔ **pass-through**), and live **G**, softening **ε** and -
  under Barnes–Hut - the opening angle **θ**. All ride along in a shared link.
- **Keyboard**: `Space` pause · `S` step · `A` add body · `R` reset · `F`
  recenter · `T` trails · `1/2/3` presets · `Delete` remove selected · `Esc`
  deselect · `Ctrl/⌘+Z` undo · `Ctrl/⌘+Shift+Z` redo · `?` shortcuts overlay.
- Presets: **Solar system** (circular orbits), **Three-body** (the figure-eight
  choreography), **Chaos** (a random cloud that clusters, ejects and pairs up).
- **Preferences persist**: speed, trails, integrator, solver, G/ε/θ and more are
  saved to `localStorage`, so the app reopens the way you left it. Built to
  install as a **PWA** (web app manifest + icons).

## Sharing

**Share** serialises the whole scene - every body plus all the options that
govern it (G, softening, collision mode, integrator, force solver and θ) - into
the URL hash and copies a link, no backend. Opening that link rebuilds the exact
system, so a binary you stumbled on or a cloud you tuned can be handed to someone
else. Older links (from before the integrator/solver/θ were captured) still open,
falling back to the defaults for the fields they don't carry.

## Tech

Vite · React · TypeScript · canvas 2D · CSS Modules · no backend.
Fonts (Spectral, IBM Plex Mono) are **self-hosted** via `@fontsource` - no
external requests, which keeps the Content-Security-Policy strict.

The physics core (`src/physics/`) is pure, framework-free TypeScript stored as a
structure-of-arrays of `Float64Array`s - React stays out of the per-frame loop.
It runs in a **Web Worker**: the worker owns the simulation and the fixed-timestep
loop and posts body snapshots (as transferable buffers) to the main thread, which
only renders, fits the camera and handles input. So the O(N²)/O(N log N) force
loop never blocks scrolling, zooming or the UI, even with thousands of bodies.

## Development

```bash
npm install
npm run dev        # start the dev server
npm test           # run the invariant test suite (watch)
npm run test:run   # run tests once
npm run build      # type-check and build for production
```

## Deployment

Configured for **Vercel** via `vercel.json` (Vite preset, `dist` output):

- **SPA rewrite** - every path serves `index.html` (deep links / unknown paths).
- **Security headers** on all responses - a strict Content-Security-Policy
  (`default-src 'self'`, no `unsafe-inline`/`unsafe-eval`, `worker-src 'self'`
  for the physics worker), HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy`, and a locked-down `Permissions-Policy`.
- **Immutable caching** for content-hashed `/assets/*` (1 year).

The CSP was verified against the production build (zero violations). Two things
to know:

- It's tuned for this exact app (self-hosted fonts, no inline styles/scripts).
  If you add an external script/style/API, widen the relevant CSP directive.
- `frame-ancestors 'self'` blocks embedding the sandbox in other sites. To allow
  embeds, relax that directive and `X-Frame-Options`.

To deploy: push to a Git repo connected to Vercel, or `npx vercel`. The OG/
canonical URLs in `index.html` point at `https://principia.martincasais.com/` -
update them if the domain changes.

## Project layout

```
public/        brand assets - logo, favicon, OG image
src/
  config.ts    tunable constants (timestep, gains, zoom limits) in one place
  physics/     pure simulation core (Simulation, forces, barnesHut, integrator,
               energy, collisions, presets) + invariant tests
  render/      Camera, Renderer, trails (canvas 2D, DPR-aware) + tests
  sim/         Engine (main-thread render loop + worker proxy), SimRunner +
               simWorker (physics worker), protocol (messages), input handling
  state/       UI store (useSyncExternalStore) + scene serialization + tests
  hooks/       useEngine, useKeyboard
  ui/          Canvas, Toolbar, Readout (CSS Modules)
  App.tsx      app shell
index.html     document + SEO / Open Graph metadata
```
