export interface CollectionWindowOptions {
  itemCount: number;
  columns?: number;
  itemHeight: number;
  gap?: number;
  scrollTop: number;
  viewportHeight: number;
  overscanRows?: number;
  focusedIndex?: number | null;
}

export function getCollectionColumns(width: number, minimumWidth: number, gap = 14): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (Math.max(1, minimumWidth) + gap)));
}

export function calculateCollectionWindow({
  itemCount, columns = 1, itemHeight, gap = 0, scrollTop, viewportHeight, overscanRows = 3, focusedIndex
}: CollectionWindowOptions) {
  const safeCount = Math.max(0, Math.floor(itemCount));
  const safeColumns = Math.max(1, Math.floor(columns));
  const stride = Math.max(1, itemHeight + gap);
  const rowCount = Math.ceil(safeCount / safeColumns);
  const totalHeight = Math.max(0, rowCount * stride - gap);
  const safeScrollTop = Math.min(Math.max(0, scrollTop), Math.max(0, totalHeight - viewportHeight));
  const startRow = Math.max(0, Math.floor(safeScrollTop / stride) - overscanRows);
  const endRow = Math.min(rowCount, Math.ceil((safeScrollTop + Math.max(1, viewportHeight)) / stride) + overscanRows);
  const rows = new Set<number>();
  for (let row = startRow; row < endRow; row += 1) rows.add(row);

  // Keep the active control and neighbouring rows mounted so Tab/Shift+Tab can
  // continue through the collection even after pointer scrolling far away.
  if (focusedIndex != null && focusedIndex >= 0 && focusedIndex < safeCount) {
    const focusedRow = Math.floor(focusedIndex / safeColumns);
    for (let row = Math.max(0, focusedRow - 1); row <= Math.min(rowCount - 1, focusedRow + 1); row += 1) rows.add(row);
  }

  return {
    totalHeight,
    rowCount,
    rows: [...rows].sort((left, right) => left - right).map(row => ({
      row,
      top: row * stride,
      startIndex: row * safeColumns,
      endIndex: Math.min(safeCount, (row + 1) * safeColumns)
    }))
  };
}
