---
title: React Native and Expo
department: engineering
stacks: [expo, react-native]
paths:
  - "app/**/*.{ts,tsx,js,jsx}"
  - "src/**/*.{ts,tsx,js,jsx}"
  - "components/**/*.{ts,tsx,js,jsx}"
  - "hooks/**/*.{ts,tsx}"
  - "app.config.{ts,js}"
---
- Check the installed Expo SDK and React Native versions before using an API; read the docs for that version.
- Add native packages with `npx expo install <pkg>` so versions match the SDK; never hand-pick a version.
- A change to native config, permissions or a package with native code needs a new development build; say so.
- Use the router's file-based routes for screens; keep screen files thin and move logic into hooks and modules.
- Wrap screens in safe-area handling; never hard-code status-bar or notch heights.
- Long lists use a virtualised list with stable keys; never map hundreds of items into a ScrollView.
- Keep work off the JS thread during interactions: no heavy computation in render; animations run on the UI thread.
- Images: size them for the device, cache remote images, and give every meaningful image an accessibility label.
- Every pressable element has `accessibilityRole` and a label; touch targets are at least 44x44 points.
- Text scales with the system font size; test the largest dynamic type setting.
- Store tokens and secrets in the platform's secure storage, never in AsyncStorage or the bundle.
- Request permissions in context with a pre-prompt explaining why; handle "denied" and "limited" states.
- Handle offline and slow networks: show progress, keep the last good data, retry with backoff.
- Use platform-specific files or `Platform.select` for real platform differences, not scattered `if` checks.
- Keyboard: inputs stay visible above the keyboard and the return key moves to the next field or submits.
