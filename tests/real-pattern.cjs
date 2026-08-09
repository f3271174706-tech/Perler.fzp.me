const { chromium } = require("playwright");
const path = require("path");
const os = require("os");

const baseUrl = "http://127.0.0.1:4173/";
const imagePath = process.argv[2];
const [expectedCols, expectedRows] = (process.argv[3] || "104x104").split("x").map(Number);

if (!imagePath || !expectedCols || !expectedRows) {
  console.error("Usage: node tests/real-pattern.cjs <pattern-image> [colsxrows]");
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const startedAt = Date.now();
  await page.locator("#fileInput").setInputFiles(path.resolve(imagePath));
  await page.waitForFunction(() => state.analysisBusy === false && state.used.length > 0, null, { timeout: 30000 });

  const result = await page.evaluate(() => {
    const analysis = makeAnalysisCanvas(state.image);
    const scores = edgeScores(analysis.pixels, analysis.canvas.width, analysis.canvas.height);
    const summarizeCoverage = values => {
      const maximum = Math.max(...values);
      const threshold = maximum * .8;
      const peaks = [];
      let start = -1;
      for (let i = 0; i <= values.length; i++) {
        if (i < values.length && values[i] >= threshold) {
          if (start < 0) start = i;
        } else if (start >= 0) {
          peaks.push((start + i - 1) / 2);
          start = -1;
        }
      }
      return {
        maximum,
        peakCount: peaks.length,
        firstPeaks: peaks.slice(0, 12),
        gaps: peaks.slice(1, 13).map((peak, index) => peak - peaks[index])
      };
    };
    const summarizePeriod = (edges, coverage, period) => {
      let best = null;
      for (let phase = 0; phase < period; phase += .25) {
        const edgeValues = [], coverageValues = [];
        for (let position = phase; position < edges.length; position += period) {
          edgeValues.push(axisPeak(edges, position));
          coverageValues.push(axisPeak(coverage, position));
        }
        const score = quantile(edgeValues, .5) + quantile(coverageValues, .5);
        if (!best || score > best.score) best = {
          score,
          edgeMedian: quantile(edgeValues, .5),
          edgeLow: quantile(edgeValues, .2),
          coverageMedian: quantile(coverageValues, .5),
          coverageLow: quantile(coverageValues, .2)
        };
      }
      return best;
    };
    const cornerColors = new Map();
    if (state.grid) {
      const pixels = state.original.data;
      for (let row = 0; row < state.grid.rows; row++) for (let col = 0; col < state.grid.cols; col++) {
        const x = Math.floor(state.grid.left + (col + .25) * (state.grid.right - state.grid.left) / state.grid.cols);
        const y = Math.floor(state.grid.top + (row + .25) * (state.grid.bottom - state.grid.top) / state.grid.rows);
        const index = (y * state.original.width + x) * 4;
        const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]];
        const key = rgb.join(",");
        const item = cornerColors.get(key) || { rgb, code: nearestMard(rgb).code, count: 0 };
        item.count++;
        cornerColors.set(key, item);
      }
    }
    return ({
    image: { width: state.image.naturalWidth, height: state.image.naturalHeight },
    grid: state.grid ? {
      cols: state.grid.cols,
      rows: state.grid.rows,
      left: state.grid.left,
      top: state.grid.top,
      right: state.grid.right,
      bottom: state.grid.bottom,
      confidence: state.grid.confidence,
      filled: state.grid.cells.filter(Boolean).length,
      empty: state.grid.cells.filter(cell => !cell).length
    } : null,
    used: state.used.map(color => ({ code: color.code, count: color.count })),
    readout: document.querySelector("#gridSize")?.textContent,
    status: document.querySelector("#gridStatus")?.textContent,
    coverage: {
      x: summarizeCoverage(scores.verticalCoverage),
      y: summarizeCoverage(scores.horizontalCoverage)
    },
    periods: {
      x104: summarizePeriod(scores.vertical, scores.verticalCoverage, analysis.canvas.width / 104),
      x52: summarizePeriod(scores.vertical, scores.verticalCoverage, analysis.canvas.width / 52),
      y104: summarizePeriod(scores.horizontal, scores.horizontalCoverage, analysis.canvas.height / 104),
      y52: summarizePeriod(scores.horizontal, scores.horizontalCoverage, analysis.canvas.height / 52)
    },
    axes: {
      x: regularAxis(scores.vertical, scores.verticalCoverage),
      y: regularAxis(scores.horizontal, scores.horizontalCoverage)
    },
    cornerColors: [...cornerColors.values()].sort((a, b) => b.count - a.count)
  });
  });
  result.elapsedMs = Date.now() - startedAt;
  result.errors = errors;
  result.url = page.url();
  result.title = await page.title();
  result.screenshot = path.join(os.tmpdir(), "perler-real-104-after.png");
  await page.screenshot({ path: result.screenshot, fullPage: false });

  console.log(JSON.stringify(result));
  await browser.close();
  if (!result.grid || result.grid.cols !== expectedCols || result.grid.rows !== expectedRows || errors.length) process.exit(1);
})();
