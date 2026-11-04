import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FinancialScore } from '@/api/types';
import { ProgressBar } from '@/components/progress-bar';
import { Section } from '@/components/section';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bandTone, scoreChangeText } from '@/utils/insights';

type Scored = Extract<FinancialScore, { status: 'scored' }>;

/** The website's financial score card: the number, the four pillars, where to improve, and how it is worked out. */
export function ScoreCard({ score }: { score: FinancialScore }) {
  const theme = useTheme();
  if (score.status === 'insufficient') {
    return (
      <Section title="Financial score">
        <Text style={[styles.body, { color: theme.textSecondary }]}>{score.reason}</Text>
      </Section>
    );
  }
  const change = scoreChangeText(score);
  return (
    <Section title="Financial score">
      <View style={styles.hero} accessible accessibilityLabel={`Financial score ${score.score} out of 100, ${score.band}. ${change ?? ''}`}>
        <View style={styles.heroLine}>
          <Text style={[styles.heroNumber, { color: theme[bandTone(score.band)] }]}>{score.score}</Text>
          <Text style={[styles.band, { color: theme[bandTone(score.band)] }]}>{score.band}</Text>
        </View>
        {change ? <Text style={[styles.small, { color: theme.textSecondary }]}>{change}</Text> : null}
      </View>
      {score.pillars.map((pillar) => (
        <View
          key={pillar.id}
          style={styles.pillar}
          accessible
          accessibilityLabel={`${pillar.label}: ${pillar.score ?? 'not scored'}${pillar.note ? `. ${pillar.note}` : ''}`}>
          <View style={styles.line}>
            <Text style={[styles.label, { color: theme.text }]}>{pillar.label}</Text>
            <Text style={[styles.value, { color: theme[bandTone(pillar.band)] }]}>{pillar.score ?? '—'}</Text>
          </View>
          {pillar.score !== null ? <ProgressBar share={pillar.score / 100} color={theme[bandTone(pillar.band)]} /> : null}
          {pillar.note ? <Text style={[styles.small, { color: theme.textSecondary }]}>{pillar.note}</Text> : null}
        </View>
      ))}
      {score.suggestions.length ? (
        <View style={styles.block}>
          <Text style={[styles.heading, { color: theme.text }]} accessibilityRole="header">
            Where to improve
          </Text>
          {score.suggestions.map((suggestion, index) => (
            <Text key={suggestion} style={[styles.body, { color: theme.text }]}>
              {index + 1}. {suggestion}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={[styles.body, { color: theme.textSecondary }]}>Nothing stands out to work on. Keep it up.</Text>
      )}
      <HowItWorks score={score} />
    </Section>
  );
}

function HowItWorks({ score }: { score: Scored }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8}>
        <Text style={[styles.link, { color: theme.tint }]}>{open ? 'Hide how this is worked out' : 'How this is worked out'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.block}>
          {score.pillars
            .filter((pillar) => pillar.score !== null)
            .map((pillar) => (
              <View key={pillar.id} style={styles.block}>
                <Text style={[styles.caps, { color: theme.textSecondary }]} accessibilityRole="header">
                  {pillar.label}
                </Text>
                {score.factors
                  .filter((factor) => factor.pillar === pillar.id)
                  .map((factor) => (
                    <View
                      key={factor.id}
                      style={styles.pillar}
                      accessible
                      accessibilityLabel={`${factor.label}: ${factor.score}, ${Math.round(factor.weight * 100)}% of the score. ${factor.detail}`}>
                      <View style={styles.line}>
                        <Text style={[styles.label, { color: theme.text }]}>{factor.label}</Text>
                        <Text style={[styles.value, { color: theme.textSecondary }]}>
                          {factor.score} · {Math.round(factor.weight * 100)}%
                        </Text>
                      </View>
                      <ProgressBar share={Math.max(factor.score, 2) / 100} color={theme[bandTone(factor.band)]} />
                      <Text style={[styles.small, { color: theme.textSecondary }]}>{factor.detail}</Text>
                    </View>
                  ))}
              </View>
            ))}
          <Text style={[styles.small, { color: theme.textSecondary }]}>
            Each factor is scored 0–100 from your full months of income and spending and your account balances; the
            percentage is its share of the overall score. The emergency fund aims for {score.emergencyTargetMonths} months of
            your average spending.
          </Text>
          {score.otherCurrencyAccounts.length ? (
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              Left out as another currency: {score.otherCurrencyAccounts.map((a) => `${a.name} (${a.currency})`).join(', ')}.
            </Text>
          ) : null}
          {score.omitted.length ? (
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              Not counted: {score.omitted.map((o) => `${o.label.toLowerCase()} (${o.reason})`).join(', ')}.
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Spacing.one },
  heroLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  heroNumber: { fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'] },
  band: { fontSize: 20, fontWeight: '600' },
  pillar: { gap: Spacing.one },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two },
  label: { fontSize: 15, flexShrink: 1 },
  value: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  block: { gap: Spacing.two },
  heading: { fontSize: 15, fontWeight: '600' },
  caps: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  link: { fontSize: 15, fontWeight: '600' },
});
