# Clean-room procedural sky

Original GLSL, no Three Sky implementation, proprietary code, tables, or assets.
`SkyDome` is a Y-up, linear-HDR background mesh. Integration is intentionally
separate: add it to a scene, keep the camera inside it (center it on the camera
for large worlds), and call `update(partialSettings)`. Angles are **radians**.
Set `showSunDisc: false` when baking a PMREM with a separate direct sun light.
Remove the mesh from its parent and call `dispose()` when finished.

## Controls and uniforms

Defaults: turbidity 3 (2–20), ozone 0.35 (0–1), waterVapour 2,
intensityMultiplier 1, sizeMultiplier 1, groundAlbedo 0.2 linear,
blendAngle 0.10017, horizonOffset 0, skyModel 0, showSunDisc true,
sunDirection (0,1,0), sunColor linear white, sunIntensity 1.
Ground albedo accepts a scalar or linear `THREE.Color`; direction accepts a
`THREE.Vector3`. Updates copy mutable inputs.

Uniforms: betaRayleigh/betaMie (CPU-derived RGB inverse-meter coefficients),
ozone, waterVapour, skyModel, intensityMultiplier, sizeMultiplier,
groundAlbedo, blendAngle, horizonOffset, showSunDisc, sunDirection, sunColor,
sunIntensity. Inactive model uniforms may be optimized out by the driver.
Models 1/2/3 explicitly fall back to 0; ozone and waterVapour are retained but
**inactive**, because no actual CIE/Hosek model is implemented.

## Equations and published sources

This is a **Preetham-style single-scattering approximation**, not the complete
Preetham/Perez fitted luminance/chromaticity model.

- Rayleigh: betaR(lambda) = 8 pi³ (n²−1)² / (3 N lambda⁴)
  × (6+3 delta)/(6−7 delta), at 680/550/440 nm, n=1.0003,
  N=2.545e25 m⁻³, delta=0.035.
- Aerosol: tau550 = 0.04608 T − 0.04586; betaM(lambda) =
  tau550 (lambda/550 nm)^−1.3 / 1200 m (Angstrom power law).
- Vertical optical depth D = betaR × 8400 m + betaM × 1200 m.
  Kasten–Young air mass m(z) = [cos(z) +
  0.50572 (96.07995−z_degrees)^−1.6364]⁻¹.
  Beer–Lambert transmission is exp(−D m).
- Rayleigh phase PR = 3(1+cos² theta)/(16 pi).
  Henyey–Greenstein PM = (1−g²) /
  [4 pi (1+g²−2g cos theta)^1.5], g=0.76.
- Integrated slab scattering: [(betaR HR PR + betaM HM PM)/D]
  × [1−exp(−D m_view)] × exp(−D m_sun).
- Sun angular radius is 0.27° × sizeMultiplier. A smooth edge and linear
  limb law 0.4+0.6 sqrt(1−r²) are applied independently from scattering.
- Horizon: h=dir.y−sin(horizonOffset), b=smoothstep(−sin(blendAngle),
  sin(blendAngle),h), color=mix(groundAlbedo,skyColor,b).
  Zero blend width uses an epsilon. Caller illumination multiplies the result.

References (equations only, not source-code translations):

- Preetham, Shirley, Smits, *A Practical Analytic Model for Daylight*,
  SIGGRAPH 1999, DOI: 10.1145/311535.311545.
- Kasten & Young, *Revised optical air mass tables and approximation formula*,
  Applied Optics 28 (1989), DOI: 10.1364/AO.28.004735.
- Henyey & Greenstein, *Diffuse radiation in the Galaxy*, ApJ 93 (1941),
  DOI: 10.1086/144246.

## Limitations

No CIE distributions, Hosek–Wilkie coefficients, ozone/water absorption,
multiple scattering, altitude dependence, spectral integration, or calibrated
V-Ray photometry. RGB wavelength samples are an approximation, not a spectrum
converted through color-matching functions. Relative artistic radiance scales
are 20 for scattering and 20000 for the disc; sunIntensity is not lux.
This is not a numerical match to V-Ray or the full published Preetham model.
Ground is a simple albedo blend, not irradiance-integrated ground bounce.
Sun air mass is capped at the horizon; smooth solar visibility from y=−0.08
to 0.02 approximates sunset without a hard switch. There is no authored night
sky: callers supply sunColor/sunIntensity, including zero for darkness.
The disc uses fixed edge smoothing, not derivative-based pixel antialiasing.
All inverse trig inputs and power bases are guarded, directions normalized
(zero/nonfinite CPU sun directions fall back to zenith), and optical depth
exponents bounded. No shader loops or lookup textures are used.
No tone mapping or sRGB encoding is done here; these belong to the output pass.
