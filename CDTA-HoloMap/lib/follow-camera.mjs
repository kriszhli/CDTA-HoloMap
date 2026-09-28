// Ease from the current view to the bus's continually updated predicted position.
export function followCenter(target, transition, now) {
  if (!transition) return target;
  const t = Math.max(0, Math.min(1, (now - transition.started) / 850));
  const progress = t * t * (3 - 2 * t);
  return target.map((value, index) => transition.origin[index] + (value - transition.origin[index]) * progress);
}
