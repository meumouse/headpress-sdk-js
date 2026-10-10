"use client";

/**
 * Installment table for a product (`installments` module), in a dialog.
 *
 * Every row — count, amount per installment, total, interest — is a plan from
 * `hp.checkout.installments(productId)`. The best plan without interest and the best with interest
 * are the server's picks, highlighted as such. Nothing is divided or compounded here.
 */
import { useEffect, useState, type ReactNode } from "react";
import { CreditCard } from "lucide-react";

import type { InstallmentPlan, Money } from "@meumouse/headpress";
import { useCapability, useFormatError, useFormatMoney, useHeadpress, useStoreConfig } from "@meumouse/headpress/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface HeadpressInstallmentsLabels {
  trigger?: string;
  title?: string;
  description?: string;
  installments?: string;
  total?: string;
  plan?: (count: number, amount: string) => string;
  interestFree?: string;
  withInterest?: (interest: string) => string;
  bestWithoutInterest?: string;
  bestWithInterest?: string;
  loading?: string;
  empty?: string;
  retry?: string;
}

const DEFAULT_LABELS: Required<HeadpressInstallmentsLabels> = {
  trigger: "Ver parcelamento",
  title: "Opções de parcelamento",
  description: "Parcelas no cartão de crédito calculadas pela loja.",
  installments: "Parcelas",
  total: "Total",
  plan: (count, amount) => `${count}x de ${amount}`,
  interestFree: "sem juros",
  withInterest: (interest) => `juros de ${interest}`,
  bestWithoutInterest: "Melhor sem juros",
  bestWithInterest: "Mais parcelas",
  loading: "Carregando parcelas…",
  empty: "Este produto não tem parcelamento disponível.",
  retry: "Tentar de novo",
};

type Plans = { plans: InstallmentPlan[]; bestWithoutInterest: InstallmentPlan | null; bestWithInterest: InstallmentPlan | null };

export interface HeadpressInstallmentsProps {
  productId: number;
  /** The selected variation's price, so the server quotes that one. */
  price?: Money;
  /** A custom trigger element (rendered with `asChild`). */
  trigger?: ReactNode;
  labels?: HeadpressInstallmentsLabels;
  className?: string;
}

const samePlan = (a: InstallmentPlan | null, b: InstallmentPlan) => a !== null && a.count === b.count && a.hasInterest === b.hasInterest;

export function HeadpressInstallments({ productId, price, trigger, labels, className }: HeadpressInstallmentsProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const hp = useHeadpress();
  const config = useStoreConfig();
  const settings = useCapability("installments");
  const formatMoney = useFormatMoney();
  const formatError = useFormatError();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Plans | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  const priceKey = price ? `${price.amount}:${price.currency}` : "";

  // A new product or variation price needs the server's plans again.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [productId, priceKey]);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    setError(null);
    hp.checkout
      .installments(productId, price)
      .then((plans) => {
        if (!cancelled) setData(plans);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason);
      });
    return () => {
      cancelled = true;
    };
    // `price` is followed through `priceKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data, hp, productId, priceKey, attempt]);

  if (config && !settings) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="link" className="h-auto p-0">
            <CreditCard aria-hidden="true" />
            {text.trigger}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={cn("sm:max-w-lg", className)}>
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>

        <div aria-live="polite" aria-busy={!data && !error}>
          {!data && !error && (
            <div className="space-y-2">
              <span className="sr-only">{text.loading}</span>
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          )}

          {error !== null && (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-destructive">{formatError(error, "installments")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                {text.retry}
              </Button>
            </div>
          )}

          {data && data.plans.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{text.empty}</p>}

          {data && data.plans.length > 0 && (
            <div className="max-h-[60vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{text.installments}</TableHead>
                    <TableHead className="text-right">{text.total}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.plans.map((plan) => {
                    const bestFree = samePlan(data.bestWithoutInterest, plan);
                    const bestPaid = samePlan(data.bestWithInterest, plan);
                    return (
                      <TableRow key={`${plan.count}-${plan.hasInterest}`} className={cn((bestFree || bestPaid) && "bg-muted/60 font-medium")}>
                        <TableCell>
                          <span className="tabular-nums">{text.plan(plan.count, formatMoney(plan.amount))}</span>{" "}
                          <span className="text-xs text-muted-foreground">{plan.hasInterest ? text.withInterest(formatMoney(plan.interest)) : text.interestFree}</span>
                          {bestFree && (
                            <Badge variant="secondary" className="ml-2">
                              {text.bestWithoutInterest}
                            </Badge>
                          )}
                          {bestPaid && (
                            <Badge variant="outline" className="ml-2">
                              {text.bestWithInterest}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(plan.total)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default HeadpressInstallments;
