import { Stack } from "expo-router";

export default function DrawerGroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#f8f8ff" },
        fullScreenGestureEnabled: true,
      }}
    />
  );
}
