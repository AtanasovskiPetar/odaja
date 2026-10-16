// Project files use centimetres on a top-down plan: x to the right, y down the
// page (south), height measured up from the floor, rotations in degrees
// clockwise when seen from above. Three.js uses metres with Y up, so plan y
// maps to three z.
export const M = (cm: number) => cm / 100;

export const planToWorld = (x: number, y: number, height = 0): [number, number, number] => [M(x), M(height), M(y)];

export const rotationToWorld = (degrees: number) => (-degrees * Math.PI) / 180;

export const worldToPlan = (x: number, z: number): [number, number] => [round(x * 100), round(z * 100)];

// Keep files tidy: positions are stored to 0.1 cm.
export const round = (cm: number) => Math.round(cm * 10) / 10;
