"use client";

/**
 * One-time code sign-in for Headpress stores (`passwordless` module), on `useOtpFlow()`.
 *
 * Channels (e-mail, WhatsApp, SMS…) come from `config.modules.passwordless.channels`, so WhatsApp is
 * offered only when the store has it; the code length from `code_length`. The resend countdown,
 * attempts left and fallback channels are the server's answers. New recipients finish with a short
 * registration step when the server asks for it.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import type { SignInResult } from "@meumouse.com/headpress";
import { canonicalPhone, maskPhone } from "@meumouse.com/headpress/br";
import { useCapability, useFormatError, useOtpFlow, useStoreConfig } from "@meumouse.com/headpress/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export interface HeadpressOtpLoginLabels {
  heading?: string;
  channelLegend?: string;
  /** Channel names by id, when the store's own label should be replaced. */
  channels?: Record<string, string>;
  email?: string;
  phone?: string;
  emailPlaceholder?: string;
  phonePlaceholder?: string;
  invalidEmail?: string;
  invalidPhone?: string;
  sendCode?: string;
  sending?: string;
  codeLabel?: string;
  digit?: (index: number, length: number) => string;
  codeSentTo?: (recipient: string, channel: string) => string;
  verify?: string;
  verifying?: string;
  resend?: string;
  resendIn?: (seconds: number) => string;
  noResend?: string;
  attemptsLeft?: (attempts: number) => string;
  changeRecipient?: string;
  fallbackOffer?: string;
  useChannel?: (channel: string) => string;
  registrationHeading?: string;
  registrationHint?: string;
  firstName?: string;
  lastName?: string;
  createAccount?: string;
  creating?: string;
  signedIn?: string;
  captchaFailed?: string;
  unavailable?: string;
}

const DEFAULT_LABELS: Required<HeadpressOtpLoginLabels> = {
  heading: "Entrar com código",
  channelLegend: "Receber o código por",
  channels: {},
  email: "E-mail",
  phone: "Celular",
  emailPlaceholder: "voce@exemplo.com",
  phonePlaceholder: "(00) 00000-0000",
  invalidEmail: "Digite um e-mail válido.",
  invalidPhone: "Digite um celular válido com DDD.",
  sendCode: "Enviar código",
  sending: "Enviando…",
  codeLabel: "Código de verificação",
  digit: (index, length) => `Dígito ${index} de ${length}`,
  codeSentTo: (recipient, channel) => `Enviamos um código por ${channel} para ${recipient}.`,
  verify: "Confirmar código",
  verifying: "Confirmando…",
  resend: "Reenviar código",
  resendIn: (seconds) => `Reenviar em ${seconds}s`,
  noResend: "Não é possível reenviar o código. Comece de novo.",
  attemptsLeft: (attempts) => (attempts === 1 ? "Resta 1 tentativa." : `Restam ${attempts} tentativas.`),
  changeRecipient: "Usar outro contato",
  fallbackOffer: "Quer receber o código de outro jeito?",
  useChannel: (channel) => `Receber por ${channel}`,
  registrationHeading: "Crie a sua conta",
  registrationHint: "É a primeira vez que você entra com este contato. Complete os dados para continuar.",
  firstName: "Nome",
  lastName: "Sobrenome",
  createAccount: "Criar conta",
  creating: "Criando…",
  signedIn: "Pronto, você entrou na sua conta.",
  captchaFailed: "Não foi possível confirmar que você não é um robô. Tente de novo.",
  unavailable: "O login com código não está disponível nesta loja.",
};

const DEFAULT_CHANNEL_NAMES: Record<string, string> = { email: "e-mail", whatsapp: "WhatsApp", sms: "SMS" };

export interface HeadpressOtpLoginProps {
  onSignedIn: (result: SignInResult) => void;
  purpose?: "login" | "recovery";
  /** A reCAPTCHA (or similar) token, asked before a code is sent. */
  getCaptcha?: (action: string) => Promise<string>;
  /** Action name passed to `getCaptcha`. Defaults to `login`. */
  captchaAction?: string;
  defaultChannel?: string;
  labels?: HeadpressOtpLoginLabels;
  className?: string;
}

interface Channel {
  id: string;
  label: string;
  type: "email" | "phone";
}

/** Layout effect in the browser, plain effect on the server (where neither runs). */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Seconds until `target` (epoch ms), ticking each second; 0 when past or null. */
function useSecondsUntil(target: number | null): number {
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (target === null) return () => {};
      const timer = setInterval(onTick, 1000);
      return () => clearInterval(timer);
    },
    [target],
  );
  const read = () => (target === null ? 0 : Math.max(0, Math.ceil((target - Date.now()) / 1000)));
  return useSyncExternalStore(subscribe, read, read);
}

function CodeInput({
  length,
  value,
  onChange,
  onComplete,
  disabled,
  digitLabel,
  labelledBy,
}: {
  length: number;
  value: string;
  onChange: (code: string) => void;
  onComplete: (code: string) => void;
  disabled: boolean;
  digitLabel: (index: number, length: number) => string;
  labelledBy: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  // Autofill can fire several events before React re-renders; compose from the latest value.
  const latest = useRef(value);
  useIsomorphicLayoutEffect(() => {
    latest.current = value;
  });

  const focusAt = (index: number) => {
    const cell = refs.current[Math.max(0, Math.min(length - 1, index))];
    cell?.focus();
    cell?.select();
  };
  const emit = (next: string) => {
    latest.current = next;
    onChange(next);
    if (next.length === length && /^\d+$/.test(next)) onComplete(next);
  };
  const fill = (index: number, digits: string) => {
    const chars = latest.current.padEnd(length, " ").split("");
    let cursor = index;
    for (const digit of digits) {
      if (cursor >= length) break;
      chars[cursor++] = digit;
    }
    emit(chars.join("").replace(/\s+$/, "").replace(/\s/g, ""));
    focusAt(cursor);
  };

  return (
    <div role="group" aria-labelledby={labelledBy} className="flex gap-2">
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={length}
          disabled={disabled}
          value={value[index] ?? ""}
          aria-label={digitLabel(index + 1, length)}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "");
            if (digits) fill(index, digits);
          }}
          onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
            event.preventDefault();
            const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (digits) fill(0, digits);
          }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Backspace") {
              event.preventDefault();
              const chars = latest.current.split("");
              if (chars[index]) {
                chars.splice(index, 1);
                emit(chars.join(""));
              } else if (index > 0) {
                chars.splice(index - 1, 1);
                emit(chars.join(""));
                focusAt(index - 1);
              }
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              focusAt(index - 1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              focusAt(index + 1);
            }
          }}
          className={cn(
            "h-12 w-full min-w-0 max-w-12 rounded-md border border-input bg-transparent text-center text-lg font-semibold shadow-xs outline-none transition",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
      ))}
    </div>
  );
}

export function HeadpressOtpLogin({ onSignedIn, purpose = "login", getCaptcha, captchaAction = "login", defaultChannel, labels, className }: HeadpressOtpLoginProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const config = useStoreConfig();
  const settings = useCapability("passwordless");
  const formatError = useFormatError();
  const [state, actions] = useOtpFlow();
  const id = useId();

  const channels: Channel[] = (settings?.channels ?? [])
    .filter((channel): channel is typeof channel & { id: string } => typeof channel.id === "string" && channel.id !== "")
    .map((channel) => ({
      id: channel.id,
      label: text.channels[channel.id] ?? channel.label ?? DEFAULT_CHANNEL_NAMES[channel.id] ?? channel.id,
      type: channel.recipient_type === "phone" ? "phone" : "email",
    }));
  const codeLength = settings?.code_length || 6;

  const [channelId, setChannelId] = useState<string | null>(defaultChannel ?? null);
  const [recipient, setRecipient] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [registration, setRegistration] = useState({ email: "", first_name: "", last_name: "" });
  const recipientRef = useRef<HTMLInputElement>(null);
  const reported = useRef(false);
  const resendIn = useSecondsUntil(state.resendAt);

  const channel = channels.find((entry) => entry.id === channelId) ?? channels[0];

  useEffect(() => {
    if (state.step === "signed_in" && state.result && !reported.current) {
      reported.current = true;
      onSignedIn(state.result);
    }
  }, [state.step, state.result, onSignedIn]);

  // A wrong code clears the cells for the next try (adjusted while rendering, when the error lands).
  const wrongCode = state.error && state.step === "code_sent" ? state.error : null;
  const [seenWrongCode, setSeenWrongCode] = useState(wrongCode);
  if (wrongCode !== seenWrongCode) {
    setSeenWrongCode(wrongCode);
    if (wrongCode) setCode("");
  }

  if (config && !settings) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{text.unavailable}</p>;
  }
  if (!settings || !channel) return null;

  const channelName = (channelKey: string | null) => channels.find((entry) => entry.id === channelKey)?.label ?? (channelKey ? DEFAULT_CHANNEL_NAMES[channelKey] ?? channelKey : "");

  const send = async (target: Channel, value: string) => {
    setLocalError(null);
    let normalized = value.trim();
    if (target.type === "phone") {
      const phone = canonicalPhone(normalized);
      if (!phone) {
        setLocalError(text.invalidPhone);
        return;
      }
      normalized = phone;
    } else if (!/^\S+@\S+\.\S+$/.test(normalized)) {
      setLocalError(text.invalidEmail);
      return;
    }
    let captcha: string | undefined;
    if (getCaptcha) {
      try {
        captcha = await getCaptcha(captchaAction);
      } catch {
        setLocalError(text.captchaFailed);
        return;
      }
    }
    setCode("");
    await actions.start({ channel: target.id, recipient: normalized, purpose }, { captcha });
  };

  const switchChannel = (next: Channel) => {
    const sameKind = next.type === channel.type;
    setChannelId(next.id);
    setLocalError(null);
    if (sameKind && recipient) {
      void send(next, recipient);
    } else {
      setRecipient("");
      requestAnimationFrame(() => recipientRef.current?.focus());
    }
  };

  const error = localError ?? (state.error ? formatError(state.error, "login") : null);
  const fallbacks = state.error?.code === "headpress_channel_unavailable" ? channels.filter((entry) => state.fallbackChannels.includes(entry.id)) : [];

  if (state.step === "signed_in") {
    return (
      <div role="status" className={cn("flex items-center gap-2 text-sm", className)}>
        <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
        {text.signedIn}
      </div>
    );
  }

  if (state.step === "needs_registration" || state.step === "registering") {
    const busy = state.step === "registering";
    const submit = (event: FormEvent) => {
      event.preventDefault();
      void actions.register({
        email: registration.email.trim(),
        ...(registration.first_name.trim() ? { first_name: registration.first_name.trim() } : {}),
        ...(registration.last_name.trim() ? { last_name: registration.last_name.trim() } : {}),
      });
    };
    return (
      <form onSubmit={submit} className={cn("space-y-4", className)} aria-busy={busy}>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{text.registrationHeading}</h2>
          <p className="text-sm text-muted-foreground">{text.registrationHint}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-first`}>{text.firstName}</Label>
            <Input id={`${id}-first`} autoComplete="given-name" value={registration.first_name} onChange={(event) => setRegistration((value) => ({ ...value, first_name: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-last`}>{text.lastName}</Label>
            <Input id={`${id}-last`} autoComplete="family-name" value={registration.last_name} onChange={(event) => setRegistration((value) => ({ ...value, last_name: event.target.value }))} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-reg-email`}>{text.email}</Label>
          <Input
            id={`${id}-reg-email`}
            type="email"
            autoComplete="email"
            required
            value={registration.email}
            onChange={(event) => setRegistration((value) => ({ ...value, email: event.target.value }))}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {busy ? text.creating : text.createAccount}
        </Button>
      </form>
    );
  }

  if ((state.step === "code_sent" || state.step === "verifying" || (state.step === "sending" && state.challenge)) && state.challenge) {
    const busy = state.step === "verifying" || state.step === "sending";
    const verify = (value: string) => {
      if (value.length === codeLength) void actions.verify(value);
    };
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          verify(code);
        }}
        className={cn("space-y-4", className)}
        aria-busy={busy}
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{text.heading}</h2>
          <p className="text-sm text-muted-foreground" role="status">
            {text.codeSentTo(state.challenge.masked_recipient, channelName(state.challenge.channel || state.channel))}
          </p>
        </div>
        <div className="space-y-2">
          <p id={`${id}-code-label`} className="text-sm font-medium">
            {text.codeLabel}
          </p>
          <CodeInput
            length={codeLength}
            value={code}
            onChange={setCode}
            onComplete={verify}
            disabled={busy}
            digitLabel={text.digit}
            labelledBy={`${id}-code-label`}
          />
        </div>
        <div aria-live="polite" className="space-y-1">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {state.attemptsLeft !== null && state.attemptsLeft > 0 && <p className="text-sm text-muted-foreground">{text.attemptsLeft(state.attemptsLeft)}</p>}
        </div>
        <Button type="submit" disabled={busy || code.length !== codeLength} className="w-full">
          {state.step === "verifying" && <Loader2 className="animate-spin" aria-hidden="true" />}
          {state.step === "verifying" ? text.verifying : text.verify}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          {state.resendAt === null ? (
            <span className="text-muted-foreground">{text.noResend}</span>
          ) : (
            <Button type="button" variant="link" className="h-auto p-0" disabled={busy || resendIn > 0} onClick={() => void actions.resend()}>
              {state.step === "sending" ? text.sending : resendIn > 0 ? text.resendIn(resendIn) : text.resend}
            </Button>
          )}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              actions.reset();
              setCode("");
            }}
          >
            {text.changeRecipient}
          </Button>
        </div>
      </form>
    );
  }

  const sending = state.step === "sending";
  const isPhone = channel.type === "phone";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send(channel, recipient);
      }}
      className={cn("space-y-4", className)}
      aria-busy={sending}
      noValidate
    >
      <h2 className="text-lg font-semibold">{text.heading}</h2>

      {channels.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{text.channelLegend}</legend>
          <RadioGroup
            value={channel.id}
            onValueChange={(value) => {
              const next = channels.find((entry) => entry.id === value);
              if (!next) return;
              if (next.type !== channel.type) setRecipient("");
              setChannelId(next.id);
              setLocalError(null);
            }}
            className="flex flex-wrap gap-4"
          >
            {channels.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2">
                <RadioGroupItem value={entry.id} id={`${id}-channel-${entry.id}`} />
                <Label htmlFor={`${id}-channel-${entry.id}`} className="font-normal">
                  {entry.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${id}-recipient`}>{isPhone ? text.phone : text.email}</Label>
        <Input
          ref={recipientRef}
          id={`${id}-recipient`}
          type={isPhone ? "tel" : "email"}
          inputMode={isPhone ? "tel" : "email"}
          autoComplete={isPhone ? "tel-national" : "email"}
          placeholder={isPhone ? text.phonePlaceholder : text.emailPlaceholder}
          value={recipient}
          onChange={(event) => setRecipient(isPhone ? maskPhone(event.target.value) : event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={sending}
          required
        />
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {fallbacks.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">{text.fallbackOffer}</p>
          <div className="flex flex-wrap gap-2">
            {fallbacks.map((entry) => (
              <Button key={entry.id} type="button" variant="outline" size="sm" onClick={() => switchChannel(entry)}>
                {text.useChannel(entry.label)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Button type="submit" disabled={sending || !recipient.trim()} className="w-full">
        {sending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {sending ? text.sending : text.sendCode}
      </Button>
    </form>
  );
}

export default HeadpressOtpLogin;
