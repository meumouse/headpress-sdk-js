"use client";

/**
 * Review form for Headpress stores (`reviews` module), on `useReviewForm()`.
 *
 * Limits — title and text length, rating required, how many photos and videos and how big — come
 * from `config.modules.reviews`; the controller checks them before sending and the server checks
 * again. Whether the shopper may review at all comes from the server's eligibility answer.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { CheckCircle2, Clock, ImagePlus, Loader2, Play, Star, X } from "lucide-react";

import type { ReviewEligibility } from "@meumouse/headpress";
import { ReviewFieldError, type ReviewFile, type ReviewFormState } from "@meumouse/headpress/controllers";
import { useCapability, useFormatError, useHeadpress, useReviewForm, useSignedIn } from "@meumouse/headpress/react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FieldErrorCode = (typeof ReviewFieldError)[keyof typeof ReviewFieldError];

export interface HeadpressReviewFormLabels {
  rating?: string;
  ratingNames?: readonly [string, string, string, string, string];
  stars?: (stars: number) => string;
  title?: string;
  titlePlaceholder?: string;
  content?: string;
  contentPlaceholder?: string;
  contentMin?: (min: number) => string;
  counter?: (length: number, max: number) => string;
  optional?: string;
  media?: string;
  mediaHint?: (limits: { images: number; imageMb: number; videos: number; videoMb: number }) => string;
  addMedia?: string;
  removeFile?: (name: string) => string;
  uploading?: (done: number, total: number) => string;
  uploadFailed?: string;
  anonymous?: string;
  authorName?: string;
  authorEmail?: string;
  submit?: string;
  submitting?: string;
  successApproved?: string;
  successPending?: string;
  captchaFailed?: string;
  /** Messages for the local checks (`ReviewFieldError` codes). */
  errors?: Partial<Record<FieldErrorCode, string | ((limits: { min: number; max: number }) => string)>>;
  /** A server field error that came as a code rather than a sentence. */
  invalidField?: string;
  /** Why the shopper cannot review, by eligibility reason. */
  ineligible?: Partial<Record<"reviews_closed" | "login_required" | "not_verified_owner" | "already_reviewed" | "default", string>>;
  signIn?: string;
}

const DEFAULT_LABELS = {
  rating: "Sua nota",
  ratingNames: ["Péssimo", "Ruim", "Regular", "Bom", "Excelente"] as const,
  stars: (stars: number) => (stars === 1 ? "1 estrela" : `${stars} estrelas`),
  title: "Título",
  titlePlaceholder: "Resuma a sua experiência",
  content: "Sua avaliação",
  contentPlaceholder: "Conte o que achou do produto",
  contentMin: (min: number) => `Mínimo de ${min} caracteres.`,
  counter: (length: number, max: number) => `${length}/${max}`,
  optional: "(opcional)",
  media: "Fotos e vídeos",
  mediaHint: ({ images, imageMb, videos, videoMb }: { images: number; imageMb: number; videos: number; videoMb: number }) =>
    [
      images ? `até ${images} ${images === 1 ? "foto" : "fotos"}${imageMb ? ` de ${imageMb} MB` : ""}` : "",
      videos ? `${videos} ${videos === 1 ? "vídeo" : "vídeos"}${videoMb ? ` de ${videoMb} MB` : ""}` : "",
    ]
      .filter(Boolean)
      .join(" e ")
      .replace(/^./, (first) => first.toUpperCase()),
  addMedia: "Adicionar fotos ou vídeos",
  removeFile: (name: string) => `Remover ${name}`,
  uploading: (done: number, total: number) => `Enviando arquivos: ${done} de ${total}`,
  uploadFailed: "Falha no envio",
  anonymous: "Publicar sem mostrar meu nome",
  authorName: "Seu nome",
  authorEmail: "Seu e-mail",
  submit: "Enviar avaliação",
  submitting: "Enviando…",
  successApproved: "Obrigado! Sua avaliação já está publicada.",
  successPending: "Obrigado! Sua avaliação foi recebida e aparece depois da moderação.",
  captchaFailed: "Não foi possível confirmar que você não é um robô. Tente de novo.",
  errors: {
    rating_required: "Escolha uma nota de 1 a 5 estrelas.",
    title_length: ({ min, max }: { min: number; max: number }) => `O título deve ter entre ${min} e ${max} caracteres.`,
    content_length: ({ min, max }: { min: number; max: number }) =>
      min > 0 ? `A avaliação deve ter entre ${min} e ${max} caracteres.` : `A avaliação deve ter até ${max} caracteres.`,
    too_many_files: "Você chegou ao limite de arquivos.",
    file_type: "Este tipo de arquivo não é aceito.",
    file_size: "O arquivo é maior que o permitido.",
    uploading: "Espere o envio dos arquivos terminar.",
  } as Record<FieldErrorCode, string | ((limits: { min: number; max: number }) => string)>,
  invalidField: "Confira este campo.",
  ineligible: {
    reviews_closed: "As avaliações deste produto estão fechadas.",
    login_required: "Entre na sua conta para avaliar este produto.",
    not_verified_owner: "Só quem comprou este produto pode avaliá-lo.",
    already_reviewed: "Você já avaliou este produto. Obrigado!",
    default: "Não é possível avaliar este produto agora.",
  } as Record<string, string>,
  signIn: "Entrar",
};

export interface HeadpressReviewFormProps {
  productId: number;
  /** A reCAPTCHA (or similar) token for an action; the action is `config.modules.reviews.captcha_action`. */
  getCaptcha?: (action: string) => Promise<string>;
  /** Called once the server accepted the review. */
  onSubmitted?: (result: NonNullable<ReviewFormState["result"]>) => void;
  /** Shown with the "login required" answer, e.g. to open the sign-in dialog. */
  onSignInRequest?: () => void;
  labels?: HeadpressReviewFormLabels;
  className?: string;
}

const MB = 1024 * 1024;

/** An object URL for a file, created while something is subscribed and revoked when it leaves. */
function objectUrlSource(file: Blob) {
  let url: string | null = null;
  return {
    subscribe: (onChange: () => void) => {
      const objectUrl = URL.createObjectURL(file);
      url = objectUrl;
      onChange();
      return () => {
        URL.revokeObjectURL(objectUrl);
        if (url === objectUrl) url = null;
      };
    },
    getSnapshot: () => url,
  };
}

const noUrl = () => null;

function FilePreview({ entry, onRemove, labels }: { entry: ReviewFile; onRemove: () => void; labels: typeof DEFAULT_LABELS }) {
  const source = useMemo(() => objectUrlSource(entry.file), [entry.file]);
  const url = useSyncExternalStore(source.subscribe, source.getSnapshot, noUrl);
  const name = entry.file.name ?? (entry.kind === "video" ? "vídeo" : "foto");

  return (
    <li className={cn("relative size-20 overflow-hidden rounded-lg border bg-muted", entry.status === "error" && "border-destructive")}>
      {url &&
        (entry.kind === "video" ? (
          <>
            <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
            <Play className="absolute inset-0 m-auto size-5 fill-white text-white" aria-hidden="true" />
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ))}
      {entry.status === "uploading" && (
        <span className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </span>
      )}
      {entry.status === "error" && (
        <span className="absolute inset-x-0 bottom-0 bg-destructive px-1 py-0.5 text-center text-[10px] font-medium text-white">{labels.uploadFailed}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={labels.removeFile(name)}
        className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-background/90 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

function StarInput({
  value,
  onChange,
  labels,
  invalid,
  describedBy,
  labelledBy,
}: {
  value: number;
  onChange: (value: number) => void;
  labels: typeof DEFAULT_LABELS;
  invalid: boolean;
  describedBy?: string;
  labelledBy: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${labels.stars(star)}, ${labels.ratingNames[star - 1]}`}
            tabIndex={value === star || (value === 0 && star === 1) ? 0 : -1}
            onMouseEnter={() => setHover(star)}
            onClick={() => onChange(star)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                event.preventDefault();
                onChange(Math.min(5, value + 1));
              } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                event.preventDefault();
                onChange(Math.max(1, value - 1));
              }
            }}
            className="rounded-md p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star className={cn("size-8 transition-colors", star <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {shown ? labels.ratingNames[shown - 1] : ""}
      </p>
    </div>
  );
}

export function HeadpressReviewForm({ productId, getCaptcha, onSubmitted, onSignInRequest, labels, className }: HeadpressReviewFormProps) {
  const text = {
    ...DEFAULT_LABELS,
    ...labels,
    errors: { ...DEFAULT_LABELS.errors, ...labels?.errors },
    ineligible: { ...DEFAULT_LABELS.ineligible, ...labels?.ineligible },
  } as typeof DEFAULT_LABELS;
  const hp = useHeadpress();
  const settings = useCapability("reviews");
  const signedIn = useSignedIn();
  const formatError = useFormatError();
  const [state, actions] = useReviewForm(productId);
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);
  const [author, setAuthor] = useState({ name: "", email: "" });
  const [captchaError, setCaptchaError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const announced = useRef(false);
  const id = useId();

  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    hp.reviews
      .eligibility(productId)
      .then((answer) => {
        if (!cancelled) setEligibility(answer);
      })
      // Without an answer the form stays open; the server has the last word on submit.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hp, productId, settings, signedIn]);

  useEffect(() => {
    if (state.status === "submitted" && state.result && !announced.current) {
      announced.current = true;
      onSubmitted?.(state.result);
    }
  }, [state.status, state.result, onSubmitted]);

  // Off (or the config is still loading): nothing to show.
  if (!settings) return null;

  if (state.status === "submitted" && state.result) {
    const approved = state.result.status === "approved";
    return (
      <div role="status" className={cn("flex items-start gap-3 rounded-lg border p-4", className)}>
        {approved ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden="true" /> : <Clock className="size-5 shrink-0 text-amber-600" aria-hidden="true" />}
        <p className="text-sm">{approved ? text.successApproved : text.successPending}</p>
      </div>
    );
  }

  if (eligibility && !eligibility.can_review) {
    const reason = eligibility.reason ?? "default";
    return (
      <div className={cn("space-y-3 rounded-lg border p-4", className)}>
        <p className="text-sm">{text.ineligible[reason] ?? text.ineligible.default}</p>
        {reason === "login_required" && onSignInRequest && (
          <Button type="button" onClick={onSignInRequest}>
            {text.signIn}
          </Button>
        )}
      </div>
    );
  }

  const titleMax = settings.title_max_length || 80;
  const contentMax = settings.content_max_length || 5000;
  const contentMin = settings.content_required === false ? 0 : settings.content_min_length || 0;
  const imageRules = settings.media?.image;
  const videoRules = settings.media?.video;
  const imagesOn = imageRules?.enabled !== false && (imageRules?.max_files ?? 0) > 0;
  const videosOn = videoRules?.enabled !== false && (videoRules?.max_files ?? 0) > 0;
  const accept = [...(imagesOn ? imageRules?.types ?? ["image/*"] : []), ...(videosOn ? videoRules?.types ?? ["video/*"] : [])].join(",");
  const guest = !signedIn && settings.guests_allowed;
  const submitting = state.status === "submitting";
  const uploads = state.files.length;
  const uploaded = state.files.filter((entry) => entry.status !== "uploading").length;

  const errorText = (field: string): string | null => {
    const code = state.fieldErrors[field];
    if (!code) return null;
    const message = text.errors[code as FieldErrorCode];
    if (typeof message === "function") {
      return field === "title" ? message({ min: 3, max: titleMax }) : message({ min: contentMin, max: contentMax });
    }
    if (message) return message;
    // Server field errors may come as codes or as sentences.
    return /^[a-z0-9_]+$/.test(code) ? text.invalidField : code;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setCaptchaError(false);
    let captcha: string | undefined;
    if (getCaptcha && settings.captcha_action) {
      try {
        captcha = await getCaptcha(settings.captcha_action);
      } catch {
        setCaptchaError(true);
        return;
      }
    }
    await actions.submit({
      captcha,
      ...(guest && author.name.trim() ? { author_name: author.name.trim() } : {}),
      ...(guest && author.email.trim() ? { author_email: author.email.trim() } : {}),
    });
  };

  const ids = { rating: `${id}-rating`, title: `${id}-title`, content: `${id}-content`, media: `${id}-media`, name: `${id}-name`, email: `${id}-email` };
  const ratingError = errorText("rating");
  const titleError = errorText("title");
  const contentError = errorText("content");
  const mediaError = errorText("media");
  const generalError = captchaError ? text.captchaFailed : state.error && !Object.keys(state.fieldErrors).length ? formatError(state.error, "reviews") : null;

  return (
    <form onSubmit={submit} noValidate className={cn("space-y-5", className)} aria-busy={submitting}>
      {settings.rating_enabled !== false && (
        <div className="space-y-2">
          <p id={ids.rating} className="text-sm font-medium">
            {text.rating} {!settings.rating_required && <span className="font-normal text-muted-foreground">{text.optional}</span>}
          </p>
          <StarInput
            value={state.rating ?? 0}
            onChange={(rating) => actions.set({ rating })}
            labels={text}
            invalid={Boolean(ratingError)}
            labelledBy={ids.rating}
            describedBy={ratingError ? `${ids.rating}-error` : undefined}
          />
          {ratingError && (
            <p id={`${ids.rating}-error`} className="text-sm text-destructive">
              {ratingError}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={ids.title}>
            {text.title} <span className="font-normal text-muted-foreground">{text.optional}</span>
          </Label>
          <span className="text-xs tabular-nums text-muted-foreground" aria-hidden="true">
            {text.counter(state.title.length, titleMax)}
          </span>
        </div>
        <Input
          id={ids.title}
          value={state.title}
          maxLength={titleMax}
          placeholder={text.titlePlaceholder}
          onChange={(event) => actions.set({ title: event.target.value })}
          aria-invalid={Boolean(titleError)}
          aria-describedby={titleError ? `${ids.title}-error` : undefined}
        />
        {titleError && (
          <p id={`${ids.title}-error`} className="text-sm text-destructive">
            {titleError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={ids.content}>
            {text.content} {contentMin === 0 && <span className="font-normal text-muted-foreground">{text.optional}</span>}
          </Label>
          <span className="text-xs tabular-nums text-muted-foreground" aria-hidden="true">
            {text.counter(state.content.length, contentMax)}
          </span>
        </div>
        <Textarea
          id={ids.content}
          value={state.content}
          maxLength={contentMax}
          rows={5}
          placeholder={text.contentPlaceholder}
          onChange={(event) => actions.set({ content: event.target.value })}
          aria-invalid={Boolean(contentError)}
          aria-describedby={[contentMin > 0 ? `${ids.content}-hint` : "", contentError ? `${ids.content}-error` : ""].filter(Boolean).join(" ") || undefined}
        />
        {contentMin > 0 && (
          <p id={`${ids.content}-hint`} className="text-xs text-muted-foreground">
            {text.contentMin(contentMin)}
          </p>
        )}
        {contentError && (
          <p id={`${ids.content}-error`} className="text-sm text-destructive">
            {contentError}
          </p>
        )}
      </div>

      {(imagesOn || videosOn) && (
        <div className="space-y-2">
          <p id={ids.media} className="text-sm font-medium">
            {text.media} <span className="font-normal text-muted-foreground">{text.optional}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {text.mediaHint({
              images: imagesOn ? imageRules?.max_files ?? 0 : 0,
              imageMb: Math.round((imageRules?.max_size ?? 0) / MB),
              videos: videosOn ? videoRules?.max_files ?? 0 : 0,
              videoMb: Math.round((videoRules?.max_size ?? 0) / MB),
            })}
          </p>
          {state.files.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-labelledby={ids.media}>
              {state.files.map((entry) => (
                <FilePreview key={entry.id} entry={entry} labels={text} onRemove={() => void actions.removeFile(entry.id)} />
              ))}
            </ul>
          )}
          {uploads > 0 && uploaded < uploads && (
            <div className="space-y-1" role="status" aria-live="polite">
              <Progress value={(uploaded / uploads) * 100} aria-label={text.uploading(uploaded, uploads)} />
              <p className="text-xs text-muted-foreground">{text.uploading(uploaded, uploads)}</p>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={accept || undefined}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) void actions.addFiles(files);
            }}
          />
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} aria-describedby={mediaError ? `${ids.media}-error` : undefined}>
            <ImagePlus aria-hidden="true" />
            {text.addMedia}
          </Button>
          {mediaError && (
            <p id={`${ids.media}-error`} className="text-sm text-destructive">
              {mediaError}
            </p>
          )}
          {state.files
            .filter((entry) => entry.status === "error" && entry.error)
            .map((entry) => (
              <p key={entry.id} className="text-sm text-destructive">
                {entry.file.name ? `${entry.file.name}: ` : ""}
                {formatError(entry.error, "reviews")}
              </p>
            ))}
        </div>
      )}

      {guest && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={ids.name}>{text.authorName}</Label>
            <Input id={ids.name} autoComplete="name" value={author.name} onChange={(event) => setAuthor((value) => ({ ...value, name: event.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.email}>{text.authorEmail}</Label>
            <Input
              id={ids.email}
              type="email"
              autoComplete="email"
              value={author.email}
              onChange={(event) => setAuthor((value) => ({ ...value, email: event.target.value }))}
              required
            />
          </div>
        </div>
      )}

      {settings.allow_anonymous && (
        <div className="flex items-center gap-2">
          <Checkbox id={`${id}-anonymous`} checked={state.anonymous} onCheckedChange={(checked) => actions.set({ anonymous: checked === true })} />
          <Label htmlFor={`${id}-anonymous`} className="font-normal">
            {text.anonymous}
          </Label>
        </div>
      )}

      {generalError && (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      )}

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
        {submitting ? text.submitting : text.submit}
      </Button>
    </form>
  );
}

export default HeadpressReviewForm;
