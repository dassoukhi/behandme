// Colors and fonts of the e-mails: the app's "Ardoise & Or" theme (slate blue and champagne gold, dark
// only), copied from behindMe/theme/tokens.js. The repos share no code: keep them in step by hand. E-mail
// clients take no translucent colors reliably, so the app's rgba hairlines and soft fills are given here
// as the solid color they make on the card.

export const COLORS = {
  canvas: "#131A24", // the e-mail's background
  surface: "#1B2432", // the card
  border: "#2A3648", // the card's border, the hairlines between facts, the footer's rule
  accent: "#E2C275", // the name, the title
  accentLine: "#756B50", // the border of the "open the app" box (gold at 45 % on the card)
  ink: "#F8FAFC", // the greeting, the key facts
  muted: "#94A3B8", // explanations, fact labels, the anti-phishing line
  subtle: "#64748B", // the footer
  danger: "#FCA5A5", // the security badge
  dangerSoft: "#342834", // its background (red at 12 % on the card)
};

// No web font is loaded (nothing remote): Georgia for titles, Avenir Next standing in for Jost on iPhones
// and Macs, Helvetica or Arial elsewhere.
export const SERIF = `Georgia, "Times New Roman", serif`;
export const SANS = `Jost, "Avenir Next", Avenir, "Helvetica Neue", Helvetica, Arial, sans-serif`;
