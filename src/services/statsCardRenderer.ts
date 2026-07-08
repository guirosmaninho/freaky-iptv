import type { StatsCardData } from './statsCalculator';

export const STATS_CARD_WIDTH = 1200;
export const STATS_CARD_HEIGHT = 736;

export async function renderStatsCard(data: StatsCardData): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = STATS_CARD_WIDTH;
  canvas.height = STATS_CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available.');

  // Load the logo image asynchronously
  const logo = new Image();
  logo.src = 'cat_icon.png';

  await new Promise<void>((resolve) => {
    logo.onload = () => resolve();
    logo.onerror = () => resolve();
    // Safety timeout of 2 seconds
    setTimeout(resolve, 2000);
  });

  drawCard(context, data, logo.complete && logo.width > 0 ? logo : null);
  const blob = await canvasToPng(canvas);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!hasPngSignature(bytes)) throw new Error('The generated statistics card is not a valid PNG.');
  return bytes;
}

export function createStatsCardObjectUrl(png: Uint8Array): string {
  return URL.createObjectURL(new Blob([png.slice().buffer], { type: 'image/png' }));
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function drawCard(context: CanvasRenderingContext2D, data: StatsCardData, logo: HTMLImageElement | null) {
  // 1. Draw premium linear background
  const bgGrad = context.createLinearGradient(0, 0, STATS_CARD_WIDTH, STATS_CARD_HEIGHT);
  bgGrad.addColorStop(0, '#0c101b');
  bgGrad.addColorStop(1, '#05070d');
  context.fillStyle = bgGrad;
  context.fillRect(0, 0, STATS_CARD_WIDTH, STATS_CARD_HEIGHT);

  // 2. Draw soft aurora radial glows
  const glowTopLeft = context.createRadialGradient(0, 0, 50, 0, 0, 800);
  glowTopLeft.addColorStop(0, 'rgba(31, 122, 255, 0.14)');
  glowTopLeft.addColorStop(1, 'transparent');
  context.fillStyle = glowTopLeft;
  context.beginPath();
  context.arc(0, 0, 800, 0, Math.PI * 2);
  context.fill();

  const glowBottomRight = context.createRadialGradient(STATS_CARD_WIDTH, STATS_CARD_HEIGHT, 50, STATS_CARD_WIDTH, STATS_CARD_HEIGHT, 600);
  glowBottomRight.addColorStop(0, 'rgba(32, 208, 113, 0.07)');
  glowBottomRight.addColorStop(1, 'transparent');
  context.fillStyle = glowBottomRight;
  context.beginPath();
  context.arc(STATS_CARD_WIDTH, STATS_CARD_HEIGHT, 600, 0, Math.PI * 2);
  context.fill();

  // 3. Draw Header with optional logo and text
  const headerY = 30;
  let titleX = 64;

  if (logo) {
    context.drawImage(logo, 48, headerY, 140, 140);
    titleX = 212;
  }

  context.fillStyle = '#ffffff';
  context.font = '800 76px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
  context.fillText('Freaky IPTV', titleX, headerY + 98);

  // 4. Draw Heatmap Panel (subtle glassmorphism)
  const panelX = 32;
  const panelY = 196;
  const panelW = 1136;
  const panelH = 216;

  context.fillStyle = 'rgba(255, 255, 255, 0.02)';
  context.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(panelX, panelY, panelW, panelH, 16);
  context.fill();
  context.stroke();

  // Draw Heatmap Header with Dates inside
  context.fillStyle = 'rgba(244, 247, 255, 0.4)';
  context.font = '700 13px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
  context.fillText('ACTIVITY HISTORY', panelX + 24, panelY + 32);

  context.fillStyle = 'rgba(244, 247, 255, 0.7)';
  context.font = '600 14px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
  context.textAlign = 'end';
  context.fillText(`${data.periodStart} – ${data.periodEnd}`, panelX + panelW - 24, panelY + 32);
  context.textAlign = 'start'; // restore default

  drawHeatmap(context, data);

  // 5. Draw Metrics Panel
  drawMetrics(context, data);
}

function drawHeatmap(context: CanvasRenderingContext2D, data: StatsCardData) {
  const size = 14;
  const gap = 4;
  const panelX = 32;
  const panelY = 196;
  const panelW = 1136;
  const gridW = 53 * (size + gap) - gap;
  
  // Center grid and weekday labels together (weekdays take ~35px + 15px gap = 50px)
  const totalContentW = 50 + gridW;
  const startX = panelX + Math.round((panelW - totalContentW) / 2) + 50;
  const startY = panelY + 58;

  // 1. Draw Weekday labels
  context.fillStyle = 'rgba(244, 247, 255, 0.45)';
  context.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  context.textAlign = 'end';
  context.fillText('Mon', startX - 12, startY + 1 * 18 + 11);
  context.fillText('Wed', startX - 12, startY + 3 * 18 + 11);
  context.fillText('Fri', startX - 12, startY + 5 * 18 + 11);
  context.textAlign = 'start'; // restore

  // 2. Draw Month labels dynamically above columns
  let lastMonth = -1;
  for (let col = 0; col < 53; col += 1) {
    const cellIndex = col * 7;
    if (cellIndex < data.heatmapCells.length) {
      const date = data.heatmapCells[cellIndex].date;
      const month = date.getMonth();
      if (month !== lastMonth) {
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        const labelX = startX + col * (size + gap);
        context.fillStyle = 'rgba(244, 247, 255, 0.45)';
        context.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
        context.fillText(monthName, labelX, startY - 12);
        lastMonth = month;
      }
    }
  }

  // 3. Draw Heatmap cells
  const firstDayOffset = data.heatmapCells[0]?.date.getDay() ?? 0;

  for (let index = 0; index < data.heatmapCells.length; index += 1) {
    const cell = data.heatmapCells[index];
    const gridIndex = index + firstDayOffset;
    const column = Math.floor(gridIndex / 7);
    const row = gridIndex % 7;
    context.fillStyle = cell.intensity > 0
      ? activityColour(cell.intensity)
      : '#171c2c'; // Clean deep navy matching the background
    roundedRect(context, startX + column * (size + gap), startY + row * (size + gap), size, size, 3);
    context.fill();
  }

  // 4. Draw Legend at bottom right
  const legendX = startX + gridW - 160;
  const legendY = panelY + 203;
  context.fillStyle = 'rgba(244, 247, 255, 0.4)';
  context.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  context.fillText('Less', legendX, legendY);

  const boxSize = 10;
  const boxGap = 4;
  const colors = ['#171c2c', '#194362', '#205f91', '#287fc5', '#39a6ff'];
  colors.forEach((color, i) => {
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(legendX + 32 + i * (boxSize + boxGap), legendY - 8, boxSize, boxSize, 2);
    context.fill();
  });

  context.fillStyle = 'rgba(244, 247, 255, 0.4)';
  context.fillText('More', legendX + 32 + 5 * (boxSize + boxGap) + 4, legendY);
}

function drawMetrics(context: CanvasRenderingContext2D, data: StatsCardData) {
  const panelX = 32;
  const metricsPanelY = 432;
  const metricsPanelH = 272;

  const cardW = 272;
  const gap = 16;

  // Helper to draw a glass card container
  const drawGlassCard = (x: number, y: number, w: number, h: number) => {
    context.fillStyle = 'rgba(255, 255, 255, 0.025)';
    context.beginPath();
    context.roundRect(x, y, w, h, 16);
    context.fill();

    const borderGrad = context.createLinearGradient(x, y, x, y + h);
    borderGrad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    borderGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    context.strokeStyle = borderGrad;
    context.lineWidth = 1;
    context.stroke();
  };

  // 1. Column 0: TIME WATCHED (Full height)
  {
    const cardX = panelX;
    const cardY = metricsPanelY;
    const centreX = cardX + cardW / 2;
    
    drawGlassCard(cardX, cardY, cardW, metricsPanelH);

    // Value
    context.fillStyle = '#ffffff';
    context.font = '700 56px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
    context.textAlign = 'center';
    context.fillText(data.totalWatchTime, centreX, cardY + 135);

    // Label
    context.fillStyle = 'rgba(244, 247, 255, 0.45)';
    context.font = '700 13px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    context.fillText('TIME WATCHED', centreX, cardY + 230);
  }

  // 2. Column 1: Stacked SESSIONS (Top) & UNIQUE CHANNELS (Bottom)
  {
    const cardX = panelX + cardW + gap;
    const centreX = cardX + cardW / 2;
    const stackedH = 128;
    const verticalGap = 16;

    // Top Card: SESSIONS
    {
      const cardY = metricsPanelY;
      drawGlassCard(cardX, cardY, cardW, stackedH);

      // Value
      context.fillStyle = '#ffffff';
      context.font = '700 48px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
      context.textAlign = 'center';
      context.fillText(data.totalSessions, centreX, cardY + 65);

      // Label
      context.fillStyle = 'rgba(244, 247, 255, 0.45)';
      context.font = '700 11px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
      context.fillText('SESSIONS', centreX, cardY + 105);
    }

    // Bottom Card: UNIQUE CHANNELS
    {
      const cardY = metricsPanelY + stackedH + verticalGap;
      drawGlassCard(cardX, cardY, cardW, stackedH);

      // Value
      context.fillStyle = '#ffffff';
      context.font = '700 48px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
      context.textAlign = 'center';
      context.fillText(data.uniqueChannelsWatched, centreX, cardY + 65);

      // Label
      context.fillStyle = 'rgba(244, 247, 255, 0.45)';
      context.font = '700 11px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
      context.fillText('UNIQUE CHANNELS', centreX, cardY + 105);
    }
  }

  // 3. Column 2: LONGEST SESSION (Full height)
  {
    const cardX = panelX + 2 * (cardW + gap);
    const cardY = metricsPanelY;
    const centreX = cardX + cardW / 2;

    drawGlassCard(cardX, cardY, cardW, metricsPanelH);

    // Value
    context.fillStyle = '#ffffff';
    context.font = '700 56px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
    context.textAlign = 'center';
    context.fillText(data.longestSession, centreX, cardY + 105);

    // Glowing Badge for channel name
    const tagText = truncate(data.longestSessionChannel || '-', 20);
    context.font = '700 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = context.measureText(tagText).width;
    const rectW = Math.min(cardW - 24, textW + 24);
    const rectH = 30;
    const rectX = centreX - rectW / 2;
    const rectY = cardY + 135;

    context.save();
    context.shadowColor = 'rgba(0, 242, 254, 0.4)';
    context.shadowBlur = 8;
    context.fillStyle = 'rgba(0, 242, 254, 0.1)';
    context.strokeStyle = 'rgba(0, 242, 254, 0.45)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.roundRect(rectX, rectY, rectW, rectH, 15);
    context.fill();
    context.stroke();
    context.restore();

    const textGrad = context.createLinearGradient(rectX, 0, rectX + rectW, 0);
    textGrad.addColorStop(0, '#00f2fe');
    textGrad.addColorStop(1, '#4facfe');
    context.fillStyle = textGrad;
    context.fillText(tagText, centreX, rectY + 19);

    // Label
    context.fillStyle = 'rgba(244, 247, 255, 0.45)';
    context.font = '700 13px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    context.fillText('LONGEST SESSION', centreX, cardY + 230);
  }

  // 4. Column 3: FAVORITE CHANNEL (Full height)
  {
    const cardX = panelX + 3 * (cardW + gap);
    const cardY = metricsPanelY;
    const centreX = cardX + cardW / 2;

    drawGlassCard(cardX, cardY, cardW, metricsPanelH);

    // Channel name with gradient
    const valGrad = context.createLinearGradient(centreX - 80, 0, centreX + 80, 0);
    valGrad.addColorStop(0, '#39a6ff');
    valGrad.addColorStop(1, '#20d071');
    context.fillStyle = valGrad;
    context.font = getFontSizeForValue(data.favoriteChannel);
    context.fillText(data.favoriteChannel, centreX, cardY + 135);

    // Label
    context.fillStyle = 'rgba(244, 247, 255, 0.45)';
    context.font = '700 13px system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
    context.fillText('FAVORITE CHANNEL', centreX, cardY + 230);
  }

  context.textAlign = 'start';
}

function getFontSizeForValue(value: string): string {
  if (value.length > 20) return '700 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  if (value.length > 15) return '700 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  if (value.length > 10) return '700 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  return '700 42px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
}

function activityColour(intensity: number): string {
  if (intensity >= 0.8) return '#39a6ff';
  if (intensity >= 0.55) return '#287fc5';
  if (intensity >= 0.3) return '#205f91';
  return '#194362';
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to encode the statistics card as PNG.'));
    }, 'image/png');
  });
}
