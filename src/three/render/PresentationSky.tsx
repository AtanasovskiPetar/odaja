import * as THREE from "three";

export interface PresentationSkySettings {
  zenithColor: THREE.Color;
  horizonColor: THREE.Color;
  groundColor: THREE.Color;
  sunColor: THREE.Color;
  sunDir: THREE.Vector3;
  sunGlow: number;
}

/** Visible background only. Never add this calibrated gradient to the IBL scene. */
export class PresentationSky extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor() {
    super(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: true,
      uniforms: {
        zenithColor: { value: new THREE.Color() },
        horizonColor: { value: new THREE.Color() },
        groundColor: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunGlow: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vDir = worldPosition.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 zenithColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        uniform vec3 sunColor;
        uniform vec3 sunDir;
        uniform float sunGlow;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 sky = mix(horizonColor, zenithColor, pow(h, 0.55));
          // Reversed smoothstep edges are undefined in GLSL. This is the
          // defined equivalent of smoothstep(0.0, -0.18, dir.y).
          if (dir.y < 0.0) {
            sky = mix(horizonColor, groundColor, 1.0 - smoothstep(-0.18, 0.0, dir.y));
          }
          sky += sunColor * pow(max(dot(dir, sunDir), 0.0), 350.0) * sunGlow;
          gl_FragColor = vec4(sky, 1.0);
          // Linear HDR until the renderer's standard output transforms.
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }));
    this.name = "PresentationSky";
    this.scale.setScalar(150);
    this.frustumCulled = false;
    this.renderOrder = -1;
    this.userData.noAo = true;
  }

  update(settings: PresentationSkySettings): void {
    const uniforms = this.material.uniforms;
    uniforms.zenithColor.value.copy(settings.zenithColor);
    uniforms.horizonColor.value.copy(settings.horizonColor);
    uniforms.groundColor.value.copy(settings.groundColor);
    uniforms.sunColor.value.copy(settings.sunColor);
    uniforms.sunDir.value.copy(settings.sunDir);
    uniforms.sunGlow.value = settings.sunGlow;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
