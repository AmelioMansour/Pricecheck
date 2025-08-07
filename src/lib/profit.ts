export type ProfitInputs = {
  buyPrice: number | null;
  soldMedian: number;
  shipCost: number;
  feePct: number;
  feeFixed: number;
  taxPct: number;
};

export function calcNet(i: ProfitInputs) {
  const buy = i.buyPrice ?? 0;
  const fees = i.soldMedian * i.feePct + i.feeFixed;
  const tax = buy * i.taxPct;
  const net = i.soldMedian - fees - i.shipCost - tax;
  const profit = net - buy;
  const margin = i.soldMedian ? profit / i.soldMedian : 0;
  return { net, profit, margin };
}
