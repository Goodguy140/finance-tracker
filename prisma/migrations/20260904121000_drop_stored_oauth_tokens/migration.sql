-- Clear third-party OAuth credentials that were persisted in plaintext.
--
-- Nothing in the application ever read these back (sign-in state lives in the session
-- JWT), so they were pure liability. src/lib/link-oauth-user.ts no longer writes them.
-- The columns stay so existing backup files keep validating; they are now always NULL.
UPDATE "AuthAccount" SET "accessToken" = NULL, "refreshToken" = NULL, "idToken" = NULL;
