// Colors and fonts of the e-mails: the app's "Coffre-fort" theme (midnight blue and brass), copied
// from behindMe/theme/tokens.js, whose contrast check covers these pairs. The repos share no code:
// keep them in step by hand.

export const LIGHT = {
  canvas: "#EEF1F5",
  surface: "#FFFFFF",
  ink: "#121A2A",
  muted: "#4E5868",
  border: "#D6DCE5",
  accent: "#23406B",
  danger: "#A8322A",
  dangerSoft: "#F7DFDB",
};

/** Apple Mail and other clients that honour prefers-color-scheme. */
export const DARK = {
  canvas: "#0B1220",
  surface: "#131C2E",
  sunken: "#1B2539",
  ink: "#EEF1F6",
  muted: "#A3ADBF",
  border: "#27324A",
  accent: "#D9B36A",
  danger: "#F09484",
  dangerSoft: "#3A1F1E",
};

/** The band at the top, in both schemes: midnight, with the logo and name in brass. */
export const BAND = { background: "#0B1220", brass: "#D9B36A" };

// No web font is loaded (nothing remote): Bodoni 72 and Didot ship with iPhones and Macs, Avenir Next
// stands in for Jost there; the others fall back to Georgia and Helvetica.
export const SERIF = `"Bodoni Moda", "Bodoni 72", Didot, Georgia, "Times New Roman", serif`;
export const SANS = `Jost, "Avenir Next", Avenir, "Helvetica Neue", Helvetica, Arial, sans-serif`;
