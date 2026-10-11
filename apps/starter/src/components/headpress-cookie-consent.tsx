"use client";

/**
 * Cookie consent banner for Headpress stores.
 *
 * Texts, categories, the policy link and the consent version come from the store's consent module
 * (`config.modules.consent`), so the copy is edited in WordPress. The decision is the one kept by
 * `createConsent()` from `@meumouse.com/headpress/analytics`, which the tracker and Consent Mode read;
 * the banner shows while it is undecided (also after the store bumps the consent version).
 */
import { useMemo, useState, useSyncExternalStore } from "react";

import type { Consent, ConsentState } from "@meumouse.com/headpress/analytics";
import { useCapability } from "@meumouse.com/headpress/react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface HeadpressCookieConsentLabels {
  title?: string;
  message?: string;
  acceptAll?: string;
  rejectAll?: string;
  customize?: string;
  save?: string;
  policy?: string;
  required?: string;
}

const FALLBACK: Required<HeadpressCookieConsentLabels> = {
  title: "Cookies",
  message: "Usamos cookies para o site funcionar, medir o uso e personalizar anúncios. Você escolhe quais aceita.",
  acceptAll: "Aceitar todos",
  rejectAll: "Recusar opcionais",
  customize: "Personalizar",
  save: "Salvar escolhas",
  policy: "Política de privacidade",
  required: "Sempre ativo",
};

export interface HeadpressCookieConsentProps {
  /** The consent object the tracker uses (`createConsent()`). */
  consent: Consent;
  /** After every decision, e.g. to `recordConsent(hp, state)`. */
  onDecision?: (state: ConsentState) => void;
  /** Overrides the store's texts. */
  labels?: HeadpressCookieConsentLabels;
  /** Link for the policy, when the store config has no `privacy_path`. */
  policyHref?: string;
  /** Render the policy link (e.g. your router's Link). */
  renderLink?: (href: string, label: string) => React.ReactNode;
  className?: string;
}

const subscribeNoop = () => () => {};

function sameState(a: ConsentState, b: ConsentState): boolean {
  return (
    a.decided === b.decided &&
    a.version === b.version &&
    a.id === b.id &&
    a.categories.length === b.categories.length &&
    a.categories.every((category, index) => category === b.categories[index])
  );
}

/**
 * `consent.get()` as a `useSyncExternalStore` source. The snapshot is cached and only replaced when
 * the decision changes, so it stays stable even with SDK versions whose `get()` builds a new object
 * on every call.
 */
function consentSource(consent: Consent) {
  let snapshot: ConsentState | null = null;
  return {
    subscribe: (listener: () => void) => consent.subscribe(() => listener()),
    getSnapshot: (): ConsentState => {
      const next = consent.get();
      if (!snapshot || !sameState(snapshot, next)) snapshot = next;
      return snapshot;
    },
  };
}

export function HeadpressCookieConsent({ consent, onDecision, labels, policyHref, renderLink, className }: HeadpressCookieConsentProps) {
  const settings = useCapability("consent");
  const source = useMemo(() => consentSource(consent), [consent]);
  const state = useSyncExternalStore<ConsentState | null>(source.subscribe, source.getSnapshot, () => null);
  // The decision lives in a cookie the server render cannot see: show nothing until mounted.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [customizing, setCustomizing] = useState(false);
  const categories = settings?.categories?.length
    ? settings.categories
    : [
        { id: "necessary", label: "Necessários", required: true },
        { id: "analytics", label: "Estatísticas", required: false },
        { id: "marketing", label: "Marketing", required: false },
      ];
  // The categories ticked while customizing, starting from the current decision; a new decision
  // (from this banner or anywhere else) starts the selection over.
  const [draft, setDraft] = useState<{ from: ConsentState | null; categories: string[] } | null>(null);
  const chosen = draft && draft.from === state ? draft.categories : (state?.categories ?? []);
  const toggle = (category: string, checked: boolean) =>
    setDraft((current) => {
      const base = current && current.from === state ? current.categories : (state?.categories ?? []);
      return { from: state, categories: checked ? [...new Set([...base, category])] : base.filter((entry) => entry !== category) };
    });

  if (!mounted || !state || state.decided) return null;

  const texts = {
    ...FALLBACK,
    ...(settings?.texts?.message ? { message: settings.texts.message } : {}),
    ...(settings?.texts?.accept_all ? { acceptAll: settings.texts.accept_all } : {}),
    ...(settings?.texts?.reject_all ? { rejectAll: settings.texts.reject_all } : {}),
    ...(settings?.texts?.customize ? { customize: settings.texts.customize } : {}),
    ...(settings?.texts?.save ? { save: settings.texts.save } : {}),
    ...(settings?.texts?.policy_link ? { policy: settings.texts.policy_link } : {}),
    ...labels,
  };
  const href = settings?.privacy_path || policyHref;
  const decide = (next: ConsentState) => onDecision?.(next);

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="hp-consent-title"
      aria-describedby="hp-consent-message"
      className={cn(
        "fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border bg-background p-4 shadow-lg sm:p-5",
        className,
      )}
      data-slot="headpress-cookie-consent"
    >
      <h2 id="hp-consent-title" className="text-sm font-semibold">
        {texts.title}
      </h2>
      <p id="hp-consent-message" className="mt-1 text-sm text-muted-foreground">
        {texts.message}{" "}
        {href &&
          (renderLink ? (
            renderLink(href, texts.policy)
          ) : (
            <a href={href} className="underline underline-offset-2">
              {texts.policy}
            </a>
          ))}
      </p>

      {customizing && (
        <ul className="mt-3 space-y-2">
          {categories.map((category) => {
            const id = `hp-consent-${category.id}`;
            return (
              <li key={category.id} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={category.required || chosen.includes(category.id)}
                  disabled={category.required}
                  onCheckedChange={(checked) => toggle(category.id, checked === true)}
                />
                <Label htmlFor={id} className="text-sm">
                  {category.label}
                  {category.required && <span className="ml-2 text-xs text-muted-foreground">{texts.required}</span>}
                </Label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {customizing ? (
          <Button size="sm" onClick={() => decide(consent.grant(chosen))}>
            {texts.save}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setCustomizing(true)}>
            {texts.customize}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => decide(consent.rejectAll())}>
          {texts.rejectAll}
        </Button>
        <Button size="sm" onClick={() => decide(consent.acceptAll())}>
          {texts.acceptAll}
        </Button>
      </div>
    </section>
  );
}

export default HeadpressCookieConsent;
