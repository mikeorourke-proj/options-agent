/* "2026-10-30" -> "October 30th". Parsed from the string, never through Date,
   so no timezone can shift the day. Shared by the page and the drafter's
   model so an expiry reads the same in the table and in the prose — on
   5 Oct the table said "November 20th" and the paragraph beside it
   "November 20, 2026". */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
export function longExpiry(iso) {
  const [, m, d] = String(iso || "").split("-").map(Number);
  if (!m || !d) return iso || "";
  const sfx = d % 100 >= 11 && d % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[d % 10] || "th");
  return `${MONTHS[m - 1]} ${d}${sfx}`;
}

/* "+1 77P / -1 75P" -> "77/75". Only when every leg is the same type and
   one contract each way — a ratio or a mixed structure is left alone,
   because "77/75" would then be describing something it is not. */
export function strikesText(legText) {
  const legs = [...String(legText || "").matchAll(/([+-\u2212])\s*(\d+)\s+(\d+(?:\.\d+)?)\s*([PC])/g)];
  if (legs.length < 1 || legs.length > 2) return null;
  if (legs.some(l => l[2] !== "1") || new Set(legs.map(l => l[4])).size !== 1) return null;
  return legs.map(l => l[3]).join("/");
}
