"use client";

/**
 * What the shopper must do to finish an async payment, from Headpress's `PaymentInstructions`
 * (`placed.instructions`, `payment.instructions`, `attempt.result.instructions`):
 *
 * - Pix: the QR code, the copy-and-paste code with a copy button and a live countdown to
 *   `expiresAt`; once it passes, the code is hidden and an expired notice shows instead.
 * - Bank slip: the link to the slip and its barcode with a copy button.
 *
 * The instructions are the gateway's own answer, read by the SDK; this component only renders them.
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, CheckCircle2, Clock, Copy, ExternalLink, TimerOff } from "lucide-react";

import type { PaymentInstructions } from "@meumouse/headpress";
import { useHeadpress } from "@meumouse/headpress/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface HeadpressPixInstructionsLabels {
  pixHeading?: string;
  boletoHeading?: string;
  qrAlt?: string;
  copyPaste?: string;
  copy?: string;
  copied?: string;
  copyFailed?: string;
  expiresIn?: string;
  expiresAt?: (when: string) => string;
  timer?: (clock: string) => string;
  expired?: string;
  expiredHint?: string;
  steps?: readonly string[];
  boletoText?: string;
  openBoleto?: string;
  barcode?: string;
  boletoHint?: string;
  pending?: string;
  paid?: string;
  paidText?: string;
  failed?: string;
}

const DEFAULT_LABELS: Required<HeadpressPixInstructionsLabels> = {
  pixHeading: "Pague com Pix",
  boletoHeading: "Pague o boleto",
  qrAlt: "QR Code do Pix",
  copyPaste: "Pix copia e cola",
  copy: "Copiar código",
  copied: "Código copiado",
  copyFailed: "Não foi possível copiar. Selecione o código e copie manualmente.",
  expiresIn: "Expira em",
  expiresAt: (when) => `Este código expira em ${when}.`,
  timer: (clock) => `O código Pix expira em ${clock}`,
  expired: "Este código Pix expirou.",
  expiredHint: "Gere um novo pagamento para receber outro código.",
  steps: [
    "Abra o app do seu banco e entre na área Pix.",
    "Escolha pagar com QR Code ou Pix copia e cola.",
    "Escaneie o código ou cole o código copiado.",
    "Confirme as informações e finalize o pagamento.",
  ],
  boletoText: "Seu boleto foi gerado. Pague em qualquer banco, lotérica ou app.",
  openBoleto: "Abrir boleto",
  barcode: "Linha digitável",
  boletoHint: "A confirmação do pagamento do boleto pode levar até 2 dias úteis.",
  pending: "Aguardando pagamento",
  paid: "Pagamento confirmado",
  paidText: "Recebemos o seu pagamento.",
  failed: "Pagamento não concluído",
};

export interface HeadpressPixInstructionsProps {
  instructions: PaymentInstructions;
  /** The payment's status, when known (e.g. while polling the order). */
  status?: "pending" | "paid" | "failed";
  /** Called once when the Pix code expires. */
  onExpired?: () => void;
  labels?: HeadpressPixInstructionsLabels;
  className?: string;
}

function imageMime(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  return "image/png";
}

function clockText(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Copy text, with a status message for screen readers. */
function useCopy() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  };
  return [state, copy] as const;
}

function CopyField({ id, label, value, labels }: { id: string; label: string; value: string; labels: Required<HeadpressPixInstructionsLabels> }) {
  const [state, copy] = useCopy();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" />
        <Button type="button" variant={state === "copied" ? "secondary" : "default"} onClick={() => void copy(value)} className="shrink-0">
          {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {state === "copied" ? labels.copied : labels.copy}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground empty:hidden" role="status" aria-live="polite">
        {state === "copied" ? labels.copied : state === "failed" ? labels.copyFailed : ""}
      </p>
    </div>
  );
}

function StatusBadge({ status, labels }: { status: NonNullable<HeadpressPixInstructionsProps["status"]>; labels: Required<HeadpressPixInstructionsLabels> }) {
  if (status === "paid") {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
        <CheckCircle2 aria-hidden="true" />
        {labels.paid}
      </Badge>
    );
  }
  if (status === "failed") return <Badge variant="destructive">{labels.failed}</Badge>;
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock aria-hidden="true" />
      {labels.pending}
    </Badge>
  );
}

export function HeadpressPixInstructions({ instructions, status, onExpired, labels, className }: HeadpressPixInstructionsProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const hp = useHeadpress();
  const id = useId();
  const deadline = instructions.type === "pix" && instructions.expiresAt ? Date.parse(instructions.expiresAt) : Number.NaN;
  const hasDeadline = !Number.isNaN(deadline);
  const expiredReported = useRef(false);

  // Seconds left, ticking each second. Null on the server and while hydrating, so the server and the
  // first browser render agree.
  const subscribeClock = useCallback(
    (onTick: () => void) => {
      if (!hasDeadline) return () => {};
      const timer = setInterval(onTick, 1000);
      return () => clearInterval(timer);
    },
    [hasDeadline],
  );
  const remaining = useSyncExternalStore(
    subscribeClock,
    () => (hasDeadline ? Math.max(0, Math.floor((deadline - Date.now()) / 1000)) : null),
    () => null,
  );
  const expired = remaining === 0;

  useEffect(() => {
    if (expired && !expiredReported.current) {
      expiredReported.current = true;
      onExpired?.();
    }
  }, [expired, onExpired]);

  const heading = instructions.type === "pix" ? text.pixHeading : text.boletoHeading;
  const paid = status === "paid";

  return (
    <section className={cn("rounded-xl border bg-card p-5 sm:p-6", className)} aria-labelledby={`${id}-heading`} data-slot="headpress-pix-instructions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {heading}
        </h2>
        {status && <StatusBadge status={status} labels={text} />}
      </div>

      {paid ? (
        <p className="mt-3 text-sm text-muted-foreground">{text.paidText}</p>
      ) : instructions.type === "pix" ? (
        expired ? (
          <div className="mt-5 flex items-start gap-3 rounded-lg bg-muted p-4" role="alert">
            <TimerOff className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">{text.expired}</p>
              <p className="text-sm text-muted-foreground">{text.expiredHint}</p>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid items-start gap-6 sm:grid-cols-[auto_1fr]">
            {instructions.imageBase64 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:${imageMime(instructions.imageBase64)};base64,${instructions.imageBase64}`}
                alt={text.qrAlt}
                className="mx-auto size-44 rounded-lg border bg-white p-2 sm:mx-0"
              />
            )}
            <div className="min-w-0 space-y-4">
              {hasDeadline && (
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground">{text.expiresIn}</span>
                  {/* The visible clock ticks every second; the timer role keeps it out of live announcements. */}
                  <span role="timer" aria-label={remaining !== null ? text.timer(clockText(remaining)) : undefined} className="text-2xl font-semibold tabular-nums">
                    {remaining !== null ? clockText(remaining) : "--:--"}
                  </span>
                </div>
              )}
              {instructions.code && <CopyField id={`${id}-pix`} label={text.copyPaste} value={instructions.code} labels={text} />}
              {hasDeadline && (
                <p className="text-xs text-muted-foreground">
                  {text.expiresAt(new Intl.DateTimeFormat(hp.locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(deadline))}
                </p>
              )}
              {text.steps.length > 0 && (
                <ol className="space-y-1.5">
                  {text.steps.map((step, index) => (
                    <li key={index} className="flex gap-2.5 text-xs text-muted-foreground">
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-muted-foreground">{text.boletoText}</p>
          <Button asChild>
            <a href={instructions.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              {text.openBoleto}
            </a>
          </Button>
          {instructions.barcode && <CopyField id={`${id}-barcode`} label={text.barcode} value={instructions.barcode} labels={text} />}
          <p className="text-xs text-muted-foreground">{text.boletoHint}</p>
        </div>
      )}
    </section>
  );
}

export default HeadpressPixInstructions;
