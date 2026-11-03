import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture, type NativeGesture } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { clampSwipe, settleSwipe, SWIPE_ACTION_WIDTH } from '@/utils/swipe';

/** A button a swipe uncovers. Fixed colours, so its white label reads in dark mode too. */
export type SwipeAction = { label: string; color: string; onPress: () => void };

type SwipeList = {
  scrollGesture: NativeGesture | null;
  opened: (close: () => void) => void;
  closed: (close: () => void) => void;
};

const SwipeListContext = createContext<SwipeList>({ scrollGesture: null, opened: () => {}, closed: () => {} });
export const SwipeListProvider = SwipeListContext.Provider;

/**
 * For a scroll view holding swipe rows. Spread `scrollProps` on gesture handler's `ScrollView` (not
 * React Native's) and give `value` to `SwipeListProvider` around the rows.
 *
 * The scroll then waits for each row's sideways drag to fail before it moves, and a row's drag
 * fails as soon as the finger has gone 10 points up or down. Without that, the list and the row
 * raced for every drag and the list often won a swipe. Only one row stays open, as in Mail, and
 * scrolling closes it.
 */
export function useSwipeList() {
  const [scrollGesture, setScrollGesture] = useState<NativeGesture | null>(null);
  const openRow = useRef<(() => void) | null>(null);
  const value = useMemo<SwipeList>(
    () => ({
      scrollGesture,
      opened: (close) => {
        if (openRow.current && openRow.current !== close) openRow.current();
        openRow.current = close;
      },
      closed: (close) => {
        if (openRow.current === close) openRow.current = null;
      },
    }),
    [scrollGesture],
  );
  const scrollProps = {
    onGestureUpdate_CAN_CAUSE_INFINITE_RERENDER: (gesture: NativeGesture) =>
      setScrollGesture((current) => (current?.handlerTag === gesture.handlerTag ? current : gesture)),
    onScrollBeginDrag: () => openRow.current?.(),
  };
  return { value, scrollProps };
}

const SPRING = { mass: 1, damping: 30, stiffness: 300, overshootClamping: true, reduceMotion: ReduceMotion.System };

/**
 * A row that swipes. Dragging it right uncovers `leading`, left uncovers `trailing`; a tap on the
 * uncovered button does it, and a tap on the row closes it again. A drag alone never acts.
 */
export function SwipeRow(props: {
  leading?: SwipeAction;
  trailing?: SwipeAction;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { leading, trailing, enabled = true, style, children } = props;
  const list = useContext(SwipeListContext);
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const hasLeading = leading !== undefined;
  const hasTrailing = trailing !== undefined;
  const { opened, closed } = list;

  const close = useCallback(() => {
    x.set(withSpring(0, SPRING));
    setOpen(false);
  }, [x]);

  const settled = useCallback(
    (target: number) => {
      setOpen(target !== 0);
      if (target === 0) closed(close);
      else opened(close);
    },
    [close, closed, opened],
  );

  // A row that leaves the list (decided, deleted) must not stay the open one.
  useEffect(() => () => closed(close), [close, closed]);

  const pan = usePanGesture({
    enabled: enabled && (hasLeading || hasTrailing),
    activeOffsetX: [-10, 10],
    failOffsetY: [-10, 10],
    block: list.scrollGesture ?? undefined,
    onActivate: () => {
      'worklet';
      start.set(x.get());
    },
    onUpdate: (event) => {
      'worklet';
      x.set(clampSwipe(start.get() + event.translationX, SWIPE_ACTION_WIDTH, hasLeading, hasTrailing));
    },
    onDeactivate: (event) => {
      'worklet';
      const target = settleSwipe(x.get(), event.velocityX, SWIPE_ACTION_WIDTH, hasLeading, hasTrailing);
      x.set(withSpring(target, { ...SPRING, velocity: event.velocityX }));
      scheduleOnRN(settled, target);
    },
  });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const leadingStyle = useAnimatedStyle(() => ({ width: Math.max(x.get(), 0) }));
  const trailingStyle = useAnimatedStyle(() => ({ width: Math.max(-x.get(), 0) }));

  const act = (action: SwipeAction) => {
    close();
    action.onPress();
  };

  return (
    <Animated.View style={[styles.container, style]}>
      {leading ? (
        <Animated.View style={[styles.action, styles.leading, leadingStyle, { backgroundColor: leading.color }]}>
          <ActionButton action={leading} onPress={() => act(leading)} />
        </Animated.View>
      ) : null}
      {trailing ? (
        <Animated.View style={[styles.action, styles.trailing, trailingStyle, { backgroundColor: trailing.color }]}>
          <ActionButton action={trailing} onPress={() => act(trailing)} />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>
          {children}
          {open ? (
            // While open, a tap on the row closes it instead of opening it.
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={close}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function ActionButton({ action, onPress }: { action: SwipeAction; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.8 : 1 }]}>
      <Text style={styles.label} numberOfLines={1} ellipsizeMode="clip">
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  action: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  leading: { left: 0 },
  trailing: { right: 0 },
  button: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
