"use client";

/**
 * Brazilian address form, on `useAddressForm()`.
 *
 * The CEP fills street, neighborhood, city and state through ViaCEP as soon as it is complete (only
 * empty fields, so nothing the shopper typed is overwritten); CPF/CNPJ and phone are masked as they
 * are typed. On submit, `onSubmit(values, checkoutFields)` gets the address and the Brazilian Market
 * values for `hp.checkout.place({ fields })`.
 */
import { useId, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import type { BrazilianMarketInput } from "@meumouse.com/headpress/br";
import { maskDocument, maskPhone } from "@meumouse.com/headpress/br";
import type { AddressFormValues } from "@meumouse.com/headpress/controllers";
import { useAddressForm, useCapability } from "@meumouse.com/headpress/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Field = "first_name" | "last_name" | "postcode" | "address_1" | "number" | "address_2" | "neighborhood" | "city" | "state" | "document" | "phone";

export interface HeadpressAddressFormLabels {
  fields?: Partial<Record<Field, string>>;
  placeholders?: Partial<Record<Field, string>>;
  optional?: string;
  required?: string;
  /** Messages for invalid values, by field. */
  invalid?: Partial<Record<Field, string>>;
  invalidField?: string;
  lookingUp?: string;
  postcodeNotFound?: string;
  postcodeLookupFailed?: string;
  unknownPostcode?: string;
  statePlaceholder?: string;
  submit?: string;
  submitting?: string;
}

const DEFAULT_LABELS = {
  fields: {
    first_name: "Nome",
    last_name: "Sobrenome",
    postcode: "CEP",
    address_1: "Rua",
    number: "Número",
    address_2: "Complemento",
    neighborhood: "Bairro",
    city: "Cidade",
    state: "Estado",
    document: "CPF ou CNPJ",
    phone: "Celular",
  } as Record<Field, string>,
  placeholders: {
    postcode: "00000-000",
    address_2: "Apartamento, bloco, referência",
    document: "000.000.000-00",
    phone: "(00) 00000-0000",
  } as Partial<Record<Field, string>>,
  optional: "(opcional)",
  required: "Preencha este campo.",
  invalid: {
    postcode: "Digite um CEP válido.",
    document: "Digite um CPF ou CNPJ válido.",
    phone: "Digite um telefone válido com DDD.",
  } as Partial<Record<Field, string>>,
  invalidField: "Confira este campo.",
  lookingUp: "Buscando o endereço…",
  postcodeNotFound: "Não encontramos este CEP. Preencha o endereço.",
  postcodeLookupFailed: "Não foi possível buscar o CEP agora. Preencha o endereço.",
  unknownPostcode: "Não sei meu CEP",
  statePlaceholder: "Selecione",
  submit: "Salvar endereço",
  submitting: "Salvando…",
};

export const BRAZILIAN_STATES: readonly { code: string; name: string }[] = [
  { code: "AC", name: "Acre" },
  { code: "AL", name: "Alagoas" },
  { code: "AP", name: "Amapá" },
  { code: "AM", name: "Amazonas" },
  { code: "BA", name: "Bahia" },
  { code: "CE", name: "Ceará" },
  { code: "DF", name: "Distrito Federal" },
  { code: "ES", name: "Espírito Santo" },
  { code: "GO", name: "Goiás" },
  { code: "MA", name: "Maranhão" },
  { code: "MT", name: "Mato Grosso" },
  { code: "MS", name: "Mato Grosso do Sul" },
  { code: "MG", name: "Minas Gerais" },
  { code: "PA", name: "Pará" },
  { code: "PB", name: "Paraíba" },
  { code: "PR", name: "Paraná" },
  { code: "PE", name: "Pernambuco" },
  { code: "PI", name: "Piauí" },
  { code: "RJ", name: "Rio de Janeiro" },
  { code: "RN", name: "Rio Grande do Norte" },
  { code: "RS", name: "Rio Grande do Sul" },
  { code: "RO", name: "Rondônia" },
  { code: "RR", name: "Roraima" },
  { code: "SC", name: "Santa Catarina" },
  { code: "SP", name: "São Paulo" },
  { code: "SE", name: "Sergipe" },
  { code: "TO", name: "Tocantins" },
];

export interface HeadpressAddressFormProps {
  initial?: AddressFormValues;
  onSubmit: (values: AddressFormValues, checkoutFields: Record<string, string>) => void | Promise<void>;
  /** Extra Brazilian Market values (person type, company, birthdate…) for `checkoutFields`. */
  checkoutExtra?: Omit<BrazilianMarketInput, "document" | "number" | "neighborhood">;
  showNames?: boolean;
  showDocument?: boolean;
  showPhone?: boolean;
  requireDocument?: boolean;
  /** Defaults to `config.modules.address_book.require_number`, else true. */
  requireNumber?: boolean;
  /** Defaults to `config.modules.address_book.require_neighborhood`, else false. */
  requireNeighborhood?: boolean;
  /** Where "I don't know my postcode" points; null hides it. */
  postcodeFinderUrl?: string | null;
  /** Extra content above the submit button (e.g. a "save as default" checkbox). */
  children?: ReactNode;
  labels?: HeadpressAddressFormLabels;
  className?: string;
}

export function HeadpressAddressForm({
  initial,
  onSubmit,
  checkoutExtra,
  showNames = true,
  showDocument = true,
  showPhone = true,
  requireDocument = false,
  requireNumber,
  requireNeighborhood,
  postcodeFinderUrl = "https://buscacepinter.correios.com.br/app/endereco/index.php",
  children,
  labels,
  className,
}: HeadpressAddressFormProps) {
  const text = {
    ...DEFAULT_LABELS,
    ...labels,
    fields: { ...DEFAULT_LABELS.fields, ...labels?.fields },
    placeholders: { ...DEFAULT_LABELS.placeholders, ...labels?.placeholders },
    invalid: { ...DEFAULT_LABELS.invalid, ...labels?.invalid },
  };
  const addressBook = useCapability("address_book");
  const [state, actions, controller] = useAddressForm(initial);
  const [submitting, setSubmitting] = useState(false);
  const id = useId();

  const needNumber = requireNumber ?? addressBook?.require_number ?? true;
  const needNeighborhood = requireNeighborhood ?? addressBook?.require_neighborhood ?? false;
  const values = state.values;
  const required: Record<Field, boolean> = {
    first_name: true,
    last_name: true,
    postcode: true,
    address_1: true,
    number: needNumber,
    address_2: false,
    neighborhood: needNeighborhood,
    city: true,
    state: true,
    document: requireDocument,
    phone: false,
  };

  const fieldId = (field: Field) => `${id}-${field}`;
  const errorOf = (field: Field): string | null => {
    const code = state.fieldErrors[field];
    if (!code) return null;
    if (code === "required") return text.required;
    if (code === "invalid") return text.invalid[field] ?? text.invalidField;
    return text.invalidField;
  };
  const describedBy = (field: Field, extra?: string) => [errorOf(field) ? `${fieldId(field)}-error` : "", extra ?? ""].filter(Boolean).join(" ") || undefined;

  const label = (field: Field) => (
    <Label htmlFor={fieldId(field)}>
      {text.fields[field]} {!required[field] && <span className="font-normal text-muted-foreground">{text.optional}</span>}
    </Label>
  );
  const error = (field: Field) => {
    const message = errorOf(field);
    return message ? (
      <p id={`${fieldId(field)}-error`} className="text-sm text-destructive">
        {message}
      </p>
    ) : null;
  };
  const textField = (field: Exclude<Field, "state">, props: Partial<ComponentProps<typeof Input>> = {}, onValue?: (value: string) => string) => (
    <div className="space-y-2">
      {label(field)}
      <Input
        id={fieldId(field)}
        value={String(values[field] ?? "")}
        placeholder={text.placeholders[field]}
        required={required[field]}
        aria-invalid={Boolean(errorOf(field))}
        aria-describedby={describedBy(field)}
        onChange={(event) => actions.set({ [field]: onValue ? onValue(event.target.value) : event.target.value })}
        {...props}
      />
      {error(field)}
    </div>
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const valid = actions.validate({ requireDocument, requireNumber: needNumber, requireNeighborhood: needNeighborhood });
    if (!valid) {
      // Take the shopper to the first field to fix.
      const first = Object.keys(controller.getState().fieldErrors)[0];
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(controller.getState().values, actions.checkoutFields(checkoutExtra));
    } finally {
      setSubmitting(false);
    }
  };

  const lookupMessage =
    state.lookup === "loading" ? text.lookingUp : state.lookup === "not_found" ? text.postcodeNotFound : state.lookup === "failed" ? text.postcodeLookupFailed : "";

  return (
    <form onSubmit={submit} noValidate className={cn("space-y-4", className)} aria-busy={submitting} data-slot="headpress-address-form">
      {showNames && (
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("first_name", { autoComplete: "given-name" })}
          {textField("last_name", { autoComplete: "family-name" })}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-start">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            {label("postcode")}
            {postcodeFinderUrl && (
              <a href={postcodeFinderUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                {text.unknownPostcode}
              </a>
            )}
          </div>
          <div className="relative">
            <Input
              id={fieldId("postcode")}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={9}
              value={values.postcode ?? ""}
              placeholder={text.placeholders.postcode}
              required
              aria-invalid={Boolean(errorOf("postcode"))}
              aria-describedby={describedBy("postcode", `${fieldId("postcode")}-lookup`)}
              onChange={(event) => {
                actions.set({ postcode: event.target.value });
                // Look the address up as soon as the eighth digit lands.
                if (event.target.value.replace(/\D/g, "").length === 8) void actions.lookupPostcode();
              }}
            />
            {state.lookup === "loading" && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />}
          </div>
          {error("postcode")}
          <p id={`${fieldId("postcode")}-lookup`} aria-live="polite" className="text-xs text-muted-foreground empty:hidden">
            {lookupMessage}
          </p>
        </div>
        {textField("address_1", { autoComplete: "address-line1" })}
      </div>

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        {textField("number", { inputMode: "numeric", autoComplete: "off" })}
        {textField("address_2", { autoComplete: "address-line2" })}
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_10rem]">
        {textField("neighborhood", { autoComplete: "address-level3" })}
        {textField("city", { autoComplete: "address-level2" })}
        <div className="space-y-2">
          {label("state")}
          <Select value={values.state || undefined} onValueChange={(value) => actions.set({ state: value })}>
            <SelectTrigger id={fieldId("state")} className="w-full" aria-invalid={Boolean(errorOf("state"))} aria-describedby={describedBy("state")}>
              <SelectValue placeholder={text.statePlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {BRAZILIAN_STATES.map((uf) => (
                <SelectItem key={uf.code} value={uf.code}>
                  {uf.code} — {uf.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error("state")}
        </div>
      </div>

      {(showDocument || showPhone) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {showDocument && textField("document", { inputMode: "numeric", autoComplete: "off", maxLength: 18 }, maskDocument)}
          {showPhone && textField("phone", { type: "tel", inputMode: "tel", autoComplete: "tel-national" }, maskPhone)}
        </div>
      )}

      {children}

      <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
        {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
        {submitting ? text.submitting : text.submit}
      </Button>
    </form>
  );
}

export default HeadpressAddressForm;
