import AuthenticationServices
internal import ExpoModulesCore

/// Face ID sign-in with a passkey for the app's home server (`src/session/passkeys.ts`).
///
/// iOS offers a domain's passkeys to this app only when the app's entitlements name the domain
/// (`webcredentials:`, from `HOME_SERVER_DOMAIN` in app.config.ts) and the server's
/// `/.well-known/apple-app-site-association` names the app. For any other domain the request
/// fails, and the app signs in on the server's web page instead.
///
/// An Expo inline module: the class is named after this file. Do not rename one without the other.
final class Passkeys: Module {
  public func definition() -> ExpoModulesCore.ModuleDefinition {
    Name("Passkeys")

    /// `challenge` is standard base64. Resolves with the assertion's fields, each standard
    /// base64; rejects with ERR_PASSKEY_CANCELLED when the person closes the sheet.
    AsyncFunction("signIn") { (rpId: String, challenge: String, promise: Promise) in
      guard let challengeData = Data(base64Encoded: challenge) else {
        promise.reject("ERR_PASSKEY_CHALLENGE", "The server's sign-in challenge could not be read.")
        return
      }
      PasskeyAssertion(promise: promise).perform(rpId: rpId, challenge: challengeData)
    }.runOnQueue(.main)
  }
}

/// Kept alive until iOS answers: the controller holds its delegate weakly.
private var pendingAssertions = Set<PasskeyAssertion>()

private final class PasskeyAssertion: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private let promise: Promise
  private var controller: ASAuthorizationController?

  init(promise: Promise) {
    self.promise = promise
    super.init()
  }

  func perform(rpId: String, challenge: Data) {
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
    let request = provider.createCredentialAssertionRequest(challenge: challenge)
    request.userVerificationPreference = .required

    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    self.controller = controller
    pendingAssertions.insert(self)
    controller.performRequests()
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    defer { finish() }
    guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
      promise.reject("ERR_PASSKEY_RESPONSE", "iOS answered with something other than a passkey.")
      return
    }
    promise.resolve([
      "credentialId": credential.credentialID.base64EncodedString(),
      "userId": credential.userID?.base64EncodedString() ?? "",
      "authenticatorData": credential.rawAuthenticatorData.base64EncodedString(),
      "clientDataJSON": credential.rawClientDataJSON.base64EncodedString(),
      "signature": credential.signature?.base64EncodedString() ?? "",
    ])
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    defer { finish() }
    if let authorizationError = error as? ASAuthorizationError, authorizationError.code == .canceled {
      promise.reject("ERR_PASSKEY_CANCELLED", "Sign-in was cancelled.")
    } else {
      promise.reject("ERR_PASSKEY_FAILED", error.localizedDescription)
    }
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    SceneGeometry.keyWindow() ?? ASPresentationAnchor()
  }

  private func finish() {
    controller = nil
    pendingAssertions.remove(self)
  }
}
