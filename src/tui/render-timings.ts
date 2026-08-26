/**
 * Drains the user-timing entries a render leaves behind.
 *
 * React's development build writes measures for its component track, about six per render, and
 * this screen redraws every 120ms for as long as a run is working. Node buffers every one of
 * them in a global entry buffer that has no bound and that nothing in this process ever reads,
 * so a run long enough to matter accumulates them until Node reports a leak at a million
 * entries and then keeps growing. A twelve-hour run reaches that in the first six.
 *
 * Draining rather than loading React's production build, which emits none of this: which build
 * loads is decided by NODE_ENV, and this process hands its own environment to the workspace
 * commands it spawns. Setting NODE_ENV=production here would reach the `npm install` the agent
 * runs in the workspace and silently drop that project's devDependencies, which is a worse bug
 * than the one it would fix. Clearing is scoped to this process and reaches every build.
 *
 * This touches an ambient global rather than an injected one, which is allowed here: nothing
 * reads a value back, so no decision on the screen depends on it. It is a release, not an input.
 */
export function drainRenderTimings(): void {
  performance.clearMeasures();
}
