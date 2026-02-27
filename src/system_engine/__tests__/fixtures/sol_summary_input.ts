export type SolSummaryInputFixture = {
  solLong: number;
  solShort: number;
  markPrice: number;
  liqPrice?: number;
  rangeBufferPct?: number;
  rangeLower?: number;
  rangeUpper?: number;
};

export function buildSolSummaryInputFixture(
  overrides: Partial<SolSummaryInputFixture> = {}
): SolSummaryInputFixture {
  return {
    solLong: 120.25,
    solShort: 114.9,
    markPrice: 146.5,
    liqPrice: 205.1,
    rangeBufferPct: 0.082,
    rangeLower: 125.25,
    rangeUpper: 162.1,
    ...overrides
  };
}
