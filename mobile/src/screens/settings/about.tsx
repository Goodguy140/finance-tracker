import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/form';
import { ListRow } from '@/components/list-row';
import { Section } from '@/components/section';
import { useTheme } from '@/hooks/use-theme';
import { buildText, PENDING_NOTE, shortRuntime, updateText } from '@/utils/app-version';

/**
 * Which build of the app is installed (as TestFlight numbers it) and which EAS update it is running,
 * so a phone can be matched against `eas update:list` or expo.dev without guessing.
 */
export function AboutSection() {
  const theme = useTheme();
  const { currentlyRunning, isUpdatePending } = Updates.useUpdates();
  const [restarting, setRestarting] = useState(false);
  const update = updateText({ enabled: Updates.isEnabled, ...currentlyRunning });
  const updateId = currentlyRunning.isEmbeddedLaunch ? null : (currentlyRunning.updateId ?? null);
  const runtime = shortRuntime(currentlyRunning.runtimeVersion);
  const valueStyle = [styles.value, { color: theme.textSecondary }];

  async function restart() {
    setRestarting(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setRestarting(false);
      Alert.alert('The app did not restart', 'Close it and open it again to start the new update.');
    }
  }

  return (
    <Section
      title="About this app"
      list
      footer={`${isUpdatePending ? `${PENDING_NOTE} ` : ''}The build is what TestFlight installed. An update is newer code the app downloads by itself between builds.`}>
      <FormField label="Version">
        <Text style={valueStyle} selectable>
          {buildText({ version: Application.nativeApplicationVersion, build: Application.nativeBuildVersion })}
        </Text>
      </FormField>
      <View style={styles.stack}>
        <FormField label="Update" note={update.note}>
          <Text style={valueStyle}>{update.value}</Text>
        </FormField>
        {updateId ? (
          <Text style={[styles.id, { color: theme.textSecondary }]} selectable accessibilityLabel={`Update ID ${updateId}`}>
            {updateId}
          </Text>
        ) : null}
      </View>
      {currentlyRunning.channel ? (
        <FormField label="Channel">
          <Text style={valueStyle}>{currentlyRunning.channel}</Text>
        </FormField>
      ) : null}
      {runtime ? (
        <FormField label="Runtime">
          <Text style={valueStyle} selectable>
            {runtime}
          </Text>
        </FormField>
      ) : null}
      {isUpdatePending ? <ListRow label="Restart Now" kind="action" onPress={() => void restart()} disabled={restarting} /> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 4 },
  value: { fontSize: 17, fontVariant: ['tabular-nums'] },
  id: { fontSize: 12, fontFamily: 'Menlo' },
});
