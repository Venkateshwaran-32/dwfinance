// One fixed colour per category, shared by every chart and list so a category looks the same everywhere.
// Fills are light enough for ink (#15171c) text. Brand red and the income green stay out of this palette:
// red means "brand / needs attention" and green means "money in / saved" (see ../../VISUAL_SYSTEM.md).
export const CATEGORY_COLORS: Record<string, string> = {
  "Food & Dining": "#f5a04c",
  Groceries: "#3dbfa8",
  Transport: "#5b9bf0",
  Shopping: "#a98beb",
  Subscriptions: "#f08bb4",
  Utilities: "#f2c94c",
  Telecom: "#7c87e8",
  Health: "#5cc8e0",
  Cash: "#b58863",
  Transfers: "#94a3b8",
  Income: "#4caf72",
  Other: "#c2c7cf",
};

export const SAVED_COLOR = "#0a7d33";
export const INK = "#15171c";

export function categoryColor(name: string): string {
  return CATEGORY_COLORS[name] ?? CATEGORY_COLORS.Other;
}
