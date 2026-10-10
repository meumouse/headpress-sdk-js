/**
 * `@meumouse/headpress/br`: Brazilian commerce helpers.
 *
 * - CPF and CNPJ: masks, check digits, person type (B2C and B2B).
 * - CEP: mask, ViaCEP lookup.
 * - Phone: masks and the canonical `55DDNNNNNNNNN` form.
 * - Dates: `DD/MM/AAAA` ↔ ISO.
 * - `brazilianMarketValues()`: the Brazilian Market checkout fields Headpress's `checkout_fields`
 *   module saves (`extensions.headpress.checkout_fields.values`).
 */

const digits = (value: string): string => value.replace(/\D/g, "");

/* ------------------------------------------------------------------ */
/* CPF / CNPJ                                                          */
/* ------------------------------------------------------------------ */

/** `000.000.000-00`, as the user types. */
export function maskCpf(value: string): string {
  const d = digits(value).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

/** `00.000.000/0000-00`, as the user types. */
export function maskCnpj(value: string): string {
  const d = digits(value).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/** A CPF with valid check digits (masked or digits only). */
export function isValidCpf(value: string): boolean {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const check = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]);
}

/** A CNPJ with valid check digits (masked or digits only). */
export function isValidCnpj(value: string): boolean {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const check = (length: number): number => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + weight * Number(cnpj[index]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(cnpj[12]) && check(13) === Number(cnpj[13]);
}

/** `cpf`, `cnpj` or null, from the number of digits and the check digits. */
export function documentType(value: string): "cpf" | "cnpj" | null {
  const d = digits(value);
  if (d.length === 11 && isValidCpf(d)) return "cpf";
  if (d.length === 14 && isValidCnpj(d)) return "cnpj";
  return null;
}

/** Mask whichever document the digits are (CPF up to 11 digits, CNPJ beyond). */
export function maskDocument(value: string): string {
  return digits(value).length > 11 ? maskCnpj(value) : maskCpf(value);
}

/* ------------------------------------------------------------------ */
/* CEP                                                                 */
/* ------------------------------------------------------------------ */

/** `00000-000`, as the user types. */
export function maskCep(value: string): string {
  return digits(value).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
}

export function isValidCep(value: string): boolean {
  return /^\d{8}$/.test(digits(value)) && !/^0{8}$/.test(digits(value));
}

export interface CepAddress {
  postcode: string;
  address_1: string;
  neighborhood: string;
  city: string;
  state: string;
  /** IBGE city code. */
  ibge: string;
}

const viaCepCache = new Map<string, Promise<CepAddress | null>>();

/**
 * The address of a CEP from ViaCEP (viacep.com.br), or null when the CEP does not exist. Results are
 * kept in memory for the page's life. Network failures reject, so the form can tell "unknown CEP"
 * from "could not check".
 */
export function lookupCep(cep: string, options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<CepAddress | null> {
  const d = digits(cep);
  if (!isValidCep(d)) return Promise.resolve(null);
  const cached = viaCepCache.get(d);
  if (cached) return cached;
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const pending = fetchImpl(`https://viacep.com.br/ws/${d}/json/`, { signal: options.signal, headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (response.status === 400) return null;
      if (!response.ok) throw new Error(`ViaCEP answered ${response.status}.`);
      const data = (await response.json()) as Record<string, string | boolean>;
      if (data.erro) return null;
      return {
        postcode: maskCep(String(data.cep ?? d)),
        address_1: String(data.logradouro ?? ""),
        neighborhood: String(data.bairro ?? ""),
        city: String(data.localidade ?? ""),
        state: String(data.uf ?? ""),
        ibge: String(data.ibge ?? ""),
      };
    })
    .catch((error: unknown) => {
      viaCepCache.delete(d);
      throw error;
    });
  viaCepCache.set(d, pending);
  return pending;
}

/* ------------------------------------------------------------------ */
/* Phone                                                               */
/* ------------------------------------------------------------------ */

/** `(00) 00000-0000` or `(00) 0000-0000`, as the user types. */
export function maskPhone(value: string): string {
  let d = digits(value);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * The canonical Brazilian phone `55` + area code + number (12 or 13 digits), as Headpress stores
 * login phones, or null when it is not a Brazilian phone.
 */
export function canonicalPhone(value: string): string | null {
  let d = digits(value);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d.length === 11 && d[2] !== "9") return null;
  if (/^0/.test(d)) return null;
  return `55${d}`;
}

/** Whether the value is a Brazilian mobile number (WhatsApp-capable). */
export function isMobilePhone(value: string): boolean {
  const canonical = canonicalPhone(value);
  return canonical !== null && canonical.length === 13;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

export function maskDate(value: string): string {
  const d = digits(value).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** `DD/MM/AAAA` → `AAAA-MM-DD`, or "" when it is not a real past date from 1900 on. */
export function parseBirthDate(value: string, now: Date = new Date()): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return "";
  const [, dd = "", mm = "", yyyy = ""] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (Number(yyyy) < 1900 || date.getFullYear() !== Number(yyyy) || date.getMonth() !== Number(mm) - 1 || date.getDate() !== Number(dd)) return "";
  if (date > now) return "";
  return `${yyyy}-${mm}-${dd}`;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`, or "". */
export function formatBirthDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/* ------------------------------------------------------------------ */
/* Brazilian Market checkout fields                                    */
/* ------------------------------------------------------------------ */

export interface BrazilianMarketInput {
  /** `cpf` for people, `cnpj` for companies; inferred from the document when omitted. */
  personType?: "cpf" | "cnpj";
  /** CPF or CNPJ, masked or digits only. */
  document?: string;
  /** Company name, for CNPJ buyers. */
  company?: string;
  /** State registration (IE), for CNPJ buyers. */
  stateRegistration?: string;
  /** `AAAA-MM-DD`. */
  birthdate?: string;
  /** `M`/`F`, when the store asks. */
  gender?: string;
  /** Street number for both addresses, unless the shipping one is given. */
  number?: string;
  neighborhood?: string;
  shippingNumber?: string;
  shippingNeighborhood?: string;
  cellphone?: string;
}

/**
 * Brazilian Market field ids → values, for `extensions.headpress.checkout_fields.values`. Fields
 * left empty are omitted so the field keeps its default. Headpress drops fields the store's
 * Brazilian Market setup does not register.
 */
export function brazilianMarketValues(input: BrazilianMarketInput): Record<string, string> {
  const type = input.personType ?? (input.document ? documentType(input.document) : null) ?? "cpf";
  const document = digits(input.document ?? "");
  const values: Record<string, string> = {
    billing_persontype: type === "cnpj" ? "2" : "1",
    ...(type === "cnpj"
      ? { billing_cnpj: document, billing_company: input.company ?? "", billing_ie: input.stateRegistration ?? "" }
      : { billing_cpf: document }),
    billing_birthdate: input.birthdate ?? "",
    billing_sex: input.gender ?? "",
    billing_number: input.number ?? "",
    billing_neighborhood: input.neighborhood ?? "",
    shipping_number: input.shippingNumber ?? input.number ?? "",
    shipping_neighborhood: input.shippingNeighborhood ?? input.neighborhood ?? "",
    billing_cellphone: input.cellphone ? digits(input.cellphone) : "",
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
}
