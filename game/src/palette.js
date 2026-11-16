// The look plan, in one place. A dusk yard: cold slate and concrete, warm amber work
// lights, rust as the enemy signal. Every colour below is one of the palette names;
// the lighting makes every shade the game needs, so no other colour appears in the code.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191d26',
  surface: '#262c37',
  hairline: '#39414e',
  ink: '#ece7db',
  muted: '#9aa3ad',
  accent: '#f0a830',
  rust: '#c65a2e',
  pine: '#5d7a5a',
};

export function shade(name) {
  return PALETTE[name];
}
