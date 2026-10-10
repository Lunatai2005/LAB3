export function discountForScore(score: number) {
  if (score >= 1000) return { tier: "DIAMOND", percent: 15 };
  if (score >= 500) return { tier: "GOLD", percent: 10 };
  if (score >= 100) return { tier: "SILVER", percent: 5 };
  return { tier: "BASIC", percent: 0 };
}
