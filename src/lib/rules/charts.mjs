/** Charts: series count, order, contrast, direct labelling. */
import { floors, colorName, chart as chartTokens, fallbacks, chartSeries, chartSeriesOnLight, chartSeriesOnDark } from '../tokens.mjs';
import { contrast, safeVariant } from '../contrast.mjs';

export function checkCharts(ctx, spec, add) {
  const { palette } = ctx;
  if (!spec.chart) return;
  const { series = [], labelledDirectly = true } = spec.chart;
  const bg = spec.chart.background ?? spec.background ?? palette.background;
  if (spec.chart.legend) add('chart-legend', 'Series are labelled directly; a legend that forces a lookup is not permitted', { chart: spec.chart });
  if (series.length > chartTokens.maxSeries) add('series-count', `${series.length} series; ${chartTokens.maxSeries} is the most that read. Use small multiples`, { chart: spec.chart });
  // Series order: the colours used must be the first N of one of the series lists, in order.
  const lists = [chartSeries, chartSeriesOnLight, chartSeriesOnDark];
  const norm = (h) => String(h).toUpperCase();
  if (series.length && !lists.some((list) => series.every((hex, i) => norm(list[i]) === norm(hex)))) {
    add('series-order', `Series colours must follow a series list in order (${series.map((h) => colorName(h) ?? h).join(', ')})`, { chart: spec.chart });
  }
  series.forEach((hex, i) => {
    const ratio = contrast(hex, bg);
    if (ratio < chartTokens.minMarkContrast) {
      const suggestion = safeVariant(hex, bg, floors.largeTextPx, 400, { fallbacks, colorName, floors });
      add('series-contrast', `Series ${i + 1} (${colorName(hex) ?? hex}) is ${ratio.toFixed(2)}:1 on its ground, below ${chartTokens.minMarkContrast}:1.${suggestion ? ` Use ${colorName(suggestion)} ${suggestion}.` : ''}`, { index: i, ratio, suggestion });
    }
  });
  if (!labelledDirectly) {
    add('series-unlabelled', 'Chart series are labelled directly; a legend that forces a lookup is not enough');
    for (let i = 1; i < series.length; i++) {
      const ratio = contrast(series[i - 1], series[i]);
      if (ratio < chartTokens.minNeighbourContrast) {
        add('series-indistinct', `Series ${i} and ${i + 1} differ by only ${ratio.toFixed(2)}:1 in luminance and carry meaning by colour alone`, { index: i, ratio });
      }
    }
  }
}
