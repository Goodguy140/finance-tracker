import { useLocalSearchParams } from 'expo-router';

import { EditCategory } from '@/screens/categories/edit';

/** The sheet for adding a category, or renaming, grouping or deleting one (`id`). */
export default function CategoryEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <EditCategory id={id ?? null} />;
}
