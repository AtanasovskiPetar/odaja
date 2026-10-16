// three.js ships the meshoptimizer simplifier without type declarations.
declare module "three/examples/jsm/libs/meshopt_simplifier.module.js" {
  export const MeshoptSimplifier: {
    ready: Promise<void>;
    simplify(
      indices: Uint32Array,
      positions: Float32Array,
      stride: number,
      targetIndexCount: number,
      targetError: number,
      flags?: string[],
    ): [Uint32Array, number];
  };
}
