/**
 * English texts for Headpress errors. Pass to `createHeadpress({ messages })` or to
 * `formatError(error, { messages })`; add a dictionary after it to override entries.
 */
import { firstFieldMessage, type Messages } from "../messages.js";

const ROBOT = "We couldn't confirm you're not a robot. Reload the page and try again.";

export const en: Messages = {
  $network: "Couldn't reach the server. Check your connection and try again.",
  $upstream: "The server didn't respond. Try again in a moment.",
  $unknown: "Something went wrong. Try again.",

  headpress_aborted: "The operation was cancelled.",
  headpress_timeout: "The server took too long to respond. Try again.",
  headpress_invalid_response: "The server sent an invalid response. Try again.",
  headpress_module_disabled: "This feature is unavailable right now.",
  rest_no_route: "This feature is unavailable right now.",
  headpress_not_authenticated: "Sign in to continue.",

  headpress_invalid_param: "Check the information you entered.",
  "headpress_invalid_param@reset": "This reset link is invalid or has expired. Request a new one.",
  headpress_validation_failed: (error) => firstFieldMessage(error) ?? "Check the information you entered.",
  headpress_unauthorized: "Your session has expired. Sign in again.",
  "headpress_unauthorized@login": "Wrong email or password.",
  headpress_forbidden: "You don't have permission to do that.",
  "headpress_forbidden@login": "This account manages the store and can't sign in here. Use the WordPress dashboard.",
  "headpress_forbidden@account":
    "This account manages the store. Its password and login email can only be changed in the WordPress dashboard.",
  headpress_not_found: "We couldn't find what you were looking for.",
  headpress_conflict: "Couldn't complete this: the data changed. Refresh the page and try again.",
  headpress_rate_limited: (error) =>
    typeof error.data.retry_after === "number" && error.data.retry_after <= 120
      ? `Too many attempts. Wait ${Math.max(1, Math.ceil(error.data.retry_after))} seconds and try again.`
      : "Too many attempts. Wait a few minutes and try again.",
  headpress_integration_unavailable: "A store service is unavailable. Try again in a moment.",

  headpress_captcha_required: ROBOT,
  headpress_captcha_failed: ROBOT,

  headpress_email_exists: "An account with this email already exists.",
  headpress_registration_disabled: "New account registration is turned off right now.",
  headpress_wrong_password: "Your current password is incorrect.",
  headpress_same_password: "Choose a password different from your current one.",
  headpress_current_password_required: "Enter your current password.",
  headpress_reauth_required: "For your security, confirm your identity to continue.",

  headpress_otp_invalid: (error) => {
    const left = Number(error.data.attempts_left);
    return Number.isFinite(left) && left > 0
      ? `Wrong code. You have ${left} ${left === 1 ? "attempt" : "attempts"} left.`
      : "Wrong code. Check it and try again.";
  },
  headpress_otp_expired: "The code has expired. Request a new one.",
  headpress_otp_locked: "Too many wrong codes. Request a new one.",
  headpress_invalid_recipient: "Enter a valid phone number with area code, or a valid email.",
  headpress_channel_unavailable: "We couldn't send the code through this channel right now.",
  headpress_phone_ineligible: "This number can't be used to sign in.",

  headpress_google_invalid_token: "We couldn't verify your Google account. Try again.",
  headpress_google_mismatch: "This email is already linked to another Google account.",
  headpress_google_unlinked: "Google sign-in was turned off for this account. Sign in with email and password or a code.",

  headpress_already_reviewed: "You've already reviewed this product.",
  headpress_media_too_large: "The file is too large.",
  headpress_unknown_action: "This action isn't available.",
  headpress_checkout_field_invalid: "Check your checkout details.",
};

export default en;
