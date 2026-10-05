/* ═══════════════════════════════════════════════════════════════════
   disclosures.js — EVERY piece of regulatory wording the note prints.

   The note is MARKET COMMENTARY for institutional investors, not a research
   report. What keeps it on that side of the line is partly the wording below
   and partly what the note leaves out (no POP, no price objective, no
   "target", no ranking, no rating). The wording lives in one file so that
   Compliance edits one place and the rest of the tool never has to change.

   STATUS: DRAFT. None of this text has been approved. It was written against
   FINRA Rule 2241(a)(11) (the research-report definition and its
   commentary exclusions), Regulatory Notice 17-16 (the proposed desk-
   commentary exception and its "health warning"), Rule 2210 and Rule 2220
   (options communications). It must be reviewed by Compliance and a
   Registered Options Principal before a note goes to a client.
   When it has been, set APPROVED to true and fill APPROVED_BY — the
   on-screen "pending approval" banner disappears, and it is never printed
   either way.
   ═══════════════════════════════════════════════════════════════════ */

export const APPROVED = false;
export const APPROVED_BY = "";          // e.g. "Compliance / ROP, 2026-10-05"

/* Masthead, top right of page 1, and the running head on pages 2–3. */
export const MAST = {
  kind: "Market Commentary",
  audience: "For Institutional Investors Only",
};

/* Centre of every page footer — the one line that travels with any page
   that gets separated from the others. */
export const FOOTER = "Market commentary · not a research report";

/* Page-1 legend. Modelled on the RN 17-16 "health warning": it says what the
   communication is, that it is not research and does not carry research's
   protections, that the author's views can differ from the firm's and that
   the firm may trade against them. Kept to three lines so it fits beneath
   the analyst block. */
export const LEGEND =
  "Market commentary for institutional investors only. This is not a research report and was not " +
  "prepared by a research department; it is not subject to the rules and policies that govern research, " +
  "including those on analyst independence and research disclosures. Views are the author’s as of " +
  "the date shown, may differ from those of other JonesTrading personnel and may change without notice. " +
  "JonesTrading and its personnel may hold or trade positions contrary to these views. Not tailored to " +
  "any investor. See Important Disclosures on page 3.";

/* Page 3. `author` and `title` are filled from the analyst block so the
   commentary is attributed to a person and a role, not to the firm. */
export const APPENDIX = ({ author, title }) => [
  { h: "Market Commentary:",
    p: `This material is market commentary prepared by ${author || "the author"}${title ? `, ${title},` : ""} of ` +
       "JonesTrading Institutional Services LLC (JTIS) for institutional investors as defined in FINRA Rule 4512(c). " +
       "It is not a research report, was not prepared by a research department and has not been prepared in " +
       "accordance with the requirements designed to promote the independence of investment research. The views " +
       "expressed, including any illustrative ETF or option expression of them, are the author’s own as of the " +
       "date shown, may differ from the views of other JTIS personnel and may change without notice; JTIS has no " +
       "obligation to update them. The material is general in nature and does not take into account the investment " +
       "objectives, financial situation or needs of any particular investor, who should exercise independent " +
       "judgment. It is provided for informational purposes and is not an offer to sell or a solicitation of an " +
       "offer to buy any security." },
  { h: "Conflicts:",
    p: "JTIS, its affiliates and their personnel may have positions in, and may trade as principal or agent in, the " +
       "securities and derivatives mentioned, including in a manner that is contrary to the views expressed here and " +
       "before or after this material is distributed." },
  { h: "Figures and Levels:",
    p: "Prices are indicative as of the time shown and are not a guarantee of execution. Open-interest walls, scale " +
       "bands, weighted-average executions, stop-loss levels and risk figures are mechanical descriptions of how an " +
       "expression could be worked; they are not price objectives. The option-implied range is derived from current " +
       "option prices and represents the market’s own measure of a one-standard-deviation move over the holding " +
       "period; it is not a forecast. Information is from sources believed to be reliable but JTIS does not " +
       "guarantee that it is accurate, complete or timely. Past performance is not indicative of future results." },
  { h: "Options Risk Disclosure:",
    p: "Options involve risk and are not suitable for all investors. Prior to buying or selling an option, a person " +
       "must receive a copy of Characteristics and Risks of Standardized Options, available from your JTIS " +
       "representative or at www.theocc.com. Structures are shown at indicative marks and do not reflect " +
       "commissions, financing, margin, assignment risk or the bid-offer spread incurred in execution. Maximum gain " +
       "and maximum loss are shown per share at expiration; one contract represents 100 shares. Multi-leg " +
       "strategies entail multiple commissions, and positions may be closed at a loss before expiration." },
];
