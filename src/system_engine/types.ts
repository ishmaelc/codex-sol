export type SystemLabel = "GREEN" | "YELLOW" | "RED";

export interface SystemScore {
  score0to1: number;
  score0to100: number;
  label: SystemLabel;
  reasons: string[];
  components: {
    hedge: number;
    liquidation: number;
    range: number;
    dataQuality: number;
    basisRisk: number;
  };
}

export interface SolSystemSnapshot {
  systemId: "SOL_HEDGED_YIELD";
  asOfTs: string;
  pricesUsed: {
    sol: number;
  };
  dataFreshness: {
    hasMarkPrice: boolean;
    hasLiqPrice: boolean;
    hasRangeBuffer: boolean;
  };
  exposures: {
    totalLongSOL: number;
    totalShortSOL: number;
    netSOLDelta: number;
    hedgeRatio: number;
  };
  liquidation: {
    liqPrice: number | null;
    liqBufferRatio: number | null;
    leverage: number | null;
  };
  range: {
    rangeLower: number | null;
    rangeUpper: number | null;
    rangeBufferRatio: number | null;
  };
  basisRisk: {
    isProxyHedge: boolean;
    basisPenalty: number;
    reasonTag: string | null;
  };
  debugMath: {
    markPrice: number;
    liqBufferRatio: number | null;
    rangeBufferRatio: number | null;
    [key: string]: number | null;
  };
  reasons: string[];
}
