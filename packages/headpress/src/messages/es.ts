/**
 * Spanish texts for Headpress errors. Pass to `createHeadpress({ messages })` or to
 * `formatError(error, { messages })`; add a dictionary after it to override entries.
 */
import { firstFieldMessage, type Messages } from "../messages.js";

const ROBOT = "No pudimos confirmar que no eres un robot. Recarga la página e inténtalo de nuevo.";

export const es: Messages = {
  $network: "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
  $upstream: "El servidor no respondió. Inténtalo de nuevo en unos momentos.",
  $unknown: "Algo salió mal. Inténtalo de nuevo.",

  headpress_aborted: "La operación fue cancelada.",
  headpress_timeout: "El servidor tardó demasiado en responder. Inténtalo de nuevo.",
  headpress_invalid_response: "Respuesta no válida del servidor. Inténtalo de nuevo.",
  headpress_module_disabled: "Esta función no está disponible en este momento.",
  rest_no_route: "Esta función no está disponible en este momento.",
  headpress_not_authenticated: "Inicia sesión para continuar.",

  headpress_invalid_param: "Revisa los datos ingresados.",
  "headpress_invalid_param@reset": "Este enlace de restablecimiento no es válido o ha caducado. Solicita uno nuevo.",
  headpress_validation_failed: (error) => firstFieldMessage(error) ?? "Revisa los datos ingresados.",
  headpress_unauthorized: "Tu sesión ha caducado. Inicia sesión de nuevo.",
  "headpress_unauthorized@login": "Correo o contraseña incorrectos.",
  headpress_forbidden: "No tienes permiso para hacer esto.",
  "headpress_forbidden@login":
    "Esta cuenta administra la tienda y no puede iniciar sesión aquí. Usa el panel de WordPress.",
  "headpress_forbidden@account":
    "Esta cuenta administra la tienda. Su contraseña y correo de acceso solo se pueden cambiar en el panel de WordPress.",
  headpress_not_found: "No encontramos lo que buscabas.",
  headpress_conflict: "No se pudo completar: los datos cambiaron. Actualiza la página e inténtalo de nuevo.",
  headpress_rate_limited: (error) =>
    typeof error.data.retry_after === "number" && error.data.retry_after <= 120
      ? `Demasiados intentos. Espera ${Math.max(1, Math.ceil(error.data.retry_after))} segundos e inténtalo de nuevo.`
      : "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  headpress_integration_unavailable: "Un servicio de la tienda no está disponible. Inténtalo de nuevo en unos momentos.",

  headpress_captcha_required: ROBOT,
  headpress_captcha_failed: ROBOT,

  headpress_email_exists: "Ya existe una cuenta con este correo.",
  headpress_registration_disabled: "El registro de cuentas nuevas está desactivado en este momento.",
  headpress_wrong_password: "Tu contraseña actual no es correcta.",
  headpress_same_password: "Elige una contraseña diferente de la actual.",
  headpress_current_password_required: "Ingresa tu contraseña actual.",
  headpress_reauth_required: "Por seguridad, confirma tu identidad para continuar.",

  headpress_otp_invalid: (error) => {
    const left = Number(error.data.attempts_left);
    return Number.isFinite(left) && left > 0
      ? `Código incorrecto. Te ${left === 1 ? "queda" : "quedan"} ${left} ${left === 1 ? "intento" : "intentos"}.`
      : "Código incorrecto. Revísalo e inténtalo de nuevo.";
  },
  headpress_otp_expired: "El código caducó. Solicita uno nuevo.",
  headpress_otp_locked: "Demasiados códigos incorrectos. Solicita uno nuevo.",
  headpress_invalid_recipient: "Ingresa un teléfono válido con código de área, o un correo válido.",
  headpress_channel_unavailable: "No pudimos enviar el código por este canal en este momento.",
  headpress_phone_ineligible: "Este número no se puede usar para iniciar sesión.",

  headpress_google_invalid_token: "No pudimos verificar tu cuenta de Google. Inténtalo de nuevo.",
  headpress_google_mismatch: "Este correo ya está vinculado a otra cuenta de Google.",
  headpress_google_unlinked:
    "El acceso con Google se desactivó en esta cuenta. Inicia sesión con correo y contraseña o con un código.",

  headpress_already_reviewed: "Ya calificaste este producto.",
  headpress_media_too_large: "El archivo es demasiado grande.",
  headpress_unknown_action: "Esta acción no está disponible.",
  headpress_checkout_field_invalid: "Revisa los datos del checkout.",
};

export default es;
