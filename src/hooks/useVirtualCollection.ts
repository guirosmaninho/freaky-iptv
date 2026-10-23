import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, UIEvent } from 'react';
import { calculateCollectionWindow, getCollectionColumns } from '../services/collectionWindow';

interface VirtualCollectionOptions {
  itemCount: number;
  itemHeight: number;
  gap: number;
  minimumWidth?: number;
  initialScrollTop: number;
  onScrollTop: (scrollTop: number) => void;
  leadingHeight?: number;
  threshold?: number;
}

export function useVirtualCollection({
  itemCount, itemHeight, gap, minimumWidth, initialScrollTop, onScrollTop, leadingHeight = 0, threshold = 100
}: VirtualCollectionOptions) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef(true);
  const [viewport, setViewport] = useState({ width: 900, height: 600, scrollTop: initialScrollTop, measured: false });
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const columns = minimumWidth ? getCollectionColumns(viewport.width, minimumWidth, gap) : 1;
  const virtualized = itemCount > threshold;
  const collectionWindow = useMemo(() => calculateCollectionWindow({
    itemCount,
    columns,
    itemHeight,
    gap,
    scrollTop: Math.max(0, viewport.scrollTop - leadingHeight),
    viewportHeight: viewport.height,
    focusedIndex
  }), [itemCount, columns, itemHeight, gap, viewport.scrollTop, viewport.height, leadingHeight, focusedIndex]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const measure = () => {
      setViewport({
        width: container.clientWidth - 4,
        height: container.clientHeight,
        scrollTop: restoreScrollRef.current ? initialScrollTop : container.scrollTop,
        measured: true
      });
    };
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [initialScrollTop]);

  useEffect(() => {
    if (!viewport.measured || itemCount === 0 || !restoreScrollRef.current) return;
    // Restore only after the measured column count has sized the complete list.
    // Restoring against an estimated grid can clamp a saved position too early.
    const frame = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container || !restoreScrollRef.current) return;
      container.scrollTop = initialScrollTop;
      restoreScrollRef.current = false;
      setViewport(previous => ({ ...previous, scrollTop: container.scrollTop }));
    });
    return () => cancelAnimationFrame(frame);
  }, [viewport.measured, columns, initialScrollTop, itemCount]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const scrollTop = container.scrollTop;
    restoreScrollRef.current = false;
    onScrollTop(scrollTop);
    setViewport(previous => {
      if (previous.scrollTop === scrollTop) return previous;
      const stride = Math.max(1, itemHeight + gap);
      const previousTop = Math.max(0, previous.scrollTop - leadingHeight);
      const nextTop = Math.max(0, scrollTop - leadingHeight);
      // Pixel scrolling is handled by the browser. React only needs to update
      // when a row enters/leaves the virtual window.
      if (Math.floor(previousTop / stride) === Math.floor(nextTop / stride) &&
          Math.ceil((previousTop + previous.height) / stride) === Math.ceil((nextTop + previous.height) / stride)) return previous;
      return { ...previous, scrollTop };
    });
  }, [onScrollTop, itemHeight, gap, leadingHeight]);

  const resetScroll = useCallback(() => {
    restoreScrollRef.current = false;
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    onScrollTop(0);
    setViewport(previous => ({ ...previous, scrollTop: 0 }));
  }, [onScrollTop]);

  const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const element = event.target.closest<HTMLElement>('[data-virtual-index]');
    setFocusedIndex(element ? Number(element.dataset.virtualIndex) : null);
  }, []);

  const handleBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedIndex(null);
  }, []);

  return { scrollContainerRef, handleScroll, resetScroll, handleFocusCapture, handleBlurCapture, columns, virtualized, window: collectionWindow };
}
