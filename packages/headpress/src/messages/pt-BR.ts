/**
 * Brazilian Portuguese texts for Headpress errors. Pass to `createHeadpress({ messages })` or to
 * `formatError(error, { messages })`; add a dictionary after it to override entries.
 */
import { firstFieldMessage, type Messages } from "../messages.js";

const ROBOT = "Não conseguimos confirmar que você não é um robô. Recarregue a página e tente novamente.";

export const ptBR: Messages = {
  $network: "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
  $upstream: "O servidor não respondeu. Tente novamente em instantes.",
  $unknown: "Algo deu errado. Tente novamente.",

  headpress_aborted: "A operação foi cancelada.",
  headpress_timeout: "O servidor demorou para responder. Tente novamente.",
  headpress_invalid_response: "Resposta inválida do servidor. Tente novamente.",
  headpress_module_disabled: "Este recurso está indisponível no momento.",
  rest_no_route: "Este recurso está indisponível no momento.",
  headpress_not_authenticated: "Entre na sua conta para continuar.",

  headpress_invalid_param: "Confira os dados informados.",
  "headpress_invalid_param@reset": "Este link de redefinição é inválido ou expirou. Peça um novo.",
  headpress_validation_failed: (error) => firstFieldMessage(error) ?? "Confira os dados informados.",
  headpress_unauthorized: "Sua sessão expirou. Entre novamente.",
  "headpress_unauthorized@login": "E-mail ou senha incorretos.",
  headpress_forbidden: "Você não tem permissão para fazer isso.",
  "headpress_forbidden@login":
    "Esta conta administra a loja e não pode entrar por aqui. Use o painel do WordPress.",
  "headpress_forbidden@account":
    "Esta conta administra a loja. A senha e o e-mail de login dela só podem ser alterados no painel do WordPress.",
  headpress_not_found: "Não encontramos o que você procurou.",
  headpress_conflict: "Não foi possível concluir: os dados mudaram. Atualize a página e tente novamente.",
  headpress_rate_limited: (error) =>
    typeof error.data.retry_after === "number" && error.data.retry_after <= 120
      ? `Muitas tentativas. Aguarde ${Math.max(1, Math.ceil(error.data.retry_after))} segundos e tente novamente.`
      : "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  headpress_integration_unavailable: "Um serviço da loja está indisponível. Tente novamente em instantes.",

  headpress_captcha_required: ROBOT,
  headpress_captcha_failed: ROBOT,

  headpress_email_exists: "Já existe uma conta com este e-mail.",
  headpress_registration_disabled: "O cadastro de novas contas está desativado no momento.",
  headpress_wrong_password: "A senha atual não está correta.",
  headpress_same_password: "Escolha uma senha diferente da atual.",
  headpress_current_password_required: "Informe sua senha atual.",
  headpress_reauth_required: "Por segurança, confirme sua identidade para continuar.",

  headpress_otp_invalid: (error) => {
    const left = Number(error.data.attempts_left);
    return Number.isFinite(left) && left > 0
      ? `Código incorreto. Você ainda tem ${left} ${left === 1 ? "tentativa" : "tentativas"}.`
      : "Código incorreto. Confira e tente novamente.";
  },
  headpress_otp_expired: "O código expirou. Peça um novo código.",
  headpress_otp_locked: "Muitas tentativas com o código errado. Peça um novo código.",
  headpress_invalid_recipient: "Informe um WhatsApp válido, com DDD, ou um e-mail válido.",
  headpress_channel_unavailable: "Não foi possível enviar o código por este canal agora.",
  headpress_phone_ineligible: "Este número não pode ser usado para entrar.",

  headpress_google_invalid_token: "Não foi possível validar sua conta Google. Tente novamente.",
  headpress_google_mismatch: "Este e-mail já está ligado a outra conta Google.",
  headpress_google_unlinked:
    "O login com Google foi desligado nesta conta. Entre com e-mail e senha ou por código.",

  headpress_already_reviewed: "Você já avaliou este produto.",
  headpress_media_too_large: "O arquivo é grande demais.",
  headpress_unknown_action: "Esta ação não está disponível.",
  headpress_checkout_field_invalid: "Confira os dados do checkout.",
};

export default ptBR;
