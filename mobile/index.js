// App entry. The snooze button's background handler must be defined before anything else loads, so a tap on
// "Snooze 10 min" works even when the app is closed (Android runs only this bundle then, without any screen).
import "./src/lib/snooze";
import "expo-router/entry";
