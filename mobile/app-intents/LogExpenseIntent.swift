import AppIntents
internal import ExpoAppIntents

/// "Log an expense in Finances": Siri asks how much, then the app opens on the Add sheet with that
/// amount (and, from the Shortcuts app, what it was for) filled in. Nothing is saved until the
/// person taps Add there, so the reply says the app is opening, not that anything was logged.
/// The JavaScript side is `useSiriAdds` (src/notifications/siri.ts); keep the name and keys in step.
struct LogExpenseIntent: AppIntent {
  static let title: LocalizedStringResource = "Log an Expense"
  static let description = IntentDescription("Opens Finances on a new expense with the amount filled in.")
  static let openAppWhenRun: Bool = true

  @Parameter(title: "Amount", requestValueDialog: IntentDialog("How much was it?"))
  var amount: Double

  @Parameter(title: "What for")
  var what: String?

  static var parameterSummary: some ParameterSummary {
    Summary("Log \(\.$amount)") {
      \.$what
    }
  }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    var params: AppIntentParams = ["amount": .double(amount)]
    if let what, !what.trimmingCharacters(in: .whitespaces).isEmpty {
      params["title"] = .string(what)
    }
    await AppIntentDispatcher.shared.dispatch(name: "logExpense", params: params)
    return .result(dialog: "Opening Finances so you can add it.")
  }
}
