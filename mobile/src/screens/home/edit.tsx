import { Button, Host, HStack, Image, List, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  environment,
  font,
  foregroundStyle,
  lineLimit,
} from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback } from 'react';
import { Alert, PlatformColor } from 'react-native';

import { useSession } from '@/session/session-provider';
import { useHomeLayout } from '@/state/home-layout';
import {
  addSection,
  DEFAULT_HOME_LAYOUT,
  hiddenSections,
  homeSection,
  isDefaultHomeLayout,
  moveSections,
  removeSection,
  type HomeSectionId,
} from '@/utils/home-layout';

/**
 * Edit Home: the cards on Home in their order, each with a red minus to take it off and a handle
 * to drag it up or down, and the cards not on Home with a green plus to add them, as iOS lays out
 * Control Center's controls. Each change shows on Home at once and is kept on the phone.
 */
export function EditHome() {
  const router = useRouter();
  const { session } = useSession();
  const [layout, change] = useHomeLayout(session?.deviceId ?? null);
  const hidden = hiddenSections(layout);

  const remove = useCallback((id: HomeSectionId) => change((current) => removeSection(current, id)), [change]);
  const renderShown = useCallback(
    ({ item }: { item: HomeSectionId }) => <ShownRow id={item} onRemove={() => remove(item)} />,
    [remove],
  );

  function reset() {
    Alert.alert('Reset Home?', 'Home goes back to the cards it started with, in their first order.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => change(() => DEFAULT_HOME_LAYOUT) },
    ]);
  }

  return (
    <>
      <Host style={{ flex: 1 }}>
        {/* Always editing, so every row on Home shows its drag handle. */}
        <List modifiers={[environment('editMode', 'active')]}>
          <Section
            title="On Home"
            footer={
              <Text>
                {layout.length === 0 ? 'Home is empty. Add a card from below.' : 'Drag a card by its handle to move it.'}
              </Text>
            }>
            <List.ForEach
              data={layout}
              keyExtractor={(id) => id}
              recycling={false}
              onMove={(sources, destination) => change((current) => moveSections(current, sources, destination))}>
              {renderShown}
            </List.ForEach>
          </Section>
          {hidden.length > 0 ? (
            <Section title="More cards">
              {hidden.map((id) => (
                <HiddenRow key={id} id={id} onAdd={() => change((current) => addSection(current, id))} />
              ))}
            </Section>
          ) : null}
          {!isDefaultHomeLayout(layout) ? (
            <Section>
              <Button label="Reset Home" role="destructive" onPress={reset} modifiers={[buttonStyle('borderless')]} />
            </Section>
          ) : null}
        </List>
      </Host>
      <Stack.Title>Edit Home</Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" onPress={() => router.back()}>
          Done
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

/**
 * A card on Home: a red minus that takes it off, then its name and what it shows; the list adds
 * the drag handle. Only the minus is a button, so a tap on the row never takes a card off. It is
 * borderless so it takes its own taps: a row-wide button does nothing while a list is editing.
 */
function ShownRow({ id, onRemove }: { id: HomeSectionId; onRemove: () => void }) {
  const section = homeSection(id);
  return (
    <HStack spacing={12}>
      <Button
        onPress={onRemove}
        modifiers={[buttonStyle('borderless'), accessibilityLabel(`Remove ${section.title}`), accessibilityHint('Takes it off Home')]}>
        <Image systemName="minus.circle.fill" color={PlatformColor('systemRed')} size={22} />
      </Button>
      <CardText id={id} />
    </HStack>
  );
}

/** A card not on Home: the whole row, green plus and all, adds it at the bottom of Home. */
function HiddenRow({ id, onAdd }: { id: HomeSectionId; onAdd: () => void }) {
  const section = homeSection(id);
  return (
    <Button
      onPress={onAdd}
      modifiers={[buttonStyle('borderless'), accessibilityLabel(`Add ${section.title}`), accessibilityHint(section.description)]}>
      <HStack spacing={12}>
        <Image systemName="plus.circle.fill" color={PlatformColor('systemGreen')} size={22} />
        <CardText id={id} />
      </HStack>
    </Button>
  );
}

/** Label colours set outright, so a row inside a button is not tinted. */
function CardText({ id }: { id: HomeSectionId }) {
  const section = homeSection(id);
  return (
    <>
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: 'body' }), foregroundStyle(PlatformColor('label')), lineLimit(1)]}>{section.title}</Text>
        <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(PlatformColor('secondaryLabel')), lineLimit(2)]}>
          {section.description}
        </Text>
      </VStack>
      <Spacer />
    </>
  );
}
