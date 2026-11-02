import * as ImagePicker from 'expo-image-picker';
import { ActionSheetIOS, Alert, Linking } from 'react-native';

import { receiptFromAsset, type ReceiptPhoto } from '@/utils/receipts';

/** Lighter than the camera's own file, still sharp enough to read a receipt. */
const QUALITY = 0.6;

function chooseSource(): Promise<'camera' | 'library' | null> {
  return new Promise((resolve) =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Take Photo', 'Choose from Library', 'Cancel'], cancelButtonIndex: 2, title: 'Receipt' },
      (index) => resolve(index === 0 ? 'camera' : index === 1 ? 'library' : null),
    ),
  );
}

/**
 * Asks where the receipt comes from, then takes or picks one photo. Null when the person cancels
 * or refuses; problems (camera access off, a photo too big) are explained in an alert here.
 */
export async function pickReceipt(): Promise<ReceiptPhoto | null> {
  const source = await chooseSource();
  if (!source) return null;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access is off', 'Allow Finances to use the camera in Settings to photograph receipts.', [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ]);
      return null;
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: QUALITY };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const picked = receiptFromAsset(asset);
  if ('error' in picked) {
    Alert.alert('That photo is too big', picked.error);
    return null;
  }
  return picked.photo;
}
