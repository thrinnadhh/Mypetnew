export const motion = {
  durationFast: 150,
  durationNormal: 250,
  durationSlow: 400,
  easingStandard: 'ease-in-out',
} as const;

export type MotionToken = keyof typeof motion;
