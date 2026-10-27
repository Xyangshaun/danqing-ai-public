// 丹青有AI 空态占位(水墨色系)
import { StyleSheet, Text, View } from 'react-native';
import { InkColor } from '../theme/colors';

export function EmptyState({
  message,
  hint,
}: {
  message: string;
  hint?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.message}>{message}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  message: {
    fontSize: 15,
    fontWeight: '500',
    color: InkColor,
    opacity: 0.7,
    textAlign: 'center',
  },
  hint: {
    marginTop: 8,
    fontSize: 13,
    color: InkColor,
    opacity: 0.5,
    textAlign: 'center',
  },
});
