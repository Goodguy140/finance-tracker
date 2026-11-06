import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pageAt } from '@/utils/swipe';

export type SwipePage = { key: string; label: string; content: ReactNode };

/**
 * Pages that share one card, swiped sideways or picked from the pills under them: the website's
 * mobile carousel (`card-stack.tsx`). Sits inside a `Section` and reaches its edges, so a page
 * slides across the whole card. The card takes the height of the page on screen, easing between
 * the two as a swipe passes halfway.
 */
export function SwipePages(props: {
  pages: readonly SwipePage[];
  index: number;
  onIndexChange: (index: number) => void;
  /** False while something on a page is following a finger sideways (the chart being read). */
  scrollEnabled?: boolean;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const { pages } = props;
  const count = pages.length;
  const index = Math.min(Math.max(props.index, 0), count - 1);
  const scroller = useRef<ScrollViewInstance>(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  // The page most on screen right now, which sets the height; `index` changes once a swipe settles.
  const [live, setLive] = useState(index);
  // Where the scroll position was last put, so a change of `index` from a swipe is not scrolled to again.
  const placed = useRef<{ index: number; width: number } | null>(null);

  useEffect(() => {
    if (width <= 0) return;
    const was = placed.current;
    if (was && was.index === index && was.width === width) return;
    scroller.current?.scrollTo({ x: index * width, animated: was !== null && was.width === width });
    placed.current = { index, width };
  }, [index, width]);

  const settle = (x: number) => {
    const page = pageAt(x, width, count);
    placed.current = { index: page, width };
    if (page !== index) props.onIndexChange(page);
  };
  const height = heights[pages[live]?.key ?? ''];

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        scrollEnabled={props.scrollEnabled !== false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        style={[styles.scroller, height ? { height } : null]}
        contentContainerStyle={styles.track}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onScroll={(event) => {
          const page = pageAt(event.nativeEvent.contentOffset.x, width, count);
          if (page !== live) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setLive(page);
          }
        }}
        onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.x)}
        accessibilityLabel={props.accessibilityLabel}>
        {pages.map((page, i) => (
          <View
            key={page.key}
            style={[styles.page, { width: width || undefined }]}
            onLayout={(event) => {
              const measured = Math.ceil(event.nativeEvent.layout.height);
              setHeights((all) => (all[page.key] === measured ? all : { ...all, [page.key]: measured }));
            }}
            // Only the page on screen is read out; the pills move between them.
            accessibilityElementsHidden={i !== index}
            importantForAccessibility={i === index ? 'auto' : 'no-hide-descendants'}>
            {page.content}
          </View>
        ))}
      </ScrollView>
      <View style={styles.pills} accessibilityRole="tablist" accessibilityLabel={props.accessibilityLabel}>
        {pages.map((page, i) => {
          const selected = i === index;
          return (
            <Pressable
              key={page.key}
              onPress={() => props.onIndexChange(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              hitSlop={6}
              style={[
                styles.pill,
                selected ? { backgroundColor: theme.track, borderColor: theme.tint } : { borderColor: 'transparent' },
              ]}>
              <Text style={[styles.pillText, { color: selected ? theme.tint : theme.textSecondary }]}>{page.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  // Out to the card's edges, so pages slide across all of it.
  scroller: { marginHorizontal: -Spacing.three },
  track: { alignItems: 'flex-start' },
  page: { paddingHorizontal: Spacing.three },
  pills: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.two },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 13, fontWeight: '600' },
});
