import AuthenticationServices
internal import ExpoModulesCore

/// Face ID sign-in with a passkey for the app's home server, and adding one there
/// (`src/session/passkeys.ts`).
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

    /// Makes a new passkey for `rpId`, behind Face ID. `challenge`, `userId` and each of
    /// `excluded` (the account's passkeys, which iOS will not make a second of) are standard
    /// base64; `name` is the account name iOS shows. Resolves with the registration's fields,
    /// each standard base64; rejects with ERR_PASSKEY_CANCELLED when the person closes the sheet
    /// and ERR_PASSKEY_EXISTS when this device already holds one of `excluded`.
    AsyncFunction("register") { (rpId: String, challenge: String, userId: String, name: String, excluded: [String], promise: Promise) in
      guard let challengeData = Data(base64Encoded: challenge), let userData = Data(base64Encoded: userId) else {
        promise.reject("ERR_PASSKEY_CHALLENGE", "The server's passkey setup could not be read.")
        return
      }
      let excludedIds = excluded.compactMap { Data(base64Encoded: $0) }
      PasskeyRegistration(promise: promise).perform(
        rpId: rpId, challenge: challengeData, userId: userData, name: name, excluded: excludedIds)
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

/// Kept alive until iOS answers, as `PasskeyAssertion` is.
private var pendingRegistrations = Set<PasskeyRegistration>()

private final class PasskeyRegistration: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private let promise: Promise
  private var controller: ASAuthorizationController?

  init(promise: Promise) {
    self.promise = promise
    super.init()
  }

  func perform(rpId: String, challenge: Data, userId: Data, name: String, excluded: [Data]) {
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
    let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: name, userID: userId)
    request.userVerificationPreference = .required
    if #available(iOS 17.4, *) {
      // Without this, iOS replaces the passkey it holds for this account with the new one.
      request.excludedCredentials = excluded.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
    }

    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    self.controller = controller
    pendingRegistrations.insert(self)
    controller.performRequests()
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    defer { finish() }
    guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
      let attestationObject = credential.rawAttestationObject
    else {
      promise.reject("ERR_PASSKEY_RESPONSE", "iOS answered with something other than a new passkey.")
      return
    }
    promise.resolve([
      "credentialId": credential.credentialID.base64EncodedString(),
      "clientDataJSON": credential.rawClientDataJSON.base64EncodedString(),
      "attestationObject": attestationObject.base64EncodedString(),
    ])
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    defer { finish() }
    guard let authorizationError = error as? ASAuthorizationError else {
      promise.reject("ERR_PASSKEY_FAILED", error.localizedDescription)
      return
    }
    if authorizationError.code == .canceled {
      promise.reject("ERR_PASSKEY_CANCELLED", "Adding a passkey was cancelled.")
    } else if authorizationError.code.rawValue == 1006 {
      // `.matchedExcludedCredential`, iOS 18 and later; compared by number to build for iOS 16.4.
      promise.reject("ERR_PASSKEY_EXISTS", "This iPhone already has a passkey for your account.")
    } else {
      promise.reject("ERR_PASSKEY_FAILED", error.localizedDescription)
    }
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    SceneGeometry.keyWindow() ?? ASPresentationAnchor()
  }

  private func finish() {
    controller = nil
    pendingRegistrations.remove(self)
  }
}
