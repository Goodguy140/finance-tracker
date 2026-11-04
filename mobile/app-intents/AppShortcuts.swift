import AppIntents

/// What Siri and the Shortcuts app offer for Finances. Phrases are compiled into the app: a new
/// one needs a new build. Every phrase must include \(.applicationName), and an app can have at
/// most 10 App Shortcuts.
struct AppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: LogExpenseIntent(),
      phrases: [
        "Log an expense in \(.applicationName)",
        "Add an expense in \(.applicationName)",
        "Log a purchase in \(.applicationName)"
      ],
      shortTitle: "Log an Expense",
      systemImageName: "plus.circle"
    )
  }
}
